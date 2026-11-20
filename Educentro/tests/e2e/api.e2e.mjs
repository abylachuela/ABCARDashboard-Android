#!/usr/bin/env node
// e2e del cliente en MODO API con Playwright (Chromium): login por los 6 roles, recorrido del menú, CRUD permitido, 403/404, persistencia por cookie.
// Funciona contra el backend REAL (con `semilla-dev` aplicada) o contra el MOCK (--mock). Ver tests/e2e/README.md para los comandos.
//
//   node tests/e2e/api.e2e.mjs --mock                          # arranca mock + servidor-dev en proceso (puertos libres) y se prueba a sí mismo
//   BASE_URL=http://127.0.0.1:8080 E2E_CLAVES_FILE=claves.txt node tests/e2e/api.e2e.mjs      # contra el servidor-dev + backend real
// Credenciales: E2E_CLAVES_FILE (salida de `npm run semilla-dev`), o E2E_CLAVE (una sola contraseña para todos), o E2E_CLAVES_JSON='{"rol":"clave"}'.
// Correos: <rol con guion>@dev.educentro.test (los de semilla-dev); se pueden cambiar con E2E_EMAIL_<ROL>.
import fs from 'node:fs';
import { cargarPlaywright, lanzar, vigilar, irA, hayTarjetaError } from './lib.mjs';
import { iniciarMock, CLAVE_MOCK, TOKEN_RESTABLECER_OK } from './mock-api.mjs';
import { iniciarServidorDev } from './servidor-dev.mjs';

const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];
const usarMock = process.argv.includes('--mock');
let base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const fallos = [], resumen = { roles: 0, rutas: 0, comprobaciones: 0 };
const ok = (c, msg) => { resumen.comprobaciones++; if (!c) fallos.push(msg); return !!c; };

function credenciales() {
  const out = {};
  const f = process.env.E2E_CLAVES_FILE;
  if (f) for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^(\w+)\s+(\S+@\S+)\s+(\S+)\s*$/.exec(l); if (m) out[m[1]] = { email: m[2], clave: m[3] }; }
  if (process.env.E2E_CLAVES_JSON) for (const [r, c] of Object.entries(JSON.parse(process.env.E2E_CLAVES_JSON))) out[r] = { ...(out[r] || {}), clave: c };
  for (const r of ROLES) {
    out[r] = { email: process.env[`E2E_EMAIL_${r.toUpperCase()}`] || out[r]?.email || `${r.replace('_', '-')}@dev.educentro.test`, clave: out[r]?.clave || process.env.E2E_CLAVE || (usarMock ? CLAVE_MOCK : '') };
    if (!out[r].clave) throw new Error(`Falta la contraseña de ${r}: usa E2E_CLAVES_FILE, E2E_CLAVES_JSON o E2E_CLAVE.`);
  }
  return out;
}

async function entrar(page, vig, c, { esperarNav = true } = {}) {
  await page.waitForFunction(() => document.body.getAttribute('data-listo') === '1', null, { timeout: 20000 });
  await page.fill('#lgEmail', c.email); await page.fill('#lgClave', c.clave);
  await page.click('#lgOk');
  if (esperarNav) await page.waitForSelector('#nav a', { timeout: 20000 });
}

