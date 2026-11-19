// Pruebas de deploy.mjs / rollback.mjs (node:test, sin dependencias, sin nginx ni root).
//   node --test Educentro/deploy/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CSP, EXIT, ErrorDeEntrada, archivosNginx, argsOpensslAutofirmado, generarApp, generarApiConf, generarApiProxy,
  generarConfigJs, generarSan, generarSite, ordenarVersiones, resolverConfig, sellarVersion, validarApiUpstream, validarAppDir,
  validarEmail, validarKeep, validarServerName, validarWithApi, esIPv4,
} from '../deploy.mjs';
import { elegirAnterior } from '../rollback.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const cfg = (extra = {}) => resolverConfig({ env: { SERVER_NAME: '10.1.2.3', ...extra } });
const rechaza = (fn, ...a) => assert.throws(() => fn(...a), ErrorDeEntrada);

test('SERVER_NAME: acepta nombres e IPv4 válidos', () => {
  for (const v of ['localhost', 'notas.midominio.edu', 'a-b.c1.edu', '10.1.2.3', '192.168.0.255', 'x']) assert.equal(validarServerName(v), v);
});

test('SERVER_NAME: rechaza inyección y formas raras', () => {
  const malos = ['', 'a;b', 'a b', '$(id)', '`id`', 'a|b', "a'b", 'a"b', 'a\nb', 'a&b', 'a/b', '..', 'a..b', '.a', 'a.', '-a.com', 'a-.com',
    'a.b;rm -rf /', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'ñandú.edu', 'a_b.edu', 'x'.repeat(64) + '.edu', ('a.'.repeat(130)) + 'edu', '{evil}', 'a#b'];
  for (const v of malos) rechaza(validarServerName, v);
});

test('esIPv4', () => {
  assert.ok(esIPv4('0.0.0.0') && esIPv4('255.255.255.255'));
  assert.ok(!esIPv4('256.0.0.1') && !esIPv4('1.2.3') && !esIPv4('a.b.c.d'));
});

test('APP_DIR: lista blanca de caracteres, sin .., ni directorios del sistema', () => {
  assert.equal(validarAppDir('/var/www/educentro'), '/var/www/educentro');
  assert.equal(validarAppDir('/srv/educentro/'), '/srv/educentro');
  assert.equal(validarAppDir('/srv/educentro-test'), '/srv/educentro-test');
  for (const v of ['', 'relativo/x', '/srv/a b', '/srv/a;b', '/srv/$(id)', '/srv/../etc', '/srv/./x', '/etc', '/', '/usr', '/var/www', '/root',
    '/srv/a\nb', '/srv/x*', "/srv/a'b", '/srv/${HOME}']) rechaza(validarAppDir, v);
});

test('KEEP, WITH_API, HTTPS_MODE, EMAIL, API_UPSTREAM', () => {
  assert.equal(validarKeep('5'), 5);
  for (const v of ['0', '-1', 'x', '5;', '101', '', '1.5']) rechaza(validarKeep, v);
  assert.equal(validarWithApi('1'), true);
  assert.equal(validarWithApi('0'), false);
  for (const v of ['2', 'true', 'yes', '']) rechaza(validarWithApi, v);
  assert.equal(validarEmail('yo@x.edu'), 'yo@x.edu');
  for (const v of ['', 'x', 'a@b', '-a@b.cc', 'a b@c.cc', 'a;b@c.cc', 'a@b.c', '$(id)@b.cc']) rechaza(validarEmail, v);
  assert.equal(validarApiUpstream('127.0.0.1:3000'), '127.0.0.1:3000');
  assert.equal(validarApiUpstream('api.local:80'), 'api.local:80');
  for (const v of ['', '127.0.0.1', 'x;y:3000', 'a:0', 'a:65536', 'a b:80', 'a:80;', 'http://a:80']) rechaza(validarApiUpstream, v);
});

