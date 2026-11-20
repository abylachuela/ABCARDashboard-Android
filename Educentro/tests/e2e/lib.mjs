// Utilidades comunes de los scripts e2e (Playwright). Sin dependencias del proyecto: Playwright se instala aparte (ver README.md).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function cargarPlaywright() {
  try { return await import('playwright'); } catch { /* ver abajo */ }
  const dir = process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright';
  for (const f of ['index.mjs', 'index.js']) {
    const p = path.join(dir, f);
    if (existsSync(p)) { const m = await import(pathToFileURL(p).href); return m.chromium ? m : m.default; }
  }
  throw new Error('No se encuentra Playwright. Instálalo (npm i -D playwright) o indica PLAYWRIGHT_DIR=<carpeta de playwright>.');
}

export async function lanzar(pw, opciones = {}) {
  const candidatos = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const exe = candidatos.find((p) => existsSync(p));
  return pw.chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'], ...opciones });
}

/** Recoge errores de consola, excepciones y respuestas >= 400 de nuestro origen. `silenciar(n)` ignora las próximas n respuestas >= 400 (esperadas). */
export function vigilar(page, origenes) {
  const estado = { consola: [], excepciones: [], http: [], esperadas: 0, ignoradas: [] };
  const propio = (u) => origenes.some((o) => u.startsWith(o)) || u.startsWith('file:');
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = m.location().url || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(u) || (/Failed to load resource/.test(m.text()) && !propio(u))) return; // fuentes de Google (sin red en CI)
    if (/Failed to load resource: the server responded with a status of (4\d\d|5\d\d)/.test(m.text())) return;       // ya contado como respuesta HTTP
    estado.consola.push(m.text());
  });
  page.on('pageerror', (e) => estado.excepciones.push(String(e && e.message || e)));
  page.on('response', (r) => {
    if (r.status() < 400 || !propio(r.url())) return;
    if (estado.esperadas > 0) { estado.esperadas--; estado.ignoradas.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); return; }
    estado.http.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
  });
  estado.silenciar = (n = 1) => { estado.esperadas += n; };
  estado.limpiar = () => { estado.consola = []; estado.excepciones = []; estado.http = []; estado.esperadas = 0; };
  estado.problemas = () => [...estado.consola.map((x) => 'consola: ' + x), ...estado.excepciones.map((x) => 'excepción: ' + x), ...estado.http.map((x) => 'HTTP inesperado: ' + x)];
  return estado;
}

export async function irA(page, hash) {
  const modulo = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  await page.evaluate((h) => { if (location.hash === h) location.hash = ''; location.hash = h; }, hash);
  await page.waitForFunction((m) => { const a = window.EDU && window.EDU.router.actual(); return a && a.modulo === m && !document.getElementById('view').hasAttribute('aria-busy'); }, modulo, { timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

export const TARJETA_ERROR = '#view .card h2';
export async function hayTarjetaError(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#view h1, #view h2')).some((h) => /Ocurrió un error|Página no encontrada|Acceso denegado/.test(h.textContent)));
}
export async function desbordaHorizontal(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}