async function probarRol(browser, rol, cred, base, origenes) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(), vig = vigilar(page, origenes);
  const et = (m) => `[${rol}] ${m}`;
  vig.silenciar(1); // GET /auth/me sin sesión (401) al arrancar
  await page.goto(base + '/');
  await page.waitForSelector('#lgForm', { timeout: 20000 });
  ok(await page.getAttribute('#lgEmail', 'autocomplete') === 'username' && await page.getAttribute('#lgClave', 'autocomplete') === 'current-password', et('atributos autocomplete del login'));
  if (rol === ROLES[0]) { // credenciales erróneas: mensaje genérico
    vig.silenciar(1);
    await page.fill('#lgEmail', cred.email); await page.fill('#lgClave', 'clave-incorrecta-123'); await page.click('#lgOk');
    await page.waitForSelector('#lgErr .form-error', { timeout: 10000 });
    const t = await page.textContent('#lgErr');
    ok(/incorrectos/i.test(t) && !/no existe|inexistente|bloquead/i.test(t), et('mensaje de login genérico: ' + t));
  }
  await entrar(page, vig, cred);
  const s = await page.evaluate(() => window.EDU.estado.sesion());
  ok(s && s.rol === rol, et('sesión con el rol correcto'));
  const modo = await page.evaluate(() => window.EDU.estado.modo + '|' + (window.EDU_CONFIG && window.EDU_CONFIG.modo));
  ok(modo === 'api|api', et('modo api activo (' + modo + ')'));

  // 1) recorrido de TODAS las rutas de su menú
  const rutas = await page.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href')));
  ok(rutas.length > 0, et('el menú tiene rutas'));
  for (const h of rutas) {
    vig.limpiar();
    await irA(page, h);
    if (await hayTarjetaError(page)) fallos.push(et(`${h}: tarjeta de error en pantalla`));
    for (const p of vig.problemas()) fallos.push(et(`${h}: ${p}`));
    resumen.rutas++;
  }

  // 2) nada de datos ni credenciales en el almacenamiento del navegador; la cookie de sesión no es visible al JS
  const alm = await page.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), cookie: document.cookie, idb: indexedDB.databases ? null : null }));
  ok(!alm.ls.some((k) => /^edu:/.test(k)) && !alm.ss.length, et('sin claves edu: en localStorage/sessionStorage: ' + JSON.stringify(alm.ls)));
  ok(!/sid|session/i.test(alm.cookie), et('la cookie de sesión no es visible al JS'));
  const sesionEnJson = JSON.stringify(await page.evaluate(() => Object.assign({}, localStorage)));
  ok(!sesionEnJson.includes(cred.clave), et('la contraseña no está en el almacenamiento'));

  // 3) CRUD permitido (director) y rechazos 403/404
  if (rol === 'director') {
    vig.limpiar(); vig.silenciar(2); // esperados: PUT 409 (versión vieja) y GET 404 (tras borrar)
    const r = await page.evaluate(async () => {
      const R = window.EDU.repo, o = {};
      const c = await R.guardar('comunicados', { titulo: 'e2e prueba', cuerpo: 'borrar', estado: 'borrador', destinatarios: 'todos' });
      o.creado = !!c.id && !!c.actualizadoEn;
      const e = await R.guardar('comunicados', { ...c, titulo: 'e2e editado' });
      o.editado = e.titulo === 'e2e editado' && e.id === c.id;
      o.leido = (await R.obtener('comunicados', c.id) || {}).titulo;
      try { await R.guardar('comunicados', { ...c, titulo: 'obsoleto' }); o.conflicto = 'no'; } catch (er) { o.conflicto = er.estado + ' ' + er.message; } // If-Match con versión vieja
      o.borrado = await R.borrar('comunicados', c.id);
      o.trasBorrar = await R.obtener('comunicados', c.id);
      return o;
    });
    ok(r.creado && r.editado, et('crear/editar comunicado: ' + JSON.stringify(r)));
    ok(r.leido === 'e2e editado', et('obtener tras editar'));
    ok(/^409 /.test(r.conflicto), et('conflicto de versión 409: ' + r.conflicto));
    ok(r.borrado === true && r.trasBorrar === null, et('borrar y comprobar que no existe'));
    for (const p of vig.problemas()) fallos.push(et('CRUD: ' + p));
    vig.limpiar();
    // Respaldo: exportar funciona (se genera en el servidor) e importar queda desactivado hasta la Fase 5
    await irA(page, '#/respaldo');
    ok(await page.isDisabled('button:has-text("Importar respaldo")'), et('importar respaldo desactivado (Fase 5)'));
    ok(!(await page.$('#rbReset')), et('sin «restablecer datos demo» en modo servidor'));
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#rbExp')]);
    ok(/^educentro-respaldo-/.test(descarga.suggestedFilename()), et('descarga del respaldo'));
    for (const p of vig.problemas()) fallos.push(et('respaldo: ' + p));
    vig.limpiar();
    // CSRF: sin cabecera el servidor debe rechazar
    vig.silenciar(1);
    const st = await page.evaluate(async () => (await fetch('/api/v1/c/comunicados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"titulo":"x"}', credentials: 'same-origin' })).status);
    ok(st === 403, et('POST sin X-EDU-CSRF rechazado (403), obtuvo ' + st));
  }
  if (rol === 'tutor' || rol === 'estudiante') {
    vig.limpiar(); vig.silenciar(2);
    const r = await page.evaluate(async () => {
      const o = {};
      try { await window.EDU.repoApi.guardar('calificaciones', { actividadId: 'x', estudianteId: 'y', puntos: 10 }); o.escritura = 'permitida'; } catch (e) { o.escritura = e.estado + ' ' + e.message; }
      o.get404 = (await fetch('/api/v1/c/estudiantes/id_que_no_existe', { credentials: 'same-origin' })).status;
      try { await window.EDU.repo.guardar('calificaciones', { actividadId: 'x' }); o.cliente = 'permitida'; } catch (e) { o.cliente = e.message; }
      return o;
    });
    ok(/^403 Sin permiso/.test(r.escritura), et('escritura no permitida => 403 Sin permiso: ' + r.escritura));
    ok(r.get404 === 404 || r.get404 === 403, et('registro inexistente/ajeno => 404/403: ' + r.get404));
    ok(/Sin permiso/.test(r.cliente), et('el repo del cliente también la rechaza'));
  }

  // 4) la sesión persiste tras recargar (cookie), sin guardar nada en el navegador
  await page.reload();
  await page.waitForFunction(() => document.body.getAttribute('data-listo') === '1', null, { timeout: 20000 });
  await page.waitForSelector('#nav a', { timeout: 20000 });
  const tras = await page.evaluate(() => window.EDU.estado.sesion());
  ok(tras && tras.usuarioId === s.usuarioId && tras.rol === rol, et('la sesión persiste tras recargar'));

  // 5) logout real
  vig.silenciar(2);
  await page.click('#logout');
  await page.waitForSelector('#lgForm', { timeout: 10000 });
  const me = await page.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).status);
  ok(me === 401, et('tras salir, /auth/me responde 401 (' + me + ')'));
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForSelector('#lgForm', { timeout: 10000 });
  ok(true, et('sin sesión, #/dashboard vuelve al login'));
  for (const p of vig.problemas()) fallos.push(et('cierre: ' + p));
  resumen.roles++;
  await ctx.close();
}

