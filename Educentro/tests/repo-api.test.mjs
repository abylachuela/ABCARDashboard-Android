// Pruebas unitarias de EDU.repoApi (js/data/repo-api.js) con fetch simulado. Sin dependencias ni navegador:
//   node --test Educentro/tests/repo-api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODIGO = fs.readFileSync(path.join(RAIZ, 'js/data/repo-api.js'), 'utf8');
const COLS = ['centros', 'usuarios', 'estudiantes', 'calificaciones', 'comunicados', 'auditoria'];

/** Crea un entorno aislado con un fetch simulado. `rutas`: fn(req) -> {status, cuerpo, cabeceras} | Error (red caída). */
function entorno(manejador, { modo = 'api', rol = 'director' } = {}) {
  const llamadas = [], escrituras = [], eventos = { cierres: [], toasts: [], usar: [] };
  const spy = new Proxy({}, { get: (_, k) => (k === 'setItem' || k === 'removeItem' || k === 'clear' ? (...a) => escrituras.push([k, ...a]) : k === 'length' ? 0 : () => null) });
  const ctx = { console, setTimeout, URLSearchParams, JSON, Date, Promise, localStorage: spy, sessionStorage: spy, location: { origin: 'http://web.test' } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(`window.EDU_CONFIG = { modo: '${modo}', apiBase: '/api/v1' };`, ctx);
  ctx.EDU = {
    repoLocal: { COLECCIONES: COLS }, repo: { usar: (a) => eventos.usar.push(a) },
    estado: { sesion: () => ({ rol, usuarioId: 'u1' }), autenticado: () => true, cerrarSesion: (o) => eventos.cierres.push(o) },
    ui: { toast: (m) => eventos.toasts.push(m) },
  };
  ctx.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://web.test'), req = { metodo: init.method || 'GET', ruta: u.pathname, q: u.searchParams, cabeceras: init.headers || {}, cuerpo: init.body ? JSON.parse(init.body) : undefined, init };
    llamadas.push(req);
    const r = await manejador(req, llamadas.length);
    if (r instanceof Error) throw r;
    const txt = r.cuerpo === undefined ? '' : typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo);
    return { status: r.status ?? 200, headers: { get: (k) => (r.cabeceras || {})[k] ?? null }, text: async () => txt };
  };
  vm.runInContext(CODIGO, ctx, { filename: 'repo-api.js' });
  const api = ctx.EDU.repoApi;
  api.esperar = async (ms) => { eventos.esperas = (eventos.esperas || []).concat(ms); }; // sin esperar de verdad
  return { api, llamadas, escrituras, eventos, EDU: ctx.EDU };
}
const plano = (x) => JSON.parse(JSON.stringify(x));
const j = (cuerpo, status = 200, cabeceras) => ({ status, cuerpo, cabeceras });
const err = (estado, codigo, mensaje, campos) => j({ error: { codigo, mensaje, ...(campos ? { campos } : {}) } }, estado);
const rechaza = async (p) => { try { await p; } catch (e) { return e; } assert.fail('debía rechazar'); };

test('se activa con EDU.repo.usar solo en modo api', () => {
  const a = entorno(() => j({}), { modo: 'api' });
  assert.equal(a.eventos.usar.length, 1);
  assert.equal(a.eventos.usar[0], a.api);
  const l = entorno(() => j({}), { modo: 'local' });
  assert.equal(l.eventos.usar.length, 0);
});

test('interfaz igual que repoLocal', () => {
  const { api } = entorno(() => j({}));
  for (const m of ['listar', 'obtener', 'guardar', 'guardarMuchos', 'borrar', 'exportarTodo', 'importarTodo', 'idNuevo']) assert.equal(typeof api[m], 'function', m);
  assert.deepEqual(api.COLECCIONES, COLS);
  assert.match(api.idNuevo('estudiantes'), /^est_/);
});

