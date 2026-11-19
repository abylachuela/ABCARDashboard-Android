#!/usr/bin/env node
// Despliegue de Educentro (sitio estático) en una VM Linux con nginx.
// Sustituye al antiguo deploy.sh. ES module, Node >= 18, SIN dependencias npm (solo módulos node:).
//
// Ejecutar COMO ROOT en la VM, desde una copia del repositorio:
//   sudo node Educentro/deploy/deploy.mjs                     # HTTPS con certificado autofirmado
//   sudo SERVER_NAME=notas.midominio.edu EMAIL=yo@x.edu HTTPS_MODE=letsencrypt node Educentro/deploy/deploy.mjs
//   sudo node Educentro/deploy/deploy.mjs --dry-run           # muestra qué haría, sin tocar nada
//
// Variables de entorno (o su opción equivalente; la opción gana sobre la variable):
//   SERVER_NAME   --server-name    def. IP de la VM (o localhost)
//   HTTPS_MODE    --https-mode     selfsigned (def.) | letsencrypt | none
//   EMAIL         --email          solo letsencrypt
//   APP_DIR       --app-dir        def. /var/www/educentro
//   KEEP          --keep           versiones a conservar, def. 5
//   WITH_API=1    --with-api       añade `location /api/` con proxy a la API (def. 0 = solo estático)
//   API_UPSTREAM  --api-upstream   def. 127.0.0.1:3000 (solo con WITH_API=1)
//   --dry-run  no cambia nada; --verbose  (con --dry-run) muestra también los archivos generados; --help
//
// Todas las entradas se validan con listas blancas y los comandos externos se ejecutan SIN shell
// (execFile/spawn con argumentos en array): ninguna entrada llega nunca a una cadena de shell.
//
// Códigos de salida: 0 correcto | 1 error inesperado | 2 entrada o uso inválido | 3 falta root
//   4 faltan dependencias | 5 nginx rechaza la configuración (se restaura la anterior)
//   6 la comprobación posterior falló | 7 no hay versión a la que volver (rollback)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const EXIT = Object.freeze({
  OK: 0, ERROR: 1, ENTRADA: 2, ROOT: 3, DEPENDENCIAS: 4, NGINX: 5, COMPROBACION: 6, SIN_VERSION: 7,
});

export const RUTAS = Object.freeze({
  SNIP: '/etc/nginx/snippets',
  CONF_D: '/etc/nginx/conf.d',
  SITE: '/etc/nginx/conf.d/educentro.conf',
  ZONES: '/etc/nginx/conf.d/educentro-api-zones.conf',
  CERT_DIR: '/etc/ssl/educentro',
  DEFAULT_SITE: '/etc/nginx/sites-enabled/default',
});

export class ErrorDeEntrada extends Error {}
export class ErrorFatal extends Error {
  constructor(msg, code = EXIT.ERROR) { super(msg); this.code = code; }
}

// ---------------------------------------------------------------- validación (funciones puras)

const HTTPS_MODES = ['selfsigned', 'letsencrypt', 'none'];
const ETIQUETA = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// Directorios del sistema que nunca pueden ser APP_DIR (ni quedar por encima de él).
const APP_DIR_PROHIBIDOS = ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc', '/root',
  '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var', '/var/www', '/var/lib', '/var/log', '/var/tmp'];

export function esIPv4(v) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

export function validarServerName(v) {
  if (typeof v !== 'string' || v === '') throw new ErrorDeEntrada('SERVER_NAME vacío.');
  if (v.length > 253) throw new ErrorDeEntrada('SERVER_NAME demasiado largo.');
  if (!/^[A-Za-z0-9.-]+$/.test(v)) {
    throw new ErrorDeEntrada('SERVER_NAME inválido: solo letras, números, punto y guion (sin espacios ni símbolos).');
  }
  if (/^[0-9.]+$/.test(v)) {
    if (!esIPv4(v)) throw new ErrorDeEntrada('SERVER_NAME inválido: parece una IP pero no es una IPv4 válida.');
    return v;
  }
  const etiquetas = v.split('.');
  if (etiquetas.some((e) => !ETIQUETA.test(e))) {
    throw new ErrorDeEntrada('SERVER_NAME inválido: cada parte entre puntos debe empezar y terminar con letra o número (no vacía, sin "..").');
  }
  return v;
}

