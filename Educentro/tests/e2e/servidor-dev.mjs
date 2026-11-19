#!/usr/bin/env node
// Servidor de DESARROLLO para las pruebas e2e: sirve el frontend estático y hace proxy de /api/ al backend en el MISMO origen
// (como nginx en producción), con cabeceras parecidas (CSP, nosniff, no-cache, sin listado de directorios). Node >= 18, sin dependencias.
//
//   node tests/e2e/servidor-dev.mjs [--puerto=8080] [--api=127.0.0.1:3000] [--modo=api|local]
//   Variables: PUERTO, API_UPSTREAM, EDU_MODO.
// --modo=api (por defecto) sirve js/config.js con modo 'api' SIN tocar el archivo del repositorio (igual que deploy.mjs --with-api);
// --modo=local sirve el config.js del repo. Solo publica index.html, css/ y js/ (el resto: 404). No lo expongas fuera de localhost.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CSP, generarConfigJs } from '../../deploy/deploy.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const CABECERAS = {
  'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cross-Origin-Opener-Policy': 'same-origin',
};

export function iniciarServidorDev({ puerto = 8080, host = '127.0.0.1', api = '127.0.0.1:3000', modo = 'api' } = {}) {
  const [apiHost, apiPuerto] = api.split(':');
  const configJs = generarConfigJs({ withApi: modo === 'api' });

  function proxy(req, res) {
    const cabeceras = { ...req.headers, host: req.headers.host, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-proto': 'http', 'x-forwarded-host': req.headers.host || '' };
    delete cabeceras.connection;
    const up = http.request({ host: apiHost, port: Number(apiPuerto), method: req.method, path: req.url, headers: cabeceras }, (r) => {
      const h = { ...r.headers }; delete h['cache-control'];
      res.writeHead(r.statusCode, { ...h, 'Cache-Control': 'no-store' });
      r.pipe(res);
    });
    up.setTimeout(30000, () => up.destroy());
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); } res.end(JSON.stringify({ error: { codigo: 'api_no_disponible', mensaje: 'La API no responde.' } })); });
    req.pipe(up);
  }

  const server = http.createServer((req, res) => {
    let ruta;
    try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Solicitud no válida'); }
    if (ruta === '/api' || ruta.startsWith('/api/')) return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Método no permitido'); }
    if (ruta === '/') ruta = '/index.html';
    const permitido = ruta === '/index.html' || ruta.startsWith('/css/') || ruta.startsWith('/js/');
    const abs = path.join(RAIZ, ruta);
    if (!permitido || ruta.includes('\0') || !abs.startsWith(RAIZ + path.sep) || /\/\./.test(ruta) || /\.(xlsx|xls|csv|md|map|sh|bak|log)$/i.test(ruta)) { res.writeHead(404, CABECERAS); return res.end('No encontrado'); }
    const enviar = (cuerpo, tipo) => { res.writeHead(200, { ...CABECERAS, 'Content-Type': tipo, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : cuerpo); };
    if (ruta === '/js/config.js' && modo === 'api') return enviar(configJs, TIPOS['.js']);
    fs.stat(abs, (e, s) => {
      if (e || !s.isFile()) { res.writeHead(404, CABECERAS); return res.end('No encontrado'); }
      fs.readFile(abs, (e2, buf) => { if (e2) { res.writeHead(404, CABECERAS); return res.end('No encontrado'); } enviar(buf, TIPOS[path.extname(abs).toLowerCase()] || 'application/octet-stream'); });
    });
  });
  const listo = new Promise((ok) => server.listen(puerto, host, () => ok(server.address().port)));
  return { server, listo, cerrar: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
  const puerto = Number(arg('puerto') || process.env.PUERTO || 8080), api = arg('api') || process.env.API_UPSTREAM || '127.0.0.1:3000', modo = arg('modo') || process.env.EDU_MODO || 'api';
  if (!/^[\w.-]+:\d{2,5}$/.test(api) || !['api', 'local'].includes(modo)) { console.error('Uso: node servidor-dev.mjs [--puerto=8080] [--api=host:puerto] [--modo=api|local]'); process.exit(2); }
  iniciarServidorDev({ puerto, api, modo }).listo.then((p) => console.log(`EduCentro (modo ${modo}) en http://127.0.0.1:${p}/  ·  /api/ -> http://${api}/api/`));
}