test('paginación automática: trae todas las páginas (limite 500) y devuelve copias', async () => {
  const total = 1230, todos = Array.from({ length: total }, (_, i) => ({ id: 'e' + i, centroId: 'c1' }));
  const { api, llamadas } = entorno((r) => {
    const off = Number(r.q.get('offset')), lim = Number(r.q.get('limite'));
    const datos = todos.slice(off, off + lim);
    return j({ datos, total, siguiente: off + datos.length < total ? off + datos.length : null });
  });
  const l = await api.listar('estudiantes', { centroId: 'c1' });
  assert.equal(l.length, total);
  assert.equal(llamadas.length, 3);
  assert.deepEqual(llamadas.map((c) => c.q.get('offset')), ['0', '500', '1000']);
  assert.ok(llamadas.every((c) => c.q.get('limite') === '500'));
  l[0].id = 'mutado';
  assert.equal((await api.listar('estudiantes', {}))[0].id, 'e0', 'la caché no se contamina con las mutaciones');
});

test('filtro por centro: solo admin_red envía f.centroId', async () => {
  const resp = () => j({ datos: [], total: 0, siguiente: null });
  const adm = entorno(resp, { rol: 'admin_red' });
  await adm.api.listar('estudiantes', { centroId: 'c9' });
  assert.equal(adm.llamadas[0].q.get('f.centroId'), 'c9');
  const dir = entorno(resp, { rol: 'director' });
  await dir.api.listar('estudiantes', { centroId: 'c9' });
  assert.equal(dir.llamadas[0].q.has('f.centroId'), false);
});

test('cabeceras: credentials same-origin, CSRF solo en métodos no seguros', async () => {
  const { api, llamadas } = entorno((r) => {
    if (r.ruta === '/api/v1/auth/login') return j({ usuario: { id: 'u1', rol: 'director' }, csrf: 'tok-csrf-1' });
    if (r.metodo === 'DELETE') return { status: 204 };
    return j({ id: 'x1', actualizadoEn: '2026-01-01T00:00:00.000Z' }, r.metodo === 'POST' ? 201 : 200);
  });
  await api.auth.login('a@b.test', 'clave-larga-123');
  await api.obtener('estudiantes', 'x1');
  await api.guardar('estudiantes', { nombre: 'A' });
  await api.guardar('estudiantes', { id: 'x1', nombre: 'B', actualizadoEn: '2026-01-01T00:00:00.000Z' });
  await api.borrar('estudiantes', 'x1');
  const porM = (m) => llamadas.filter((c) => c.metodo === m && !c.ruta.includes('/auth/'));
  assert.ok(llamadas.every((c) => c.init.credentials === 'same-origin'));
  assert.equal(porM('GET')[0].cabeceras['X-EDU-CSRF'], undefined, 'GET sin CSRF');
  for (const m of ['POST', 'PUT', 'DELETE']) assert.equal(porM(m)[0].cabeceras['X-EDU-CSRF'], 'tok-csrf-1', m);
  assert.equal(porM('PUT')[0].cabeceras['If-Match'], '2026-01-01T00:00:00.000Z', 'If-Match con actualizadoEn');
  assert.equal(porM('PUT')[0].ruta, '/api/v1/c/estudiantes/x1');
  assert.equal(porM('POST')[0].ruta, '/api/v1/c/estudiantes');
});

test('guardar: PUT con id; si no existe (404) cae a POST con el mismo id; sin id, POST', async () => {
  const { api, llamadas } = entorno((r) => (r.metodo === 'PUT' ? err(404, 'no_encontrado', 'x') : j({ ...r.cuerpo, actualizadoEn: 't' }, 201)));
  const g = await api.guardar('estudiantes', { id: 'est_nuevo', nombre: 'Z' });
  assert.equal(g.id, 'est_nuevo');
  assert.deepEqual(llamadas.map((c) => c.metodo), ['PUT', 'POST']);
  assert.equal(llamadas[1].cuerpo.id, 'est_nuevo');
});