export function validarHttpsMode(v) {
  if (!HTTPS_MODES.includes(v)) throw new ErrorDeEntrada(`HTTPS_MODE inválido: ${JSON.stringify(v)} (use ${HTTPS_MODES.join('|')}).`);
  return v;
}

export function validarWithApi(v) {
  if (v === '0' || v === 0 || v === false) return false;
  if (v === '1' || v === 1 || v === true) return true;
  throw new ErrorDeEntrada(`WITH_API inválido: ${JSON.stringify(v)} (use 0 o 1).`);
}

export function validarKeep(v) {
  const s = String(v);
  if (!/^[0-9]{1,3}$/.test(s) || Number(s) < 1 || Number(s) > 100) throw new ErrorDeEntrada('KEEP inválido: entero entre 1 y 100.');
  return Number(s);
}

export function validarEmail(v) {
  if (typeof v !== 'string' || v.length > 254 || !/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) {
    throw new ErrorDeEntrada('EMAIL inválido.');
  }
  return v;
}

export function validarAppDir(v) {
  if (typeof v !== 'string' || v === '') throw new ErrorDeEntrada('APP_DIR vacío.');
  if (v.length > 200 || !/^\/[A-Za-z0-9._/-]*$/.test(v)) {
    throw new ErrorDeEntrada('APP_DIR inválido: ruta absoluta con solo letras, números, ".", "_", "-" y "/".');
  }
  if (v.split('/').some((seg) => seg === '..' || seg === '.')) throw new ErrorDeEntrada('APP_DIR inválido: no se admiten "." ni ".." en la ruta.');
  const limpia = path.posix.normalize(v).replace(/\/+$/, '') || '/';
  if (APP_DIR_PROHIBIDOS.includes(limpia)) throw new ErrorDeEntrada(`APP_DIR inválido: ${limpia} es un directorio del sistema.`);
  return limpia;
}

