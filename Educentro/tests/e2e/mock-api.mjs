#!/usr/bin/env node
// MOCK mínimo de la API REST de EduCentro (contrato /api/v1) para probar el cliente SIN el servidor real.
// En memoria, sin dependencias. Imita: cookie de sesión HttpOnly, CSRF (X-EDU-CSRF) y Origin, errores {error:{codigo,mensaje,campos?}},
// paginación {datos,total,siguiente}, If-Match, lote (upsert), 401/403/404/409/422/429/501 y aislamiento por centro.
// NO es el backend: la autorización de datos es una aproximación (permisos de escritura de js/core/permisos.js + centro). Los datos salen de
// la semilla demo (js/data/semilla.js). Solo para desarrollo: nunca lo expongas fuera de localhost.
//
//   node tests/e2e/mock-api.mjs [--puerto=3000]          (clave de todos los usuarios dev: env MOCK_CLAVE, def. Clave-Mock-Dev-2026)
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];
export const CLAVE_MOCK = process.env.MOCK_CLAVE || 'Clave-Mock-Dev-2026';
export const TOKEN_RESTABLECER_OK = 'tok-mock-valido-0123456789';
const CLAVE_MIN = 10, LIMITE_MAX = 500;
const LECTURA_RESTRINGIDA = {
  agenteConfig: ['admin_red', 'director', 'docente'], agenteLog: ['admin_red', 'director', 'docente', 'secretaria'],
  planes: ['admin_red', 'director', 'docente', 'secretaria'], secuencias: ['admin_red', 'director', 'docente', 'secretaria'], auditoria: ['admin_red', 'director'],
};

function cargarEntorno() {
  const ctx = { console, setTimeout, clearTimeout, addEventListener() {}, document: {}, navigator: {} };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['js/core/almacen.js', 'js/core/formato.js', 'js/core/escala.js', 'js/core/calculo.js', 'js/core/permisos.js', 'js/data/repo-local.js', 'js/data/curriculo-semilla.js', 'js/data/semilla.js']) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.EDU;
}

export function crearEstado() {
  const EDU = cargarEntorno();
  const datos = JSON.parse(JSON.stringify(EDU.semilla.generar()));
  const cols = new Set(EDU.repoLocal.COLECCIONES);
  const centroId = datos.centros[0].id;
  const docId = (datos.cargas.find((c) => c.centroId === centroId) || {}).docenteId || (datos.docentes[0] || {}).id;
  const estId = (datos.matriculas.find((m) => m.centroId === centroId && m.estado === 'activa') || {}).estudianteId || (datos.estudiantes[0] || {}).id;
  const tutor = datos.tutores.find((t) => (t.estudianteIds || []).length) || datos.tutores[0] || {};
  const ref = { docente: docId, estudiante: estId, tutor: tutor.id };
  const usuarios = ROLES.map((rol) => ({
    id: `usr_dev_${rol}`, nombre: `Usuario ${rol} (dev)`, email: `${rol.replace('_', '-')}@dev.educentro.test`, rol, refId: ref[rol] || null,
    centroId: rol === 'admin_red' ? null : centroId, debeCambiarClave: false, clave: CLAVE_MOCK, fallos: 0,
  }));
  usuarios.push({ id: 'usr_dev_cambio', nombre: 'Director con clave temporal (dev)', email: 'cambio@dev.educentro.test', rol: 'director', refId: null, centroId, debeCambiarClave: true, clave: CLAVE_MOCK, fallos: 0 });
  datos.usuarios = datos.usuarios.filter((u) => !usuarios.some((d) => d.email === u.email)).concat(usuarios.map(({ clave, fallos, debeCambiarClave, ...pub }) => pub));
  return { EDU, datos, cols, usuarios, sesiones: new Map(), seq: 0, auditoriaLog: [] };
}

const ahora = () => new Date().toISOString();
const sid = () => crypto.randomBytes(24).toString('base64url');
class Err extends Error { constructor(estado, codigo, mensaje, campos) { super(mensaje); this.estado = estado; this.codigo = codigo; this.campos = campos; } }