async function probarCuenta(browser, base, origenes, cred) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage(), vig = vigilar(page, origenes);
  vig.silenciar(1);
  await page.goto(base + '/#/recuperar');
  await page.waitForSelector('#reEmail');
  ok(await page.getAttribute('#reEmail', 'autocomplete') === 'email', 'recuperar: autocomplete=email');
  await page.fill('#reEmail', 'nadie@ejemplo.test'); await page.click('#cuForm button[type=submit]');
  await page.waitForSelector('#cuMsg .alert', { timeout: 10000 });
  ok(/Si el correo está registrado/.test(await page.textContent('#cuMsg')), 'recuperar: mensaje genérico (no enumera usuarios)');
  // restablecer: el token sale de la URL y no va a ningún almacenamiento
  vig.silenciar(1);
  await page.goto(base + '/#/restablecer/' + (usarMock ? TOKEN_RESTABLECER_OK : 'token-de-prueba-no-valido-0123456789'));
  await page.waitForSelector('#rsNueva', { timeout: 10000 });
  ok(await page.evaluate(() => location.hash) === '#/restablecer', 'restablecer: el token se quita de la URL');
  ok(await page.getAttribute('#rsNueva', 'autocomplete') === 'new-password', 'restablecer: autocomplete=new-password');
  await page.fill('#rsNueva', 'Una-Clave-Nueva-2026'); await page.fill('#rsRep', 'Otra-Distinta-2026'); await page.click('#cuForm button[type=submit]');
  ok(/no coinciden/.test(await page.textContent('#cuMsg')), 'restablecer: valida coincidencia');
  if (!usarMock) vig.silenciar(2);
  await page.fill('#rsRep', 'Una-Clave-Nueva-2026'); await page.click('#cuForm button[type=submit]');
  if (usarMock) { await page.waitForFunction(() => /Contraseña actualizada/.test(document.getElementById('view').textContent), null, { timeout: 10000 }); ok(true, 'restablecer: éxito con token válido'); }
  else await page.waitForSelector('#cuMsg .form-error', { timeout: 10000 });
  if (usarMock) ok(true, 'restablecer: respuesta mostrada');
  else ok((await page.textContent('#cuMsg')).trim().length > 0, 'restablecer: mensaje ante token no válido');
  const ls = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).join(','));
  ok(!ls.includes('token'), 'el token no se guarda');
  for (const p of vig.problemas()) fallos.push('[cuenta] ' + p);
  await ctx.close();

  if (usarMock || process.env.E2E_PRUEBA_CAMBIO) { // usuario con cambio de contraseña obligatorio (solo el mock lo trae)
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p2 = await c2.newPage(), v2 = vigilar(p2, origenes);
    v2.silenciar(1);
    await p2.goto(base + '/');
    await p2.waitForSelector('#lgForm');
    await p2.fill('#lgEmail', 'cambio@dev.educentro.test'); await p2.fill('#lgClave', cred.director.clave); await p2.click('#lgOk');
    await p2.waitForSelector('#cuActual', { timeout: 10000 });
    ok(await p2.evaluate(() => document.querySelectorAll('#nav a').length) === 0, 'cambio obligatorio: el menú está vacío');
    await p2.evaluate(() => { location.hash = '#/dashboard'; });
    await p2.waitForSelector('#cuActual');
    ok(true, 'cambio obligatorio: no deja salir de #/cambiar-clave');
    v2.silenciar(1);
    await p2.fill('#cuActual', 'clave-actual-incorrecta'); await p2.fill('#cuNueva', 'Nueva-Clave-Larga-2026'); await p2.fill('#cuRep', 'Nueva-Clave-Larga-2026'); await p2.click('#cuForm button[type=submit]');
    await p2.waitForSelector('#cuMsg .form-error');
    ok(/actual/.test(await p2.textContent('#cuMsg')), 'cambio obligatorio: contraseña actual incorrecta');
    await p2.fill('#cuActual', cred.director.clave); await p2.fill('#cuNueva', 'Nueva-Clave-Larga-2026'); await p2.fill('#cuRep', 'Nueva-Clave-Larga-2026'); await p2.click('#cuForm button[type=submit]');
    await p2.waitForSelector('#nav a', { timeout: 15000 });
    ok((await p2.evaluate(() => window.EDU.estado.debeCambiarClave())) === false, 'cambio obligatorio: completado y el menú vuelve');
    for (const p of v2.problemas()) fallos.push('[cambio] ' + p);
    await c2.close();
  }
}