export function validarApiUpstream(v) {
  const m = /^([A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(typeof v === 'string' ? v : '');
  if (!m) throw new ErrorDeEntrada('API_UPSTREAM inválido (use host:puerto).');
  validarServerName(m[1]);
  const puerto = Number(m[2]);
  if (puerto < 1 || puerto > 65535) throw new ErrorDeEntrada('API_UPSTREAM inválido: puerto fuera de 1-65535.');
  return `${m[1]}:${puerto}`;
}

/** Combina opciones (CLI) y variables de entorno, valida todo y devuelve la configuración. */
export function resolverConfig({ env = {}, opts = {}, hostPorDefecto = '' } = {}) {
  const pick = (opt, nombre, def) => (opt !== undefined ? opt : (env[nombre] !== undefined && env[nombre] !== '' ? env[nombre] : def));
  const httpsMode = validarHttpsMode(pick(opts['https-mode'], 'HTTPS_MODE', 'selfsigned'));
  const withApi = opts['with-api'] ? true : validarWithApi(pick(undefined, 'WITH_API', '0'));
  const serverName = validarServerName(pick(opts['server-name'], 'SERVER_NAME', hostPorDefecto || 'localhost'));
  const cfg = {
    httpsMode,
    withApi,
    serverName,
    serverEsIp: esIPv4(serverName),
    appDir: validarAppDir(pick(opts['app-dir'], 'APP_DIR', '/var/www/educentro')),
    keep: validarKeep(pick(opts.keep, 'KEEP', '5')),
    apiUpstream: validarApiUpstream(pick(opts['api-upstream'], 'API_UPSTREAM', '127.0.0.1:3000')),
    email: '',
  };
  const email = pick(opts.email, 'EMAIL', '');
  if (httpsMode === 'letsencrypt') {
    if (!email) throw new ErrorDeEntrada('letsencrypt necesita EMAIL=... (o --email).');
    cfg.email = validarEmail(email);
    if (cfg.serverEsIp) throw new ErrorDeEntrada('letsencrypt necesita un dominio, no una IP.');
  } else if (email) {
    cfg.email = validarEmail(email);
  }
  return cfg;
}

// ---------------------------------------------------------------- generación de nginx (funciones puras)

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'none'";

export function generarHeaders() {
  return `add_header Content-Security-Policy "${CSP}" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
`;
}

export function generarApp(cfg, snip = RUTAS.SNIP) {
  let s = `root ${cfg.appDir}/current;
index index.html;
charset utf-8;
server_tokens off;
gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;
include ${snip}/educentro-headers.conf;
location / { try_files $uri $uri/ =404; }
location ~* \\.(xlsx|xls|csv|md|map|sh|bak|log)$ { return 404; }
location ~ /\\. { return 404; }
location ^~ /datos-privados/ { return 404; }
location ^~ /docs/ { return 404; }
location ^~ /mobile/ { return 404; }
location ^~ /tests/ { return 404; }
location ^~ /propuestas/ { return 404; }
location = /index.html { include ${snip}/educentro-headers.conf; add_header Cache-Control "no-cache" always; }
location ~* \\.(js|css)$ { include ${snip}/educentro-headers.conf; add_header Cache-Control "no-cache" always; }
`;
  if (cfg.withApi) s += `include ${snip}/educentro-api.conf;\n`;
  return s;
}

export function generarApiZones() {
  return `limit_req_zone $binary_remote_addr zone=edu_api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=edu_auth:10m rate=2r/s;
`;
}

export function generarApiProxy(cfg) {
  return `proxy_pass http://${cfg.apiUpstream};
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
proxy_send_timeout 30s;
client_max_body_size 1m;
limit_req_status 429;
# Sin caché de ningún tipo. Declarar add_header aquí corta la herencia de las cabeceras del sitio estático:
# las de seguridad de la API (CSP, nosniff, HSTS…) las envía la propia API y pasan tal cual.
proxy_cache off;
proxy_no_cache 1;
add_header Cache-Control "no-store" always;
proxy_hide_header Cache-Control;
`;
}

export function generarApiConf(snip = RUTAS.SNIP) {
  return `location ^~ /api/v1/auth/ {
    limit_req zone=edu_auth burst=10 nodelay;
    include ${snip}/educentro-api-proxy.conf;
}
location ^~ /api/ {
    limit_req zone=edu_api burst=30 nodelay;
    include ${snip}/educentro-api-proxy.conf;
}
`;
}

export function certificados(cfg) {
  if (cfg.httpsMode === 'selfsigned') {
    return { crt: `${RUTAS.CERT_DIR}/educentro.crt`, key: `${RUTAS.CERT_DIR}/educentro.key`, hsts: '' };
  }
  return {
    crt: `/etc/letsencrypt/live/${cfg.serverName}/fullchain.pem`,
    key: `/etc/letsencrypt/live/${cfg.serverName}/privkey.pem`,
    hsts: 'add_header Strict-Transport-Security "max-age=31536000" always;',
  };
}

/** Archivo del sitio. `ipv6` = el sistema soporta IPv6 (solo entonces se escucha en [::]). */
export function generarSite(cfg, { ipv6 = false, snip = RUTAS.SNIP } = {}) {
  const l80 = ipv6 ? '\n    listen [::]:80;' : '';
  if (cfg.httpsMode === 'none') {
    return `server {
    listen 80;${l80}
    server_name ${cfg.serverName};
    include ${snip}/educentro-app.conf;
}
`;
  }
  const { crt, key, hsts } = certificados(cfg);
  const l443 = ipv6 ? '\n    listen [::]:443 ssl http2;' : '';
  return `server {
    listen 80;${l80}
    server_name ${cfg.serverName};
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;${l443}   # 'http2' en listen: compatible con nginx <1.25 y >=1.25
    server_name ${cfg.serverName};
    ssl_certificate ${crt};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:EDU:10m;${hsts ? `\n    ${hsts}` : ''}
    include ${snip}/educentro-app.conf;
}
`;
}

/** Sitio HTTP temporal para el desafío de Let's Encrypt. */
export function generarSiteTemporal(cfg) {
  return `server { listen 80; server_name ${cfg.serverName}; root /var/www/html; }\n`;
}

export function generarSan(serverName) {
  return `${esIPv4(serverName) ? 'IP' : 'DNS'}:${serverName}`;
}

export function argsOpensslAutofirmado(cfg) {
  return ['req', '-x509', '-nodes', '-newkey', 'rsa:3072', '-days', '825',
    '-keyout', `${RUTAS.CERT_DIR}/educentro.key`, '-out', `${RUTAS.CERT_DIR}/educentro.crt`,
    '-subj', `/CN=${cfg.serverName}`, '-addext', `subjectAltName=${generarSan(cfg.serverName)}`];
}

/** Todos los archivos de nginx que gestiona el script: [{ruta, contenido}] (sin certificados). */
export function archivosNginx(cfg, { ipv6 = false } = {}) {
  const lista = [
    { ruta: `${RUTAS.SNIP}/educentro-headers.conf`, contenido: generarHeaders() },
    { ruta: `${RUTAS.SNIP}/educentro-app.conf`, contenido: generarApp(cfg) },
  ];
  if (cfg.withApi) {
    lista.push(
      { ruta: RUTAS.ZONES, contenido: generarApiZones() },
      { ruta: `${RUTAS.SNIP}/educentro-api-proxy.conf`, contenido: generarApiProxy(cfg) },
      { ruta: `${RUTAS.SNIP}/educentro-api.conf`, contenido: generarApiConf() },
    );
  }
  lista.push({ ruta: RUTAS.SITE, contenido: generarSite(cfg, { ipv6 }) });
  return lista;
}

export const ARCHIVOS_API = [`${RUTAS.SNIP}/educentro-api.conf`, `${RUTAS.SNIP}/educentro-api-proxy.conf`, RUTAS.ZONES];
export const SIN_PUBLICAR = /\.(xlsx|xls|csv)$/i;           // además de la carpeta datos-privados
export const NOMBRE_VERSION = /^\d{8}-\d{6}(?:-\d+)?$/;

export function sellarVersion(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Ordena nombres de versión de la más reciente a la más antigua (el sello es ordenable como texto). */
export function ordenarVersiones(nombres) {
  return nombres.filter((n) => NOMBRE_VERSION.test(n)).sort().reverse();
}

// ---------------------------------------------------------------- utilidades con efectos

export function existeComando(nombre, env = process.env) {
  for (const dir of (env.PATH || '').split(':')) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, nombre), fs.constants.X_OK); return true; } catch { /* siguiente */ }
  }
  return false;
}

