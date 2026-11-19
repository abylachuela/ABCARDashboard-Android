#!/usr/bin/env node
// Regresión del MODO LOCAL (demo, file://): pruebas HTML + 6 roles x todas las rutas de su menú x (1280 px, 375 px):
// sin errores de consola, sin tarjetas de error, sin desbordamiento horizontal, sin escrituras de red (modo local no usa API).
//   node tests/e2e/local.e2e.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cargarPlaywright, lanzar, irA, hayTarjetaError, desbordaHorizontal } from './lib.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = pathToFileURL(path.join(RAIZ, 'index.html')).href;
const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];
const fallos = []; let visitas = 0;

const pw = await cargarPlaywright(), browser = await lanzar(pw);
try {
  for (const t of ['calculo', 'planilla']) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(RAIZ, 'tests', `${t}.test.html`)).href);
    await page.waitForFunction(() => window.__resultado, null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ t: document.title, res: document.getElementById('res').textContent.replace(/\s+/g, ' ').slice(0, 80) }));
    console.log(`tests/${t}.test.html: ${r.t} · ${r.res}`);
    if (r.t !== 'PASS') fallos.push(`${t}.test.html: ${r.t}`);
    await page.close();
  }
  for (const ancho of [1280, 375]) {
    for (const rol of ROLES) {
      const ctx = await browser.newContext({ viewport: { width: ancho, height: 800 } }), page = await ctx.newPage();
      const malos = [], red = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR_/.test(m.text() + (m.location().url || ''))) malos.push(m.text()); });
      page.on('pageerror', (e) => malos.push(String(e.message || e)));
      page.on('request', (r) => { if (/\/api\//.test(r.url())) red.push(r.url()); });
      await page.goto(INDEX);
      await page.waitForFunction(() => document.body.getAttribute('data-listo') === '1', null, { timeout: 30000 });
      await page.waitForSelector('.demo-group');
      const sel = await page.evaluate((r) => { const g = Array.from(document.querySelectorAll('.demo-group')).find((x) => x.querySelector('h2').textContent === window.EDU.permisos.etiquetaRol(r)); return g ? g.querySelector('.demo-user').dataset.u : null; }, rol);
      await page.click(`.demo-user[data-u="${sel}"]`);
      await page.waitForSelector('#nav a');
      const rutas = await page.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href')));
      for (const h of rutas.concat(['#/ruta-que-no-existe'])) {
        await irA(page, h); visitas++;
        const noExiste = h.includes('no-existe');
        if (!noExiste && await hayTarjetaError(page)) fallos.push(`[${rol}@${ancho}] ${h}: tarjeta de error`);
        if (await desbordaHorizontal(page)) fallos.push(`[${rol}@${ancho}] ${h}: desbordamiento horizontal`);
      }
      const llavesSesion = await page.evaluate(() => localStorage.getItem('edu:sesion') ? 'si' : 'no');
      if (llavesSesion !== 'si') fallos.push(`[${rol}@${ancho}] el modo local debe persistir la sesión demo`);
      if (red.length) fallos.push(`[${rol}@${ancho}] peticiones a /api/ en modo local: ${red.length}`);
      for (const m of malos) fallos.push(`[${rol}@${ancho}] consola: ${m}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); }
console.log(`visitas: ${visitas} · fallos: ${fallos.length}`);
for (const f of fallos) console.log('  FALLO ' + f);
console.log(fallos.length ? 'FAIL' : 'PASS');
process.exit(fallos.length ? 1 : 0);