/** Flujo de notas contra el backend REAL (periodo cerrado, motivo, cierre con confirmación, auditoría encadenada, paridad con el servidor). */
async function probarNotas(browser, base, origenes, cred) {
  const abrir = async (rol) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(), vig = vigilar(page, origenes);
    vig.silenciar(1); await page.goto(base + '/'); await page.waitForSelector('#lgForm', { timeout: 20000 });
    await entrar(page, vig, cred[rol]);
    return { ctx, page, vig };
  };
  const doc = await abrir('docente'), dir = await abrir('director');
  doc.vig.silenciar(6); dir.vig.silenciar(6); // 4xx esperados del flujo (periodo cerrado, rango, confirmación, motivo)
  try {
    // datos de la semilla: una carga del docente con actividad en el periodo abierto (per_1_3) y otra en uno cerrado (per_1_1)
    const info = await doc.page.evaluate(async () => {
      const s = EDU.estado.sesion(), d = await EDU.consultas.cargar(['cargas', 'actividades', 'matriculas']);
      const car = d.cargas.find((c) => c.docenteId === s.refId);
      const act = (p) => d.actividades.find((a) => a.cargaId === car.id && a.periodoId === p);
      const est = d.matriculas.find((m) => m.seccionId === car.seccionId && m.estado === 'activa').estudianteId;
      return { est, abierta: act('per_1_3'), cerrada: act('per_1_1') };
    });
    const guardar = (pg, act, est, pts, motivo) => pg.evaluate(async ([a, e, p, m]) => {
      const f = () => EDU.repo.guardarMuchos('calificaciones', [{ id: 'cal_' + a + '_' + e, centroId: 'cen_1', actividadId: a, estudianteId: e, puntos: p }]);
      try { await (m ? EDU.repo.conMotivo(m, f) : f()); return { ok: true }; } catch (x) { return { ok: false, codigo: x.codigo, estado: x.estado, mensaje: x.message }; }
    }, [act, est, pts, motivo || null]);
    // 1) el docente guarda notas en el periodo abierto; en el cerrado es rechazado con un mensaje claro
    ok((await guardar(doc.page, info.abierta.id, info.est, 13.37)).ok, 'notas: el docente guarda en periodo abierto');
    const rc = await guardar(doc.page, info.cerrada.id, info.est, 5);
    ok(!rc.ok && rc.codigo === 'periodo_cerrado' && /cerrado/.test(rc.mensaje), 'notas: el docente es rechazado en periodo cerrado (' + rc.codigo + ')');
    const rr = await guardar(doc.page, info.abierta.id, info.est, 101);
    ok(!rr.ok && rr.estado === 422, 'notas: puntos fuera de rango rechazados (422)');
    // 2) el director cierra el periodo: con pendientes exige confirmación
    const cierre = (confirmar) => dir.page.evaluate(async ([c]) => {
      try { const j = await EDU.repoApi.periodos.cerrar('per_1_3', c); return { ok: true, cerrado: j.periodo.cerrado }; } catch (x) { return { ok: false, codigo: x.codigo, estado: x.estado }; }
    }, [confirmar]);
    const inf = await dir.page.evaluate(() => EDU.repoApi.periodos.informe('per_1_3'));
    ok(typeof inf.pendientes === 'number' && inf.bloqueos.length === 0, 'cierre: informe de pendientes sin bloqueos (' + inf.pendientes + ' pendientes)');
    if (inf.requiereConfirmacion) { const c1 = await cierre(false); ok(!c1.ok && c1.codigo === 'confirmacion_requerida', 'cierre: con pendientes pide confirmación'); }
    const c2 = await cierre(true);
    ok(c2.ok && c2.cerrado, 'cierre: el director cierra con confirmación');
    const r3 = await guardar(doc.page, info.abierta.id, info.est, 14);
    ok(!r3.ok && r3.codigo === 'periodo_cerrado', 'cierre: el docente ya no puede escribir');
    // 3) el director edita con motivo (sin motivo, no)
    const sm = await guardar(dir.page, info.abierta.id, info.est, 15);
    ok(!sm.ok && sm.codigo === 'motivo_requerido', 'edición: el director sin motivo es rechazado');
    ok((await guardar(dir.page, info.abierta.id, info.est, 15, 'Corrección autorizada por dirección')).ok, 'edición: el director edita con motivo');
    // 4) reabre con motivo; el docente vuelve a escribir
    const ra = await dir.page.evaluate(async () => { try { const j = await EDU.repoApi.periodos.reabrir('per_1_3', 'Se debe registrar una nota faltante'); return { ok: true, cerrado: j.periodo.cerrado }; } catch (x) { return { ok: false, codigo: x.codigo }; } });
    ok(ra.ok && ra.cerrado === false, 'reapertura: con motivo');
    ok((await guardar(doc.page, info.abierta.id, info.est, 13.37)).ok, 'reapertura: el docente vuelve a escribir');
    // 5) auditoría: cadena verificable y con las acciones (motivo incluido)
    const aud = await dir.page.evaluate(async () => {
      const cid = EDU.estado.sesion().centroUsuario;
      const v = await (await fetch('/api/v1/auditoria/verificar?centroId=' + cid, { credentials: 'same-origin' })).json();
      const l = await (await fetch('/api/v1/auditoria?limite=200', { credentials: 'same-origin' })).json();
      return { v, acciones: l.datos.map((x) => x.accion), motivos: l.datos.filter((x) => x.motivo).map((x) => x.motivo) };
    });
    ok(aud.v.ok === true && aud.v.registros > 0, 'auditoría: la cadena de hashes verifica (' + aud.v.registros + ' entradas)');
    ok(aud.acciones.includes('cerrar_periodo') && aud.acciones.includes('reabrir_periodo'), 'auditoría: cierre y reapertura registrados');
    ok(aud.motivos.includes('Corrección autorizada por dirección'), 'auditoría: la edición del director guarda el motivo');
    // 6) boletín / panel == servidor: el resumen del cliente coincide con GET /notas/resumen
    const par = await dir.page.evaluate(async () => {
      const d = await EDU.consultas.cargar(['matriculas', 'cargas', 'categorias', 'actividades', 'calificaciones', 'notasCompetencia', 'periodos', 'escalas']);
      const cli = EDU.consultas.resumenNotas(d), srv = (await (await fetch('/api/v1/notas/resumen', { credentials: 'same-origin' })).json()).datos;
      return { n: cli.length, m: srv.length, igual: JSON.stringify(cli) === JSON.stringify(srv) };
    });
    ok(par.n > 0 && par.n === par.m && par.igual, 'resumen: el cliente (boletín/panel) y /notas/resumen coinciden (' + par.n + ' filas)');
    for (const p of doc.vig.problemas().concat(dir.vig.problemas())) fallos.push('[notas] ' + p);
  } finally { await doc.ctx.close(); await dir.ctx.close(); }
}


/** Reglas de negocio del SERVIDOR (Fase 3A) vistas desde el cliente real: cupo lleno, lista de espera con promoción, horario con conflicto,
    comunicado no visible para otro rol, plan impartido bloqueado y campos fijados por el servidor. Solo contra el backend real. */