export function ipv6Disponible() {
  try { if (fs.readFileSync('/proc/net/if_inet6', 'utf8').trim() === '') return false; } catch { return false; }
  try {
    if (fs.readFileSync('/proc/sys/net/ipv6/conf/all/disable_ipv6', 'utf8').trim() === '1') return false;
  } catch { /* si no se puede leer, se asume habilitado como hacía el script anterior */ }
  return true;
}

export function ipPorDefecto() {
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const a of lista || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '';
}

/** Ejecuta un comando SIN shell. Devuelve el código de salida (null si no pudo arrancar). */
function ejecutar(ctx, cmd, args, { silencioso = false, env } = {}) {
  const linea = [cmd, ...args].join(' ');
  if (ctx.dry) { ctx.log(`   [dry-run] ejecutaría: ${linea}`); return 0; }
  const r = spawnSync(cmd, args, { stdio: silencioso ? 'ignore' : 'inherit', env: env ?? process.env });
  return r.error ? null : r.status;
}

function exigir(ctx, cmd, args, code, mensaje, opciones) {
  const st = ejecutar(ctx, cmd, args, opciones);
  if (st !== 0) throw new ErrorFatal(`${mensaje} (${cmd} ${args[0] ?? ''} → código ${st ?? 'no se pudo ejecutar'}).`, code);
}

function escribir(ctx, ruta, contenido, modo = 0o644) {
  if (ctx.dry) {
    ctx.log(`   [dry-run] escribiría ${ruta} (${contenido.split('\n').length - 1} líneas)`);
    if (ctx.verbose) ctx.log(contenido.replace(/^/gm, '      | '));
    return;
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contenido, { mode: modo });
  fs.chmodSync(tmp, modo);
  fs.renameSync(tmp, ruta);
}

function leerOpcional(ruta) { try { return fs.readFileSync(ruta, 'utf8'); } catch { return null; } }

function quitar(ctx, ruta) {
  if (ctx.dry) { if (fs.existsSync(ruta)) ctx.log(`   [dry-run] eliminaría ${ruta}`); return; }
  fs.rmSync(ruta, { force: true });
}