test('resolverConfig: valores por defecto, precedencia de opciones y errores', () => {
  const c = cfg();
  assert.deepEqual([c.httpsMode, c.withApi, c.appDir, c.keep, c.apiUpstream], ['selfsigned', false, '/var/www/educentro', 5, '127.0.0.1:3000']);
  assert.equal(resolverConfig({ hostPorDefecto: '10.0.0.5' }).serverName, '10.0.0.5');
  assert.equal(resolverConfig({}).serverName, 'localhost');
  assert.equal(resolverConfig({ env: { SERVER_NAME: 'a.edu' }, opts: { 'server-name': 'b.edu' } }).serverName, 'b.edu');
  assert.equal(resolverConfig({ env: { WITH_API: '0' }, opts: { 'with-api': true } }).withApi, true);
  rechaza(resolverConfig, { env: { HTTPS_MODE: 'foo' } });
  rechaza(resolverConfig, { env: { HTTPS_MODE: 'letsencrypt', SERVER_NAME: 'a.edu' } });                       // sin EMAIL
  rechaza(resolverConfig, { env: { HTTPS_MODE: 'letsencrypt', SERVER_NAME: '1.2.3.4', EMAIL: 'a@b.cc' } });    // IP
  assert.equal(resolverConfig({ env: { HTTPS_MODE: 'letsencrypt', SERVER_NAME: 'a.edu', EMAIL: 'a@b.cc' } }).email, 'a@b.cc');
});

test('nginx: seguridad del sitio estático', () => {
  const app = generarApp(cfg());
  for (const loc of ['datos-privados', 'docs', 'mobile', 'tests', 'propuestas']) assert.match(app, new RegExp(`location \\^~ /${loc}/ \\{ return 404; \\}`));
  assert.match(app, /xlsx\|xls\|csv/);
  assert.match(app, /location ~ \/\\\. \{ return 404; \}/);
  assert.match(app, /root \/var\/www\/educentro\/current;/);
  assert.match(app, /server_tokens off;/);
  assert.doesNotMatch(app, /educentro-api\.conf/);
  assert.match(CSP, /frame-ancestors 'none'/);
});