export function iniciarMock({ puerto = 3000, host = '127.0.0.1', log = false } = {}) {
  const st = crearEstado();
  const { EDU } = st;
  const COOKIE = 'edu_sid';

  const cabecerasBase = {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
  };
  const responder = (res, estado, cuerpo, extra = {}) => {
    const txt = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    const h = { ...cabecerasBase, ...extra }; if (!txt) delete h['Content-Type'];
    res.writeHead(estado, h);
    res.end(txt);
  };
  const leerCuerpo = (req) => new Promise((ok, ko) => {
    let n = 0; const trozos = [];
    req.on('data', (c) => { n += c.length; if (n > 1024 * 1024) { ko(new Err(413, 'demasiado_grande', 'Cuerpo demasiado grande.')); req.destroy(); } else trozos.push(c); });
    req.on('end', () => {
      if (!n) return ok(undefined);
      try { ok(JSON.parse(Buffer.concat(trozos).toString('utf8'))); } catch { ko(new Err(422, 'json_invalido', 'El cuerpo no es JSON válido.')); }
    });
    req.on('error', ko);
  });

  const cookieSid = (req) => /(?:^|;\s*)edu_sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const sesionDe = (req) => { const s = st.sesiones.get(cookieSid(req)); return s && s.expira > Date.now() ? s : null; };
  const exigirSesion = (req) => { const s = sesionDe(req); if (!s) throw new Err(401, 'no_autenticado', 'Sesión no válida o caducada.'); return s; };
  const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, refId: u.refId, centroUsuario: u.centroId, debeCambiarClave: !!u.debeCambiarClave });
  const abrirSesion = (res, u) => {
    const id = sid(), csrf = crypto.randomBytes(24).toString('base64url');
    st.sesiones.set(id, { id, usuario: u, csrf, expira: Date.now() + 12 * 3600e3 });
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`);
    return csrf;
  };

  const reg = (col, id) => st.datos[col].find((r) => r.id === id);
  const visible = (u, col, r) => col === 'centros' ? (u.rol === 'admin_red' || r.id === u.centroId) : (u.rol === 'admin_red' || r.centroId === u.centroId);
  const exigirLectura = (u, col) => { if (!st.cols.has(col)) throw new Err(404, 'no_encontrado', 'Colección desconocida.'); const l = LECTURA_RESTRINGIDA[col]; if (l && !l.includes(u.rol)) throw new Err(403, 'sin_permiso', 'Sin permiso.'); };
  const exigirEscritura = (u, col) => {
    if (!st.cols.has(col)) throw new Err(404, 'no_encontrado', 'Colección desconocida.');
    if (col === 'auditoria' || !EDU.permisos.puedeEscribirColeccion(u.rol, col)) throw new Err(403, 'sin_permiso', 'Sin permiso para esta operación.');
  };
  const limpiarEntrada = (c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Err(422, 'datos_invalidos', 'El cuerpo debe ser un objeto.', ['(cuerpo)']);
    const o = { ...c }; for (const k of ['creadoEn', 'actualizadoEn', 'borradoEn']) delete o[k];
    if (JSON.stringify(o).length > 256 * 1024) throw new Err(413, 'registro_demasiado_grande', 'El registro supera el máximo.');
    return o;
  };
  const centroEscritura = (u, col, o) => {
    if (col === 'centros') return undefined;
    if (u.rol !== 'admin_red') { if (o.centroId && o.centroId !== u.centroId) throw new Err(403, 'centro_no_permitido', 'Centro no permitido.'); return u.centroId; }
    if (!o.centroId && !(col === 'usuarios')) throw new Err(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
    return o.centroId;
  };
  const auditarCalif = (u, accion, col, id, antes, despues) => {
    if (col !== 'calificaciones' && col !== 'notasCompetencia') return;
    st.datos.auditoria.push({ id: `aud_${++st.seq}`, centroId: (despues || antes).centroId, usuarioId: u.id, rol: u.rol, accion, coleccion: col, registroId: id, antes, despues, fecha: ahora(), creadoEn: ahora(), actualizadoEn: ahora() });
  };
  const guardar = (u, col, modo, cuerpo, idUrl, ifMatch) => {
    const o = limpiarEntrada(cuerpo);
    if (modo === 'editar' && o.id !== undefined && o.id !== idUrl) throw new Err(422, 'id_inconsistente', 'El id del cuerpo no coincide con el de la URL.', ['id']);
    if (modo === 'upsert' && !o.id) throw new Err(422, 'datos_invalidos', 'Cada registro del lote debe traer su id.', ['id']);
    const id = modo === 'editar' ? idUrl : (o.id || `${col.slice(0, 3)}_${crypto.randomBytes(10).toString('hex')}`);
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(id)) throw new Err(422, 'datos_invalidos', 'El id no es válido.', ['id']);
    const antes = reg(col, id);
    if (antes && !visible(u, col, antes)) { if (modo === 'crear') throw new Err(409, 'ya_existe', 'Ya existe un registro con ese id.'); throw new Err(404, 'no_encontrado', 'Registro no encontrado.'); }
    if (modo === 'editar' && !antes) throw new Err(404, 'no_encontrado', 'Registro no encontrado.');
    if (modo === 'crear' && antes) throw new Err(409, 'ya_existe', 'Ya existe un registro con ese id.');
    const centro = centroEscritura(u, col, o);
    if (antes && col !== 'centros' && centro && antes.centroId !== centro) throw new Err(422, 'centro_inmutable', 'No se puede cambiar el centro de un registro.', ['centroId']);
    if (modo === 'editar' && ifMatch) {
      const t = Date.parse(ifMatch.replace(/^W\//, '').replace(/^"|"$/g, ''));
      if (Number.isNaN(t)) throw new Err(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
      if (new Date(t).toISOString() !== antes.actualizadoEn) throw new Err(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
    }
    if (col === 'usuarios' && u.rol !== 'admin_red' && (o.rol === 'admin_red' || antes?.rol === 'admin_red')) throw new Err(403, 'sin_permiso', 'Sin permiso para administrar usuarios admin_red.');
    const t = ahora();
    const nuevo = { ...o, id, ...(centro ? { centroId: centro } : {}), creadoEn: antes ? antes.creadoEn : t, actualizadoEn: t };
    if (antes) st.datos[col][st.datos[col].indexOf(antes)] = nuevo; else st.datos[col].push(nuevo);
    auditarCalif(u, antes ? 'editar' : 'crear', col, id, antes || null, nuevo);
    return { registro: nuevo, creado: !antes };
  };
  const filtrar = (u, col, q) => {
    let l = st.datos[col].filter((r) => visible(u, col, r));
    for (const [k, v] of q.entries()) {
      if (!k.startsWith('f.')) continue;
      const campo = k.slice(2), vals = q.getAll(k);
      if (campo === 'centroId' && u.rol !== 'admin_red') continue;
      l = l.filter((r) => vals.includes(String(r[campo])));
    }
    const orden = q.get('orden');
    if (orden && /^[A-Za-z][A-Za-z0-9_]*$/.test(orden)) {
      const d = q.get('desc') === 'true' ? -1 : 1;
      l = l.slice().sort((a, b) => (String(a[orden] ?? '') < String(b[orden] ?? '') ? -1 : String(a[orden] ?? '') > String(b[orden] ?? '') ? 1 : 0) * d);
    } else l = l.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    return l;
  };

  async function manejar(req, res) {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname, m = req.method;
    if (m === 'GET' && p === '/api/health') return responder(res, 200, { ok: true });
    if (!p.startsWith('/api/v1/')) throw new Err(404, 'no_encontrado', 'No encontrado.');
    const r = p.slice('/api/v1'.length);
    const seguro = m === 'GET' || m === 'HEAD';
    const origin = req.headers.origin;
    if (!seguro && origin && new URL(origin).host !== req.headers.host && !process.env.MOCK_ORIGENES?.split(',').includes(origin)) throw new Err(403, 'origen_no_permitido', 'Origen no permitido.');
    const cuerpo = seguro || m === 'DELETE' ? undefined : await leerCuerpo(req);
    const libreCsrf = ['/auth/login', '/auth/recuperar', '/auth/restablecer'].includes(r);
    let ses = null;
    if (!seguro && !libreCsrf) { ses = exigirSesion(req); if (req.headers['x-edu-csrf'] !== ses.csrf) throw new Err(403, 'csrf_invalido', 'Token CSRF inválido.'); }

    // ---- auth
    if (m === 'POST' && r === '/auth/login') {
      const { email, clave } = cuerpo || {};
      if (typeof email !== 'string' || typeof clave !== 'string') throw new Err(422, 'datos_invalidos', 'Correo y contraseña son obligatorios.', ['email', 'clave']);
      const u = st.usuarios.find((x) => x.email === email.trim().toLowerCase());
      if (u && u.fallos >= 5) throw new Err(429, 'demasiados_intentos', 'Demasiados intentos.');
      if (!u || u.clave !== clave) { if (u) u.fallos++; throw new Err(401, 'credenciales', 'Correo o contraseña incorrectos.'); }
      u.fallos = 0;
      const csrf = abrirSesion(res, u);
      return responder(res, 200, { usuario: publico(u), csrf });
    }
    if (m === 'POST' && r === '/auth/logout') { st.sesiones.delete(cookieSid(req)); return responder(res, 204, undefined, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }); }
    if (m === 'GET' && r === '/auth/me') { const s = exigirSesion(req); return responder(res, 200, { usuario: publico(s.usuario), csrf: s.csrf }); }
    if (m === 'POST' && r === '/auth/cambiar-clave') {
      const u = ses.usuario, { claveActual, claveNueva } = cuerpo || {};
      if (u.clave !== claveActual) throw new Err(401, 'credenciales', 'Contraseña actual incorrecta.');
      if (typeof claveNueva !== 'string' || claveNueva.length < CLAVE_MIN) throw new Err(422, 'clave_debil', `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`, ['claveNueva']);
      u.clave = claveNueva; u.debeCambiarClave = false;
      for (const [k, v] of st.sesiones) if (v.usuario === u) st.sesiones.delete(k); // rota: se revocan todas y se emite una nueva
      abrirSesion(res, u);
      return responder(res, 204);
    }
    if (m === 'POST' && r === '/auth/recuperar') return responder(res, 202, { ok: true });
    if (m === 'POST' && r === '/auth/restablecer') {
      const { token, claveNueva } = cuerpo || {};
      if (token !== TOKEN_RESTABLECER_OK) throw new Err(400, 'token_invalido', 'Enlace no válido o caducado.');
      if (typeof claveNueva !== 'string' || claveNueva.length < CLAVE_MIN) throw new Err(422, 'clave_debil', `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`, ['claveNueva']);
      return responder(res, 204);
    }

    // ---- datos
    ses = ses || exigirSesion(req);
    const u = ses.usuario;
    if (u.debeCambiarClave) throw new Err(403, 'cambio_clave_obligatorio', 'Debes cambiar tu contraseña.');
    let mt;
    if (m === 'POST' && r === '/auditoria') {
      if (!['admin_red', 'director', 'docente', 'secretaria'].includes(u.rol)) throw new Err(403, 'sin_permiso', 'Sin permiso.');
      const d = cuerpo || {};
      if (typeof d.accion !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/.test(d.accion)) throw new Err(422, 'datos_invalidos', 'Acción no válida.', ['accion']);
      const centro = u.rol === 'admin_red' ? d.centroId : u.centroId;
      if (!centro) throw new Err(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
      const a = { ...d, id: `aud_${++st.seq}`, centroId: centro, usuarioId: u.id, rol: u.rol, fecha: ahora(), creadoEn: ahora(), actualizadoEn: ahora() };
      st.datos.auditoria.push(a); return responder(res, 201, a);
    }
    if (m === 'GET' && r === '/auditoria') {
      if (!['admin_red', 'director'].includes(u.rol)) throw new Err(403, 'sin_permiso', 'Sin permiso.');
      return responder(res, 200, { datos: filtrar(u, 'auditoria', url.searchParams), total: 0, siguiente: null });
    }
    if ((mt = /^\/comunicados\/([^/]+)\/lectura$/.exec(r)) && m === 'POST') {
      const c = reg('comunicados', decodeURIComponent(mt[1]));
      if (!c || !visible(u, 'comunicados', c) || c.estado !== 'publicado') throw new Err(404, 'no_encontrado', 'Comunicado no disponible.');
      c.lecturas = Array.isArray(c.lecturas) ? c.lecturas : [];
      if (!c.lecturas.some((l) => l.usuarioId === u.id)) c.lecturas.push({ usuarioId: u.id, fecha: ahora() });
      c.actualizadoEn = ahora();
      return responder(res, 200, c);
    }
    if (m === 'GET' && r === '/respaldo/exportar') {
      if (!['admin_red', 'director'].includes(u.rol)) throw new Err(403, 'sin_permiso', 'Sin permiso.');
      const out = {}; for (const c of st.cols) out[c] = st.datos[c].filter((x) => visible(u, c, x) && (c !== 'auditoria' || ['admin_red', 'director'].includes(u.rol)));
      return responder(res, 200, { datos: out });
    }
    if (m === 'POST' && r === '/respaldo/importar') throw new Err(501, 'no_implementado', 'Disponible en la Fase 5.');

    if ((mt = /^\/c\/([A-Za-z]+)(?:\/([^/]+))?$/.exec(r))) {
      const col = mt[1], id = mt[2] && decodeURIComponent(mt[2]);
      if (m === 'GET' && !id) {
        exigirLectura(u, col);
        const l = filtrar(u, col, url.searchParams);
        const lim = Math.min(Math.max(parseInt(url.searchParams.get('limite') || '100', 10) || 100, 1), LIMITE_MAX), off = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
        const datos = l.slice(off, off + lim);
        return responder(res, 200, { datos, total: l.length, siguiente: off + datos.length < l.length ? off + datos.length : null });
      }
      if (m === 'GET') { exigirLectura(u, col); const x = reg(col, id); if (!x || !visible(u, col, x)) throw new Err(404, 'no_encontrado', 'Registro no encontrado.'); return responder(res, 200, x); }
      if (m === 'POST' && !id) { exigirEscritura(u, col); return responder(res, 201, guardar(u, col, 'crear', cuerpo).registro); }
      if (m === 'PUT' && id) { exigirEscritura(u, col); return responder(res, 200, guardar(u, col, 'editar', cuerpo, id, req.headers['if-match']).registro); }
      if (m === 'DELETE' && id) {
        exigirEscritura(u, col);
        const x = reg(col, id); if (!x || !visible(u, col, x)) throw new Err(404, 'no_encontrado', 'Registro no encontrado.');
        st.datos[col].splice(st.datos[col].indexOf(x), 1); auditarCalif(u, 'borrar', col, id, x, null);
        return responder(res, 204);
      }
    }
    if ((mt = /^\/c\/([A-Za-z]+)\/lote$/.exec(r)) && m === 'POST') {
      exigirEscritura(u, mt[1]);
      const rs = cuerpo && cuerpo.registros;
      if (!Array.isArray(rs) || !rs.length) throw new Err(422, 'datos_invalidos', 'registros debe ser una lista no vacía.', ['registros']);
      if (rs.length > LIMITE_MAX) throw new Err(422, 'lote_demasiado_grande', `Máximo ${LIMITE_MAX} registros por lote.`, ['registros']);
      return responder(res, 200, { datos: rs.map((x) => guardar(u, mt[1], 'upsert', x).registro) });
    }
    throw new Err(404, 'no_encontrado', 'No encontrado.');
  }

  const server = http.createServer((req, res) => {
    manejar(req, res).catch((e) => {
      if (!(e instanceof Err)) { if (log) console.error(e); e = new Err(500, 'error_interno', 'Error interno.'); }
      if (!res.headersSent) responder(res, e.estado, { error: { codigo: e.codigo, mensaje: e.message, ...(e.campos ? { campos: e.campos } : {}) } });
    });
  });
  const listo = new Promise((ok) => server.listen(puerto, host, () => ok(server.address().port)));
  return { server, estado: st, listo, cerrar: () => new Promise((ok) => server.close(ok)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = process.argv.find((a) => a.startsWith('--puerto='));
  const puerto = Number(arg ? arg.split('=')[1] : process.env.MOCK_PORT || 3000);
  const mock = iniciarMock({ puerto, log: true });
  mock.listo.then((pt) => {
    console.log(`Mock de la API en http://127.0.0.1:${pt}/api/v1  (solo desarrollo)`);
    console.log(`Usuarios: <rol>@dev.educentro.test (admin-red, director, docente, secretaria, tutor, estudiante) y cambio@dev.educentro.test (cambio de clave obligatorio); clave: ${CLAVE_MOCK}`);
    console.log(`Token válido de restablecimiento: ${TOKEN_RESTABLECER_OK}`);
  });
}