/** Enlace simbólico atómico: crea `<destino>.new` y lo renombra sobre `<destino>`. */
export function activarEnlace(destino, objetivo) {
  const nuevo = `${destino}.new`;
  fs.rmSync(nuevo, { force: true });
  fs.symlinkSync(objetivo, nuevo);
  try { fs.renameSync(nuevo, destino); } catch (e) {
    fs.rmSync(nuevo, { force: true });
    throw new ErrorFatal(`No se pudo activar ${destino}: ${e.message}. (¿es un directorio real en vez de un enlace?)`);
  }
}

export function listarVersiones(appDir) {
  try { return ordenarVersiones(fs.readdirSync(path.join(appDir, 'releases'))); } catch { return []; }
}

// Copia solo lo publicable y elimina lo prohibido. Devuelve la lista de lo eliminado.
function copiarWeb(ctx, src, rel) {
  const omitidos = [];
  const filtro = (origen) => {
    if (fs.lstatSync(origen).isSymbolicLink()) { omitidos.push(`${origen} (enlace simbólico)`); return false; }
    return true;
  };
  fs.mkdirSync(rel, { recursive: true });
  fs.cpSync(path.join(src, 'index.html'), path.join(rel, 'index.html'));
  for (const d of ['css', 'js', 'assets']) {
    const o = path.join(src, d);
    if (fs.existsSync(o)) fs.cpSync(o, path.join(rel, d), { recursive: true, filter: filtro });
  }
  const quitados = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.name === 'datos-privados' || SIN_PUBLICAR.test(e.name) || e.isSymbolicLink()) {
        fs.rmSync(p, { recursive: true, force: true }); quitados.push(p); continue;
      }
      if (e.isDirectory()) { fs.chmodSync(p, 0o755); recorrer(p); } else { fs.chmodSync(p, 0o644); }
      try { fs.chownSync(p, 0, 0); } catch { /* sin permiso: ya somos root en uso real */ }
    }
  };
  fs.chmodSync(rel, 0o755);
  try { fs.chownSync(rel, 0, 0); } catch { /* idem */ }
  recorrer(rel);
  for (const o of omitidos) ctx.log(`   AVISO: se omitió ${o}`);
  for (const q of quitados) ctx.log(`   Defensa: eliminado del sitio publicado ${q}`);
}

function peticion(base, ruta, host, { cuerpo = false } = {}) {
  return new Promise((resolve) => {
    const u = new URL(ruta, base);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers: { Host: host }, rejectUnauthorized: false, timeout: 5000, agent: false }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (cuerpo && datos.length < 1_000_000) datos += c; });
      res.on('end', () => resolve({ status: res.statusCode, cuerpo: datos }));
      if (!cuerpo) res.resume();
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, cuerpo: '' }));
    req.end();
  });
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- flujo principal