test('lote: asigna id a los nuevos y respeta el máximo de 500 por petición', async () => {
  const { api, llamadas } = entorno((r) => j({ datos: r.cuerpo.registros }));
  const out = await api.guardarMuchos('estudiantes', Array.from({ length: 1001 }, (_, i) => (i % 2 ? { id: 'e' + i } : { nombre: 'n' + i })));
  assert.equal(llamadas.length, 3);
  assert.ok(llamadas.every((c) => c.ruta === '/api/v1/c/estudiantes/lote' && c.cuerpo.registros.length <= 500));
  assert.equal(out.length, 1001);
  assert.ok(out.every((r) => !!r.id));
});

test('mapeo de errores a mensajes en español', async () => {
  const caso = async (resp, ...args) => { const { api } = entorno(() => resp); return rechaza(api.guardar(...args)); };
  const e403 = await caso(err(403, 'sin_permiso', 'detalle interno SQL'), 'estudiantes', { nombre: 'A' });
  assert.equal(e403.estado, 403); assert.match(e403.message, /^Sin permiso/); assert.doesNotMatch(e403.message, /SQL/);
  const e409 = await caso(err(409, 'conflicto_version', 'x'), 'estudiantes', { id: 'a' });
  assert.match(e409.message, /El registro cambió, recarga/);
  const e422 = await caso(err(422, 'datos_invalidos', 'El nombre es obligatorio.', ['nombre', 'edad']), 'estudiantes', { nombre: '' });
  assert.match(e422.message, /El nombre es obligatorio\. \(nombre, edad\)/); assert.deepEqual(e422.campos, ['nombre', 'edad']);
  const e500 = await caso(j('Error: relation "x" does not exist\n at pg (/srv/app.js:10)', 500), 'estudiantes', { nombre: 'A' });
  assert.match(e500.message, /servidor/i); assert.doesNotMatch(e500.message, /relation|srv|pg/);
  const eRed = await caso(new TypeError('fetch failed ECONNREFUSED 10.0.0.5:3000'), 'estudiantes', { nombre: 'A' });
  assert.match(eRed.message, /No se pudo conectar con el servidor/); assert.doesNotMatch(eRed.message, /ECONN|10\.0/);
  const eHtml = await caso(j('<html>502 Bad Gateway nginx/1.24</html>', 502), 'estudiantes', { nombre: 'A' });
  assert.doesNotMatch(eHtml.message, /nginx|html/i);
  const eXss = await caso(err(422, 'x', '<img src=x onerror=alert(1)>'), 'estudiantes', {});
  assert.doesNotMatch(eXss.message, /[<>]/);
});

test('obtener: 404 => null; borrar: 404 => false; 403 se propaga', async () => {
  const a = entorno(() => err(404, 'no_encontrado', 'x'));
  assert.equal(await a.api.obtener('estudiantes', 'zz'), null);
  assert.equal(await a.api.borrar('estudiantes', 'zz'), false);
  const b = entorno(() => err(403, 'sin_permiso', 'x'));
  assert.equal((await rechaza(b.api.obtener('estudiantes', 'zz'))).estado, 403);
});

test('401 en datos: cierra la sesión local (sin llamar a logout) y avisa; en /auth/me devuelve null sin cerrar', async () => {
  const a = entorno(() => err(401, 'no_autenticado', 'x'));
  const e = await rechaza(a.api.listar('estudiantes', {}));
  assert.equal(e.estado, 401); assert.match(e.message, /sesión caducó/);
  assert.deepEqual(plano(a.eventos.cierres), [{ sinServidor: true }]);
  assert.equal(a.eventos.toasts.length, 1);
  assert.equal(a.llamadas.filter((c) => c.ruta.includes('logout')).length, 0);
  const b = entorno(() => err(401, 'no_autenticado', 'x'));
  assert.equal(await b.api.auth.me(), null);
  assert.equal(b.eventos.cierres.length, 0);
  const c = entorno(() => err(401, 'credenciales', 'Usuario inexistente'));
  const el = await rechaza(c.api.auth.login('a@b.test', 'x'));
  assert.equal(el.message, 'Correo o contraseña incorrectos.'); assert.equal(c.eventos.cierres.length, 0);
});