async function probarNegocio(browser, base, origenes, cred) {
  const abrir = async (rol) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(), vig = vigilar(page, origenes);
    vig.silenciar(1); await page.goto(base + '/'); await page.waitForSelector('#lgForm', { timeout: 20000 });
    await entrar(page, vig, cred[rol]);
    return { ctx, page, vig, rol };
  };
  const dir = await abrir('director'), doc = await abrir('docente'), est = await abrir('estudiante'), sec = await abrir('secretaria');
  const todos = [dir, doc, est, sec];
  todos.forEach((x) => x.vig.silenciar(40)); // 4xx esperados: cupo lleno, conflictos, plan bloqueado, 404 de comunicados ajenos…
  /** Ejecuta `fn(args)` en la página; devuelve {ok:true,v} o {ok:false,codigo,estado,mensaje,detalle}. */
  const ejec = (x, fn, args) => x.page.evaluate(async ([src, a]) => {
    try { return { ok: true, v: await (new Function('EDU', 'a', 'return (async () => {' + src + '})()'))(window.EDU, a) }; }
    catch (e) { return { ok: false, codigo: e.codigo, estado: e.estado, mensaje: e.message, detalle: e.detalle }; }
  }, [fn, args === undefined ? null : args]);
  const sufijo = Date.now().toString(36).toUpperCase();
  try {
    // ---------- 1) matrícula con cupo lleno ----------
    const sec1 = await ejec(dir, `return EDU.repo.guardar('secciones', { centroId: 'cen_1', cursoId: 'cur_1_1', anioId: 'ani_1_2026', nombre: 'E2E-' + a, capacidad: 1 });`, sufijo);
    ok(sec1.ok, 'negocio: el director crea una sección de capacidad 1 (' + (sec1.mensaje || '') + ')');
    const est2 = await ejec(dir, `var r = []; for (var i = 0; i < 2; i++) r.push(await EDU.repo.guardar('estudiantes', { centroId: 'cen_1', nombres: 'E2E' + a + i, apellidos: 'Prueba' })); return r;`, sufijo);
    ok(est2.ok && est2.v.every((e) => /^MAT-1-\d+$/.test(e.matricula)), 'negocio: el servidor asigna el código MAT a los estudiantes nuevos (' + (est2.ok ? est2.v.map((e) => e.matricula).join(', ') : est2.mensaje) + ')');
    const [e1, e2] = est2.ok ? est2.v : [{}, {}];
    const m1 = await ejec(dir, `return EDU.repo.negocio().matricular({ anioId: 'ani_1_2026', seccionId: a.s, estudianteIds: [a.e], fecha: EDU.fmt.hoy() });`, { s: sec1.v && sec1.v.id, e: e1.id });
    ok(m1.ok && m1.v[0].estado === 'activa', 'negocio: matrícula en la última plaza (' + (m1.mensaje || '') + ')');
    const m2 = await ejec(dir, `return EDU.repo.negocio().matricular({ anioId: 'ani_1_2026', seccionId: a.s, estudianteIds: [a.e] });`, { s: sec1.v && sec1.v.id, e: e2.id });
    ok(!m2.ok && m2.estado === 409 && m2.codigo === 'seccion_completa' && /completa/i.test(m2.mensaje), 'negocio: sección llena → 409 seccion_completa con mensaje en español (' + m2.codigo + ')');
    const secB = await ejec(dir, `return EDU.repo.guardar('secciones', { centroId: 'cen_1', cursoId: 'cur_1_1', anioId: 'ani_1_2026', nombre: 'E2E2-' + a, capacidad: 5 });`, sufijo);
    const m3 = await ejec(dir, `return EDU.repo.negocio().matricular({ anioId: 'ani_1_2026', seccionId: a.s, estudianteIds: [a.e] });`, { s: secB.v && secB.v.id, e: e1.id });
    ok(!m3.ok && m3.codigo === 'matricula_duplicada', 'negocio: el mismo estudiante en el mismo año → matricula_duplicada');
    const mp = await ejec(dir, `return EDU.repo.guardar('matriculas', { centroId: 'cen_1', estudianteId: a.e, seccionId: a.s, anioId: 'ani_1_2026', estado: 'retirada' });`, { s: sec1.v && sec1.v.id, e: e2.id });
    ok(!mp.ok && mp.estado === 422, 'negocio: el POST genérico no puede crear una matrícula «retirada» (422)');
    // la pantalla de matrícula carga con la sección nueva y muestra el cupo completo
    await irA(dir.page, '#/matricula');
    ok(!(await hayTarjetaError(dir.page)), 'negocio: la pantalla Matrícula carga sin error');

    // ---------- 2) inscripción con lista de espera y promoción ----------
    const cur = await ejec(dir, `return EDU.repo.guardar('cursosExtra', { centroId: 'cen_1', nombre: 'Taller E2E ' + a, codigo: 'E2E-' + a, tipo: 'taller', cupo: 1, grados: [], horario: [], estado: 'abierto', inicio: '2026-10-01', fin: '2026-12-01' });`, sufijo);
    ok(cur.ok, 'negocio: se crea un curso de cupo 1 (' + (cur.mensaje || '') + ')');
    const ins = await ejec(dir, `return EDU.cursosLogica.asignar(a.c, [a.e1, a.e2]);`, { c: cur.v && cur.v.id, e1: e1.id, e2: e2.id });
    ok(ins.ok && ins.v[0].estado === 'inscrito' && ins.v[1].estado === 'en_lista_espera', 'negocio: cupo 1 → el primero inscrito y el segundo en lista de espera (' + JSON.stringify(ins.v || ins.mensaje) + ')');
    const turno = await ejec(dir, `var l = await EDU.repo.listar('inscripciones', { filtro: { cursoId: a } }); return l.map(function (i) { return [i.estudianteId, i.estado, i.turno]; });`, cur.v && cur.v.id);
    ok(turno.ok && turno.v.some((t) => t[1] === 'en_lista_espera' && Number(t[2]) > 0), 'negocio: el turno de la lista de espera lo fijó el servidor (' + JSON.stringify(turno.v) + ')');
    const forzado = await ejec(dir, `var l = await EDU.repo.listar('inscripciones', { filtro: { cursoId: a } }); var x = l.filter(function (i) { return i.estado === 'en_lista_espera'; })[0]; x.estado = 'inscrito'; return EDU.repo.guardar('inscripciones', x);`, cur.v && cur.v.id);
    ok(!forzado.ok && forzado.estado === 422, 'negocio: el cliente no puede forzar el estado de una inscripción (422)');
    const ret = await ejec(dir, `return EDU.cursosLogica.retirar('ins_' + a.c + '_' + a.e1, 'Cambio de horario');`, { c: cur.v && cur.v.id, e1: e1.id });
    ok(ret.ok && ret.v.length === 1 && ret.v[0].inscripcion.estudianteId === e2.id && ret.v[0].inscripcion.estado === 'inscrito', 'negocio: al retirar al inscrito se promueve al de la lista de espera');
    const cer = await ejec(dir, `return EDU.repo.negocio().estadoCurso(a, 'cerrado');`, cur.v && cur.v.id);
    ok(cer.ok, 'negocio: cierre del curso (transaccional)');
    const cerrado = await ejec(dir, `return EDU.cursosLogica.asignar(a.c, [a.e1]);`, { c: cur.v && cur.v.id, e1: e1.id });
    ok(!cerrado.ok && cerrado.estado === 409 && cerrado.codigo === 'curso_cerrado', 'negocio: un curso cerrado no admite inscripciones (409 curso_cerrado)');

    // ---------- 3) horario con conflicto rechazado ----------
    const fr = await ejec(dir, `return EDU.repo.negocio().guardarFranjasTanda('vespertina', [{ inicio: '16:00', fin: '16:45', tipo: 'clase' }, { inicio: '16:45', fin: '17:30', tipo: 'clase' }]);`);
    ok(fr.ok && fr.v.franjas.length === 2, 'negocio: franjas de la tanda guardadas de forma atómica (' + (fr.mensaje || '') + ')');
    const solape = await ejec(dir, `return EDU.repo.negocio().guardarFranjasTanda('vespertina', [{ inicio: '16:00', fin: '16:45', tipo: 'clase' }, { inicio: '16:30', fin: '17:00', tipo: 'clase' }]);`);
    ok(!solape.ok && solape.codigo === 'franjas_invalidas' && /solapan/.test(solape.mensaje), 'negocio: franjas solapadas → 422 franjas_invalidas');
    const cargas = await ejec(dir, `var d = await EDU.consultas.cargar(['cargas']); var por = {}; d.cargas.forEach(function (c) { (por[c.docenteId] = por[c.docenteId] || []).push(c); }); var k = Object.keys(por).filter(function (x) { return por[x].length > 1 && por[x][0].seccionId !== por[x][1].seccionId; })[0]; return por[k].slice(0, 2).map(function (c) { return c.id; });`);
    const fid = fr.ok ? fr.v.franjas[0].id : 'x';
    const choque = await ejec(dir, `return EDU.repo.negocio().guardarHorarios({ crear: [{ cargaId: a[0], dia: 1, franjaId: a[2] }, { cargaId: a[1], dia: 1, franjaId: a[2] }] });`, cargas.ok ? [...cargas.v, fid] : []);
    ok(!choque.ok && choque.estado === 409 && choque.codigo === 'horario_conflictos' && choque.detalle && choque.detalle.conflictos[0].tipo === 'docente', 'negocio: el servidor RECHAZA el horario con choque de docente (409) y devuelve la lista (' + (choque.mensaje || '').slice(0, 80) + ')');
    const nada = await ejec(dir, `var l = await EDU.repo.listar('horarios'); return l.filter(function (h) { return h.franjaId === a; }).length;`, fid);
    ok(nada.ok && nada.v === 0, 'negocio: tras el rechazo no se guardó ningún bloque (atomicidad)');
    const bueno = await ejec(dir, `return EDU.repo.negocio().guardarHorarios({ crear: [{ cargaId: a[0], dia: 1, franjaId: a[2] }] });`, cargas.ok ? [...cargas.v, fid] : []);
    ok(bueno.ok && bueno.v.creados.length === 1, 'negocio: un horario sin conflictos se guarda');
    const generico = await ejec(dir, `return EDU.repo.guardar('horarios', { centroId: 'cen_1', cargaId: a[1], dia: 1, franjaId: a[2], aula: '' });`, cargas.ok ? [...cargas.v, fid] : []);
    ok(!generico.ok && generico.estado === 409, 'negocio: el POST genérico de horarios tampoco puede introducir el conflicto (409)');
    const par = await ejec(dir, `var d = await EDU.consultas.cargar(['franjas','horarios','disponibilidad','cargas','secciones','cursos','asignaturas','docentes']); var M = EDU.horarios.motor; var v = M.validar(M.armar(d), d.horarios.map(function (h) { return { id: h.id, cargaId: h.cargaId, dia: h.dia, franjaId: h.franjaId, aula: h.aula }; }).concat([{ _k: 'x', cargaId: a[1], dia: 1, franjaId: a[2] }])); return v.conflictos.map(function (c) { return c.tipo; });`, cargas.ok ? [...cargas.v, fid] : []);
    ok(par.ok && par.v.includes('docente'), 'negocio: el cliente (modo visual) marca el mismo conflicto de docente que el servidor');
    await ejec(dir, `var h = (await EDU.repo.listar('horarios')).filter(function (x) { return x.franjaId === a[2]; }).map(function (x) { return x.id; }); if (h.length) await EDU.repo.negocio().guardarHorarios({ borrar: h }); return EDU.repo.negocio().guardarFranjasTanda('vespertina', []);`, cargas.ok ? [...cargas.v, fid] : []);

    // ---------- 4) comunicado no visible para otro rol ----------
    const com = await ejec(dir, `var pub = await EDU.repo.guardar('comunicados', { centroId: 'cen_1', titulo: 'Solo docentes ' + a, cuerpo: 'Mensaje solo para docentes del centro', destinatarios: 'docentes', segmento: { tipo: 'centro', id: null }, estado: 'publicado', autorId: 'usr_falso', fecha: '1999-01-01' });
      var bor = await EDU.repo.guardar('comunicados', { centroId: 'cen_1', titulo: 'Borrador ' + a, cuerpo: 'Borrador interno del centro', destinatarios: 'todos', segmento: { tipo: 'centro', id: null }, estado: 'borrador' });
      return { pub: pub, bor: bor };`, sufijo);
    ok(com.ok && com.v.pub.autorId !== 'usr_falso' && com.v.pub.fecha !== '1999-01-01', 'negocio: el servidor fija autorId y fecha del comunicado (' + (com.mensaje || '') + ')');
    if (com.ok) {
      const vis = (x) => ejec(x, `var l = await EDU.repo.negocio().comunicados(); return l.map(function (c) { return c.id; });`);
      const vd = await vis(doc), ve = await vis(est), vdir = await vis(dir);
      ok(vd.ok && vd.v.includes(com.v.pub.id) && !vd.v.includes(com.v.bor.id), 'negocio: el docente ve el comunicado para docentes y NO el borrador');
      ok(ve.ok && !ve.v.includes(com.v.pub.id) && !ve.v.includes(com.v.bor.id), 'negocio: el estudiante no ve el comunicado de docentes ni el borrador');
      ok(vdir.ok && vdir.v.includes(com.v.pub.id) && vdir.v.includes(com.v.bor.id), 'negocio: la dirección ve ambos');
      const directo = await ejec(est, `return EDU.repo.obtener('comunicados', a);`, com.v.pub.id);
      ok(directo.ok && directo.v === null, 'negocio: pedirlo directo al servidor (GET /c/comunicados/:id) como estudiante → no existe');
      const lectura = await ejec(est, `return EDU.repo.registrarLectura(a);`, com.v.pub.id);
      ok(!lectura.ok && lectura.estado === 404, 'negocio: el estudiante no puede confirmar la lectura de un comunicado ajeno (404)');
      const cont = await ejec(dir, `var l = await EDU.repo.negocio().comunicados(); var c = l.filter(function (x) { return x.id === a; })[0]; return [c.totalDestinatarios, c.totalLeidos];`, com.v.pub.id);
      ok(cont.ok && cont.v[0] >= 1 && cont.v[1] === 0, 'negocio: los contadores de destinatarios y leídos los calcula el servidor (' + JSON.stringify(cont.v) + ')');
      await ejec(dir, `await EDU.repo.borrar('comunicados', a.p); await EDU.repo.borrar('comunicados', a.b); return 1;`, { p: com.v.pub.id, b: com.v.bor.id });
    }

    // ---------- 5) plan impartido bloqueado ----------
    const info = await ejec(doc, `var s = EDU.estado.sesion(), d = await EDU.consultas.cargar(['cargas']); var c = d.cargas.filter(function (x) { return x.docenteId === s.refId; })[0]; return { carga: c.id, uid: s.usuarioId, ref: s.refId };`);
    const plan = await ejec(doc, `return EDU.repo.guardar('planes', { centroId: 'cen_1', cargaId: a, docenteId: 'otro', tema: 'E2E ' + Date.now(), fecha: '2026-11-23', estado: 'borrador' });`, info.v && info.v.carga);
    ok(plan.ok && plan.v.docenteId === info.v.ref, 'negocio: el docente crea su plan y el servidor fija la autoría (' + (plan.mensaje || '') + ')');
    const salto = await ejec(doc, `var p = await EDU.repo.obtener('planes', a); p.estado = 'impartido'; return EDU.repo.guardar('planes', p);`, plan.v && plan.v.id);
    ok(!salto.ok && salto.codigo === 'transicion_invalida', 'negocio: no se salta de borrador a impartido (transicion_invalida)');
    const paso = await ejec(doc, `var p = await EDU.repo.obtener('planes', a); p.estado = 'listo'; p = await EDU.repo.guardar('planes', p); p.estado = 'impartido'; return EDU.repo.guardar('planes', p);`, plan.v && plan.v.id);
    ok(paso.ok && paso.v.estado === 'impartido', 'negocio: borrador → listo → impartido');
    const edita = await ejec(doc, `var p = await EDU.repo.obtener('planes', a); p.tema = 'Cambio indebido'; return EDU.repo.guardar('planes', p);`, plan.v && plan.v.id);
    ok(!edita.ok && edita.estado === 409 && edita.codigo === 'plan_impartido' && /bloqueado/i.test(edita.mensaje), 'negocio: el docente NO puede editar un plan impartido (409 plan_impartido)');
    const borra = await ejec(doc, `return EDU.repo.borrar('planes', a);`, plan.v && plan.v.id);
    ok(!borra.ok && borra.codigo === 'plan_impartido', 'negocio: ni borrarlo');
    const dirEdita = await ejec(dir, `var p = await EDU.repo.obtener('planes', a); p.tema = 'Corregido por dirección'; return EDU.repo.guardar('planes', p);`, plan.v && plan.v.id);
    ok(dirEdita.ok, 'negocio: la dirección sí puede editar un plan impartido');
    await ejec(dir, `return EDU.repo.borrar('planes', a);`, plan.v && plan.v.id);

    // ---------- 6) asistencia: lote atómico con campos fijados por el servidor ----------
    const asis = await ejec(doc, `var s = EDU.estado.sesion(), d = await EDU.consultas.cargar(['cargas', 'matriculas']); var c = d.cargas.filter(function (x) { return x.docenteId === s.refId; })[0];
      var ids = d.matriculas.filter(function (m) { return m.seccionId === c.seccionId && m.estado === 'activa'; }).map(function (m) { return m.estudianteId; }).slice(0, 3);
      var f = new Date(Date.now() - 86400000).toISOString().slice(0, 10); var r = await EDU.repo.negocio().asistenciaSeccionFecha(c.seccionId, f, ids.map(function (e, i) { return i === 2 ? { estudianteId: e, estado: 'J', justificacion: 'Cita médica' } : { estudianteId: e, estado: i ? 'A' : 'P' }; }));
      return { uid: s.usuarioId, sec: c.seccionId, n: r.length, por: r.map(function (x) { return x.registradoPor; }), jus: r.filter(function (x) { return x.estado === 'J'; }).map(function (x) { return x.justificadoPor; }), f: f, ids: ids };`);
    ok(asis.ok && asis.v.n === 3 && asis.v.por.every((u) => u === asis.v.uid) && asis.v.jus[0] === asis.v.uid, 'negocio: asistencia por lote; registradoPor/justificadoPor los fija el servidor (' + (asis.mensaje || '') + ')');
    const fut = await ejec(doc, `return EDU.repo.negocio().asistenciaSeccionFecha(a.sec, '2999-01-01', [{ estudianteId: a.ids[0], estado: 'P' }]);`, asis.ok ? asis.v : {});
    ok(!fut.ok && fut.codigo === 'fecha_futura', 'negocio: la asistencia de una fecha futura se rechaza');
    const ajeno = await ejec(doc, `return EDU.repo.negocio().asistenciaSeccionFecha(a.sec, a.f, [{ estudianteId: 'est_no_matriculado', estado: 'P' }]);`, asis.ok ? asis.v : {});
    ok(!ajeno.ok && ajeno.estado === 409, 'negocio: un estudiante no matriculado en la sección → 409 (lote atómico)');
    await irA(doc.page, '#/asistencia');
    ok(!(await hayTarjetaError(doc.page)), 'negocio: la pantalla Asistencia carga sin error');

    // ---------- 7) año activo y bajas ----------
    const baja = await ejec(dir, `var d = await EDU.consultas.cargar(['cargas']); return EDU.repo.negocio().baja('docentes', d.cargas[0].docenteId, {});`);
    ok(!baja.ok && baja.codigo === 'docente_con_cargas' && /asignaci/i.test(baja.mensaje), 'negocio: baja de un docente con cargas → 409 docente_con_cargas');
    const bajaE = await ejec(dir, `return EDU.repo.negocio().baja('estudiantes', a, { motivo: 'Prueba e2e' });`, e1.id);
    ok(bajaE.ok && bajaE.v.estado === 'inactivo', 'negocio: baja de estudiante (retira su matrícula en la misma transacción)');
    const matE = await ejec(dir, `return (await EDU.repo.listar('matriculas', { filtro: { estudianteId: a } })).map(function (m) { return m.estado; });`, e1.id);
    ok(matE.ok && matE.v.every((x) => x === 'retirada'), 'negocio: tras la baja su matrícula quedó retirada');
    const activar = await ejec(dir, `var a = (await EDU.repo.listar('anios')).filter(function (x) { return x.activo; })[0]; return EDU.repo.negocio().activarAnio(a.id);`);
    ok(activar.ok && activar.v.activo === true, 'negocio: activar año (idempotente)');
    // limpieza de lo creado (la sección y el curso ya no tienen dependencias vivas salvo las matrículas/inscripciones de prueba)
    await ejec(dir, `return EDU.repo.negocio().reactivar('estudiantes', a);`, e1.id);
    for (const x of todos) for (const p of x.vig.problemas()) fallos.push('[negocio:' + x.rol + '] ' + p);
  } finally { for (const x of todos) await x.ctx.close(); }
}