export async function desplegar(cfg, ctx) {
  const SRC = ctx.src;
  const stamp0 = sellarVersion();
  const modoTxt = cfg.httpsMode + (cfg.withApi ? `, con proxy /api/ -> ${cfg.apiUpstream}` : '');
  ctx.log(`Educentro: despliegue${ctx.dry ? ' (SIMULACIÓN --dry-run: no se cambia nada)' : ''}`);
  ctx.log(`   servidor=${cfg.serverName}  https=${cfg.httpsMode}  api=${cfg.withApi ? 'sí' : 'no'}  app=${cfg.appDir}  conservar=${cfg.keep}`);

  if (!fs.existsSync(path.join(SRC, 'index.html'))) throw new ErrorFatal(`No encuentro ${path.join(SRC, 'index.html')}`, EXIT.ENTRADA);
  for (const d of ['css', 'js']) {
    if (!fs.statSync(path.join(SRC, d), { throwIfNoEntry: false })?.isDirectory()) throw new ErrorFatal(`No encuentro la carpeta ${path.join(SRC, d)}`, EXIT.ENTRADA);
  }

  // 1) Dependencias
  ctx.log(`==> Instalando nginx${cfg.httpsMode === 'letsencrypt' ? ' y certbot' : ''} si hacen falta`);
  const gestor = ['apt-get', 'dnf', 'yum'].find((c) => existeComando(c));
  const envApt = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  const instalar = (paquetes, mensajeSinGestor) => {
    if (!gestor) throw new ErrorFatal(mensajeSinGestor, EXIT.DEPENDENCIAS);
    if (gestor === 'apt-get') {
      exigir(ctx, 'apt-get', ['update', '-y'], EXIT.DEPENDENCIAS, 'Falló apt-get update', { env: envApt });
      exigir(ctx, 'apt-get', ['install', '-y', ...paquetes], EXIT.DEPENDENCIAS, 'Falló la instalación de paquetes', { env: envApt });
    } else {
      exigir(ctx, gestor, ['install', '-y', ...paquetes], EXIT.DEPENDENCIAS, 'Falló la instalación de paquetes');
    }
  };
  if (!existeComando('nginx')) instalar(['nginx'], 'Gestor de paquetes no soportado: instala nginx a mano.');
  if (cfg.httpsMode === 'selfsigned' && !existeComando('openssl')) instalar(['openssl'], 'Falta openssl y no hay gestor de paquetes soportado.');
  if (cfg.httpsMode === 'letsencrypt' && !existeComando('certbot')) {
    if (gestor !== 'apt-get') throw new ErrorFatal('Instala certbot y su plugin de nginx, y vuelve a ejecutar.', EXIT.DEPENDENCIAS);
    instalar(['certbot', 'python3-certbot-nginx'], '');
  }

  // 2) Nueva versión
  let stamp = stamp0;
  for (let n = 1; fs.existsSync(path.join(cfg.appDir, 'releases', stamp)); n++) stamp = `${stamp0}-${n}`;
  const REL = path.join(cfg.appDir, 'releases', stamp);
  ctx.log(`==> Copiando la web a ${REL} (solo index.html, css, js)`);
  if (ctx.dry) ctx.log(`   [dry-run] copiaría index.html, css/, js/ (y assets/ si existe), eliminaría *.xlsx/*.xls/*.csv y datos-privados, permisos 755/644 root`);
  else copiarWeb(ctx, SRC, REL);

  // 3) nginx (con copia de seguridad de lo que se reescribe, para restaurar si nginx -t falla)
  ctx.log(`==> Configurando nginx (${modoTxt})`);
  const ipv6 = ipv6Disponible();
  const archivos = archivosNginx(cfg, { ipv6 });
  const gestionados = [...new Set([...archivos.map((a) => a.ruta), ...ARCHIVOS_API])];
  const copias = new Map(gestionados.map((r) => [r, leerOpcional(r)]));
  const restaurar = () => {
    for (const [r, c] of copias) { if (c === null) fs.rmSync(r, { force: true }); else fs.writeFileSync(r, c); }
  };
  try {
    if (!ctx.dry) { fs.mkdirSync(RUTAS.SNIP, { recursive: true }); fs.mkdirSync(RUTAS.CONF_D, { recursive: true }); }
    // La API es opt-in: sin WITH_API=1 sus archivos no existen y /api/ responde 404 como cualquier ruta.
    for (const r of ARCHIVOS_API) quitar(ctx, r);
    for (const a of archivos.filter((x) => x.ruta !== RUTAS.SITE)) escribir(ctx, a.ruta, a.contenido);

    if (cfg.httpsMode === 'selfsigned') {
      const crt = `${RUTAS.CERT_DIR}/educentro.crt`;
      if (!fs.existsSync(crt)) {
        if (ctx.dry) ctx.log(`   [dry-run] crearía ${RUTAS.CERT_DIR} y un certificado autofirmado (${generarSan(cfg.serverName)})`);
        else fs.mkdirSync(RUTAS.CERT_DIR, { recursive: true });
        exigir(ctx, 'openssl', argsOpensslAutofirmado(cfg), EXIT.DEPENDENCIAS, 'No se pudo crear el certificado autofirmado', { silencioso: true });
        if (!ctx.dry) fs.chmodSync(`${RUTAS.CERT_DIR}/educentro.key`, 0o600);
      } else if (!ctx.dry) {
        ctx.log(`   Se reutiliza el certificado existente (${crt}); bórralo si cambió SERVER_NAME.`);
      }
    } else if (cfg.httpsMode === 'letsencrypt' && !fs.existsSync(certificados(cfg).crt)) {
      // Servidor HTTP temporal para el desafío de Let's Encrypt.
      escribir(ctx, RUTAS.SITE, generarSiteTemporal(cfg));
      exigir(ctx, 'nginx', ['-t'], EXIT.NGINX, 'nginx rechaza la configuración temporal');
      recargarNginx(ctx);
      exigir(ctx, 'certbot', ['certonly', '--nginx', '-d', cfg.serverName, '-m', cfg.email, '--agree-tos', '--non-interactive'],
        EXIT.DEPENDENCIAS, 'certbot no pudo obtener el certificado');
    }

    escribir(ctx, RUTAS.SITE, generarSite(cfg, { ipv6 }));
    // Quitar el sitio por defecto si estorba en el puerto 80 (solo el enlace; no borra nada propio).
    try { if (fs.lstatSync(RUTAS.DEFAULT_SITE).isSymbolicLink()) quitar(ctx, RUTAS.DEFAULT_SITE); } catch { /* no existe */ }
    exigir(ctx, 'nginx', ['-t'], EXIT.NGINX, 'nginx rechaza la configuración');
  } catch (e) {
    if (!ctx.dry && e instanceof ErrorFatal && e.code === EXIT.NGINX) {
      restaurar();
      throw new ErrorFatal(`${e.message} Se restauró la configuración anterior; la versión ${stamp} quedó copiada pero NO activada.`, EXIT.NGINX);
    }
    throw e;
  }

  // 4) Activar la versión (enlace atómico) y recargar
  ctx.log(`==> Activando la versión ${stamp}`);
  if (ctx.dry) ctx.log(`   [dry-run] enlazaría ${cfg.appDir}/current -> ${REL} (atómico)`);
  else activarEnlace(path.join(cfg.appDir, 'current'), REL);
  ejecutar(ctx, 'systemctl', ['enable', 'nginx'], { silencioso: true });
  recargarNginx(ctx);

  // 5) Retención
  ctx.log(`==> Conservando las últimas ${cfg.keep} versiones`);
  const todas = listarVersiones(cfg.appDir);
  const actual = (() => { try { return path.basename(fs.realpathSync(path.join(cfg.appDir, 'current'))); } catch { return ''; } })();
  const sobran = ctx.dry ? [] : todas.slice(cfg.keep).filter((v) => v !== actual);
  for (const v of sobran) fs.rmSync(path.join(cfg.appDir, 'releases', v), { recursive: true, force: true });
  if (ctx.dry) ctx.log(`   [dry-run] borraría las versiones más antiguas que las ${cfg.keep} últimas (hoy hay ${todas.length})`);

  // 6) Comprobación
  if (ctx.dry) {
    ctx.log('==> Comprobación\n   [dry-run] comprobaría / (200 con "educentro"), 404 en datos-privados/ docs/ mobile/ tests/ propuestas/ x.xlsx' + (cfg.withApi ? ' y /api/health' : ''));
    ctx.log('\nSimulación terminada: no se modificó nada.');
    return EXIT.OK;
  }
  await comprobar(cfg, ctx);
  const proto = cfg.httpsMode === 'none' ? 'http' : 'https';
  ctx.log(`\nListo: ${proto}://${cfg.serverName}/   (versión ${stamp}, en ${REL})`);
  if (cfg.httpsMode === 'selfsigned') ctx.log('Certificado autofirmado: el navegador avisará; es normal en red interna. Para un certificado válido usa un dominio con HTTPS_MODE=letsencrypt.');
  ctx.log(`Volver a la versión anterior: sudo node ${path.join(ctx.dir, 'rollback.mjs')}${cfg.appDir !== '/var/www/educentro' ? ` --app-dir=${cfg.appDir}` : ''}`);
  return EXIT.OK;
}