test('409 invalida la caché de la colección', async () => {
  let n = 0;
  const { api, llamadas } = entorno((r) => (r.metodo === 'GET' ? j({ datos: [{ id: 'a' }], total: 1, siguiente: null }) : (n++, err(409, 'conflicto_version', 'x'))));
  await api.listar('estudiantes', {}); await api.listar('estudiantes', {});
  assert.equal(llamadas.length, 1, 'segunda lectura desde caché');
  await rechaza(api.guardar('estudiantes', { id: 'a', actualizadoEn: '2026-01-01T00:00:00.000Z' }));
  await api.listar('estudiantes', {});
  assert.equal(llamadas.filter((c) => c.metodo === 'GET').length, 2, 'tras el 409 se vuelve a pedir');
});

test('429: reintenta con espera acotada y acaba bien; si persiste, mensaje claro', async () => {
  const a = entorno((r, n) => (n <= 2 ? j({ error: { codigo: 'limite' } }, 429, { 'Retry-After': '1' }) : j({ datos: [{ id: 'a' }], total: 1, siguiente: null })));
  const l = await a.api.listar('estudiantes', {});
  assert.equal(l.length, 1); assert.equal(a.llamadas.length, 3);
  assert.deepEqual(a.eventos.esperas, [1000, 1000]);
  const b = entorno(() => j({}, 429, { 'Retry-After': '9999' }));
  const e = await rechaza(b.api.listar('estudiantes', {}));
  assert.equal(e.estado, 429); assert.match(e.message, /Demasiadas solicitudes/);
  assert.equal(b.llamadas.length, 3, '1 intento + 2 reintentos');
  assert.ok(b.eventos.esperas.every((ms) => ms <= 4000), 'espera acotada');
});

test('caché: lecturas repetidas no llaman; escribir invalida; obtener reutiliza la lista', async () => {
  const { api, llamadas } = entorno((r) => (r.metodo === 'GET' ? j({ datos: [{ id: 'a', n: 1 }], total: 1, siguiente: null }) : j({ id: 'a', n: 2 })));
  await api.listar('estudiantes', {}); await api.listar('estudiantes', {});
  assert.equal((await api.obtener('estudiantes', 'a')).n, 1);
  assert.equal(llamadas.length, 1);
  await api.guardar('estudiantes', { id: 'a', n: 2 });
  await api.listar('estudiantes', {});
  assert.equal(llamadas.filter((c) => c.metodo === 'GET').length, 2);
  api.limpiarCache(); await api.listar('estudiantes', {});
  assert.equal(llamadas.filter((c) => c.metodo === 'GET').length, 3);
});

test('NO escribe nada en localStorage/sessionStorage en ningún flujo', async () => {
  const { api, escrituras } = entorno((r) => {
    if (r.ruta.endsWith('/login') || r.ruta.endsWith('/me')) return j({ usuario: { id: 'u1', rol: 'director', nombre: 'N' }, csrf: 'c' });
    if (r.metodo === 'GET') return j({ datos: [{ id: 'a', nombre: 'Dato personal' }], total: 1, siguiente: null });
    return r.metodo === 'DELETE' ? { status: 204 } : j({ id: 'a', ...(r.cuerpo || {}) });
  });
  await api.auth.login('a@b.test', 'clave-secreta-123'); await api.auth.me();
  await api.listar('estudiantes', {}); await api.obtener('estudiantes', 'a');
  await api.guardar('estudiantes', { nombre: 'X' }); await api.guardar('estudiantes', { id: 'a' });
  await api.guardarMuchos('estudiantes', [{ nombre: 'Y' }]).catch(() => {});
  await api.borrar('estudiantes', 'a'); await api.auditar({ accion: 'x' }); await api.exportarTodo().catch(() => {});
  await api.auth.logout();
  assert.deepEqual(escrituras, []);
});