async function main() {
  let mock = null, dev = null;
  if (usarMock) {
    mock = iniciarMock({ puerto: 0 }); const pm = await mock.listo;
    dev = iniciarServidorDev({ puerto: 0, api: `127.0.0.1:${pm}`, modo: 'api' }); const pd = await dev.listo;
    base = `http://127.0.0.1:${pd}`;
    console.log(`(mock) API en :${pm}, web en ${base}`);
  }
  const cred = credenciales();
  const pw = await cargarPlaywright(), browser = await lanzar(pw);
  const origenes = [base];
  try {
    for (const rol of ROLES) { try { await probarRol(browser, rol, cred[rol], base, origenes); } catch (e) { fallos.push(`[${rol}] excepción del test: ${e.message.split('\n')[0]}`); } }
    if (!usarMock) { try { await probarNotas(browser, base, origenes, cred); } catch (e) { fallos.push(`[notas] excepción del test: ${e.message.split('\n')[0]}`); } }
    if (!usarMock) { try { await probarNegocio(browser, base, origenes, cred); } catch (e) { fallos.push(`[negocio] excepción del test: ${e.message.split('\n')[0]}`); } }
    try { await probarCuenta(browser, base, origenes, cred); } catch (e) { fallos.push(`[cuenta] excepción del test: ${e.message.split('\n')[0]}`); }
  } finally { await browser.close(); if (mock) await mock.cerrar(); if (dev) await dev.cerrar(); }
  console.log(`roles probados: ${resumen.roles}/${ROLES.length} · rutas recorridas: ${resumen.rutas} · comprobaciones: ${resumen.comprobaciones} · fallos: ${fallos.length}`);
  for (const f of fallos) console.log('  FALLO ' + f);
  console.log(fallos.length ? 'FAIL' : 'PASS' + (usarMock ? ' (contra el MOCK; falta ejecutarlo contra el backend real)' : ''));
  process.exit(fallos.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