function recargarNginx(ctx) {
  if (ejecutar(ctx, 'systemctl', ['reload', 'nginx'], { silencioso: true }) === 0) return;
  exigir(ctx, 'systemctl', ['restart', 'nginx'], EXIT.NGINX, 'No se pudo recargar ni reiniciar nginx');
}

async function comprobar(cfg, ctx) {
  ctx.log('==> Comprobación');
  const https_ = cfg.httpsMode !== 'none';
  const base = https_ ? 'https://127.0.0.1' : 'http://127.0.0.1';
  const host = cfg.serverName;
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {   // nginx recarga de forma asíncrona: reintentar unos segundos
    const r = await peticion(base, '/', host, { cuerpo: true });
    ok = r.status >= 200 && r.status < 300 && /educentro/i.test(r.cuerpo);
    if (!ok) await dormir(1000);
  }
  if (!ok) throw new ErrorFatal('FALLO: / no responde (revisa: nginx -t y /var/log/nginx/error.log)', EXIT.COMPROBACION);
  ctx.log('OK  /: responde');
  for (const p of ['datos-privados/', 'docs/', 'mobile/', 'tests/', 'propuestas/', 'x.xlsx']) {
    const { status } = await peticion(base, `/${p}`, host);
    if (status !== 404) throw new ErrorFatal(`FALLO: /${p} devolvió ${status}`, EXIT.COMPROBACION);
    ctx.log(`OK  /${p}: 404 (no se publica)`);
  }
  if (cfg.withApi) {
    let c = 0;
    for (let i = 0; i < 10; i++) {   // la recarga de nginx es asíncrona: reintentar mientras siga el 404 antiguo
      c = (await peticion(base, '/api/health', host)).status;
      if (c !== 404) break;
      await dormir(1000);
    }
    if (c === 200) ctx.log('OK  /api/health: 200 (la API responde)');
    else if ([502, 503, 504].includes(c)) ctx.log(`AVISO: nginx enruta /api/ pero la API no responde en ${cfg.apiUpstream} (HTTP ${c}). Arráncala (docker compose up -d en Educentro/server) y revisa /api/health.`);
    else throw new ErrorFatal(`FALLO: /api/health devolvió ${c}: nginx no está enrutando /api/ a la API`, EXIT.COMPROBACION);
  }
}