test('nginx: con WITH_API se añaden proxy, zonas y límites; sin él no hay nada de API', () => {
  const sin = archivosNginx(cfg());
  assert.ok(!sin.some((a) => /api/.test(a.ruta)));
  const con = archivosNginx(cfg({ WITH_API: '1', API_UPSTREAM: '127.0.0.1:4000' }));
  const rutas = con.map((a) => path.basename(a.ruta));
  for (const r of ['educentro-api-zones.conf', 'educentro-api-proxy.conf', 'educentro-api.conf']) assert.ok(rutas.includes(r), r);
  assert.match(generarApiProxy(cfg({ API_UPSTREAM: '127.0.0.1:4000' })), /proxy_pass http:\/\/127\.0\.0\.1:4000;/);
  assert.match(generarApiProxy(cfg()), /client_max_body_size 1m;/);
  assert.match(generarApiConf(), /location \^~ \/api\/v1\/auth\/ \{\s+limit_req zone=edu_auth/);
  assert.match(generarApp(cfg({ WITH_API: '1' })), /include \/etc\/nginx\/snippets\/educentro-api\.conf;/);
});

test('nginx: IPv6 solo si el sistema lo soporta', () => {
  assert.doesNotMatch(generarSite(cfg(), { ipv6: false }), /\[::\]/);
  const v6 = generarSite(cfg(), { ipv6: true });
  assert.match(v6, /listen \[::\]:80;/);
  assert.match(v6, /listen \[::\]:443 ssl http2;/);
  assert.match(generarSite(cfg({ HTTPS_MODE: 'none' }), { ipv6: true }), /listen \[::\]:80;/);
});

test('nginx: modos de HTTPS', () => {
  const none = generarSite(cfg({ HTTPS_MODE: 'none' }));
  assert.doesNotMatch(none, /ssl|443|return 301/);
  const auto = generarSite(cfg());
  assert.match(auto, /return 301 https:\/\/\$host\$request_uri;/);
  assert.match(auto, /ssl_certificate \/etc\/ssl\/educentro\/educentro\.crt;/);
  assert.doesNotMatch(auto, /Strict-Transport-Security/);
  const le = generarSite(cfg({ HTTPS_MODE: 'letsencrypt', SERVER_NAME: 'notas.x.edu', EMAIL: 'a@b.cc' }));
  assert.match(le, /ssl_certificate \/etc\/letsencrypt\/live\/notas\.x\.edu\/fullchain\.pem;/);
  assert.match(le, /Strict-Transport-Security "max-age=31536000"/);
  assert.match(le, /server_name notas\.x\.edu;/);
});

test('certificado autofirmado: SAN y argumentos (array, sin shell)', () => {
  assert.equal(generarSan('10.1.2.3'), 'IP:10.1.2.3');
  assert.equal(generarSan('notas.x.edu'), 'DNS:notas.x.edu');
  const a = argsOpensslAutofirmado(cfg());
  assert.ok(Array.isArray(a) && a.includes('/CN=10.1.2.3') && a.includes('subjectAltName=IP:10.1.2.3'));
});

test('versiones: sello ordenable y orden de más nueva a más vieja', () => {
  assert.match(sellarVersion(new Date(2026, 0, 2, 3, 4, 5)), /^20260102-030405$/);
  const v = ['20261119-182222', '20261119-182222-1', '20261119-182228', 'basura', '..', 'current'];
  assert.deepEqual(ordenarVersiones(v), ['20261119-182228', '20261119-182222-1', '20261119-182222']);
});

test('rollback: elige la versión inmediatamente anterior', () => {
  const v = ['c', 'b', 'a'];
  assert.equal(elegirAnterior(v, 'c'), 'b');
  assert.equal(elegirAnterior(v, 'b'), 'a');
  assert.equal(elegirAnterior(v, 'a'), null);
  assert.equal(elegirAnterior(v, ''), 'c');
  assert.equal(elegirAnterior([], 'x'), null);
});

test('códigos de salida distintos y sin shell en el código', () => {
  assert.equal(new Set(Object.values(EXIT)).size, Object.keys(EXIT).length);
  for (const f of ['deploy.mjs', 'rollback.mjs']) {
    const src = fs.readFileSync(path.join(AQUI, '..', f), 'utf8');
    const imp = /import \{([^}]*)\} from 'node:child_process'/.exec(src);
    if (imp) assert.deepEqual(imp[1].split(',').map((x) => x.trim()).filter(Boolean), ['spawnSync'], `${f}: solo spawnSync (sin shell)`);
    assert.doesNotMatch(src, /shell\s*:\s*true|execSync|(?<![.\w])exec\(/, f);
    assert.doesNotMatch(src, /from ['"](?!node:|\.\/)/, `${f} solo puede importar node: y ./`);
  }
});

test('js/config.js publicado: modo api solo con WITH_API; el estático publica local', () => {
  const api = generarConfigJs(cfg({ WITH_API: '1' }));
  const est = generarConfigJs(cfg());
  assert.match(api, /modo: 'api', apiBase: '\/api\/v1'/);
  assert.match(est, /modo: 'local', apiBase: '\/api\/v1'/);
  assert.doesNotMatch(est, /'api'/ );
  // el repositorio conserva 'local' y el despliegue lo reescribe siempre
  const repo = fs.readFileSync(path.join(AQUI, '..', '..', 'js', 'config.js'), 'utf8');
  assert.match(repo, /modo: 'local'/);
  const src = fs.readFileSync(path.join(AQUI, '..', 'deploy.mjs'), 'utf8');
  assert.match(src, /generarConfigJs\(cfg\)/);
});