test('auditar y registrarLectura usan sus endpoints; importar/reemplazar/limpiar no existen en modo servidor', async () => {
  const { api, llamadas } = entorno((r) => (r.ruta.endsWith('/lectura') ? j({ id: 'c1', lecturas: [] }) : j({ id: 'aud1' }, 201)));
  await api.auditar({ accion: 'importar_planilla', coleccion: 'calificaciones', usuarioId: 'falso', fecha: 'falsa', rol: 'admin_red' });
  assert.equal(llamadas[0].ruta, '/api/v1/auditoria');
  assert.deepEqual(Object.keys(llamadas[0].cuerpo), ['accion', 'coleccion'], 'usuario, rol y fecha los fija el servidor');
  const c = await api.registrarLectura('c1');
  assert.equal(llamadas[1].ruta, '/api/v1/comunicados/c1/lectura'); assert.equal(llamadas[1].metodo, 'POST'); assert.equal(c.id, 'c1');
  for (const m of ['importarTodo', 'reemplazar', 'limpiarTodo']) { const e = await rechaza(api[m]({})); assert.match(e.message, /Fase 5/); }
  assert.ok(!llamadas.some((c2) => /\/c\/auditoria/.test(c2.ruta)), 'nunca por el adaptador genérico');
});

test('exportarTodo normaliza la respuesta a todas las colecciones', async () => {
  const { api, llamadas } = entorno(() => j({ datos: { estudiantes: [{ id: 'a' }] } }));
  const t = await api.exportarTodo();
  assert.equal(llamadas[0].ruta, '/api/v1/respaldo/exportar');
  assert.deepEqual(Object.keys(t).sort(), COLS.slice().sort()); assert.equal(t.estudiantes.length, 1); assert.deepEqual(plano(t.comunicados), []);
});

test('cambiarClave renueva el CSRF con /auth/me y recuperar acepta 202', async () => {
  let me = 0;
  const { api, llamadas } = entorno((r) => {
    if (r.ruta.endsWith('/cambiar-clave')) return { status: 204 };
    if (r.ruta.endsWith('/me')) { me++; return j({ usuario: { id: 'u1', rol: 'director' }, csrf: 'csrf-rotado' }); }
    if (r.ruta.endsWith('/recuperar')) return j({ ok: true }, 202);
    return j({ id: 'z' });
  });
  const s = await api.auth.cambiarClave('vieja', 'nueva-larga-123');
  assert.equal(s.csrf, 'csrf-rotado'); assert.equal(me, 1);
  assert.equal(await api.auth.recuperar(' a@b.test '), true);
  assert.equal(llamadas.find((c) => c.ruta.endsWith('/recuperar')).cuerpo.email, 'a@b.test');
  await api.guardar('estudiantes', { nombre: 'A' });
  assert.equal(llamadas[llamadas.length - 1].cabeceras['X-EDU-CSRF'], 'csrf-rotado');
});

test('forma real del servidor: csrfToken, centroId y debeCambiarClave fuera del usuario; exportar con "colecciones"', async () => {
  const { api, llamadas } = entorno((r) => {
    if (r.ruta.endsWith('/login')) return j({ usuario: { id: 'u1', nombre: 'N', email: 'a@b.test', rol: 'director', centroId: 'cen_1', refId: null }, csrfToken: 'tok', debeCambiarClave: true });
    if (r.ruta.endsWith('/restablecer')) return { status: 204 };
    if (r.ruta.includes('/respaldo/')) return j({ formato: 'educentro-respaldo', colecciones: { estudiantes: [{ id: 'a' }] } });
    return j({ id: 'x' }, 201);
  }, { rol: 'admin_red' });
  const s = await api.auth.login('a@b.test', 'x');
  assert.deepEqual(plano(s.usuario), { id: 'u1', nombre: 'N', email: 'a@b.test', rol: 'director', refId: null, centroUsuario: 'cen_1', debeCambiarClave: true });
  assert.equal(s.csrf, 'tok');
  await api.guardar('estudiantes', { nombre: 'x' });
  assert.equal(llamadas[1].cabeceras['X-EDU-CSRF'], 'tok');
  await api.auth.restablecer('t'.repeat(30), 'Clave-Nueva-2026');
  assert.deepEqual(Object.keys(llamadas[2].cuerpo), ['token', 'clave']);
  const t = await api.exportarTodo({ centroId: 'cen_1' });
  assert.equal(llamadas[3].q.get('centroId'), 'cen_1'); assert.equal(t.estudiantes.length, 1);
});