// ---------------------------------------------------------------- CLI

export const OPCIONES = {
  'dry-run': { type: 'boolean' }, verbose: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  'server-name': { type: 'string' }, 'https-mode': { type: 'string' }, email: { type: 'string' },
  'app-dir': { type: 'string' }, keep: { type: 'string' }, 'with-api': { type: 'boolean' }, 'api-upstream': { type: 'string' },
};

const AYUDA = `Uso: sudo node deploy.mjs [opciones]
  --server-name=NOMBRE   (env SERVER_NAME)  def. IP de la VM
  --https-mode=MODO      (env HTTPS_MODE)   selfsigned (def.) | letsencrypt | none
  --email=CORREO         (env EMAIL)        solo letsencrypt
  --app-dir=RUTA         (env APP_DIR)      def. /var/www/educentro
  --keep=N               (env KEEP)         versiones a conservar, def. 5
  --with-api             (env WITH_API=1)   añade el proxy /api/
  --api-upstream=H:P     (env API_UPSTREAM) def. 127.0.0.1:3000
  --dry-run              muestra qué haría sin tocar nada (no exige root)
  --verbose              con --dry-run, imprime también los archivos generados
Códigos de salida: 0 ok, 1 error, 2 entrada inválida, 3 falta root, 4 dependencias, 5 nginx -t, 6 comprobación.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  const log = (m = '') => console.log(m);
  try {
    if (Number(process.versions.node.split('.')[0]) < 18) throw new ErrorFatal('Se necesita Node 18 o superior.', EXIT.DEPENDENCIAS);
    let parsed;
    try { parsed = parseArgs({ args: argv, options: OPCIONES, strict: true, allowPositionals: false }); } catch (e) { throw new ErrorDeEntrada(`${e.message}\n\n${AYUDA}`); }
    const opts = parsed.values;
    if (opts.help) { log(AYUDA); return EXIT.OK; }
    const cfg = resolverConfig({ env, opts, hostPorDefecto: ipPorDefecto() });
    const dry = !!opts['dry-run'];
    if (!dry && process.getuid?.() !== 0) throw new ErrorFatal('Ejecuta como root (sudo).', EXIT.ROOT);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return await desplegar(cfg, { dry, verbose: !!opts.verbose, log, dir, src: path.resolve(dir, '..') });
  } catch (e) {
    if (e instanceof ErrorDeEntrada) { console.error(`Entrada inválida: ${e.message}`); return EXIT.ENTRADA; }
    if (e instanceof ErrorFatal) { console.error(e.message); return e.code; }
    console.error(`Error inesperado: ${e?.stack || e}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = await main();
}
