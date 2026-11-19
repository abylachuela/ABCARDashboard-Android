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
    try { await probarCuenta(browser, base, origenes, cred); } catch (e) { fallos.push(`[cuenta] excepción del test: ${e.message.split('\n')[0]}`); }
  } finally { await browser.close(); if (mock) await mock.cerrar(); if (dev) await dev.cerrar(); }
  console.log(`roles probados: ${resumen.roles}/${ROLES.length} · rutas recorridas: ${resumen.rutas} · comprobaciones: ${resumen.comprobaciones} · fallos: ${fallos.length}`);
  for (const f of fallos) console.log('  FALLO ' + f);
  console.log(fallos.length ? 'FAIL' : 'PASS' + (usarMock ? ' (contra el MOCK; falta ejecutarlo contra el backend real)' : ''));
  process.exit(fallos.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
