import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGEN, crearApp, crearUsuario, entrar, limpiarBD, login, owner, prepararBD } from './helpers/app.js';

let app: FastifyInstance;
beforeAll(async () => {
  await prepararBD();
  app = (await crearApp({ ALLOWED_ORIGINS: 'https://localhost' })).app;
});
afterAll(async () => {
  await app.close();
  await owner().end();
});
beforeEach(limpiarBD);

const post = (url: string, headers: Record<string, string>, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers, payload });

describe('CSRF: cabecera X-EDU-CSRF', () => {
  it('métodos no seguros con sesión exigen la cabecera correcta', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    const cuerpo = { claveActual: u.clave, claveNueva: 'Nueva-clave-segura-77' };
    const sin = await post('/api/v1/auth/cambiar-clave', { cookie: `edu_sid=${s.cookie}`, origin: ORIGEN }, cuerpo);
    expect(sin.statusCode).toBe(403);
    expect(sin.json().error.codigo).toBe('csrf_invalido');
    const mal = await post('/api/v1/auth/cambiar-clave', { cookie: `edu_sid=${s.cookie}`, origin: ORIGEN, 'x-edu-csrf': 'a'.repeat(43) }, cuerpo);
    expect(mal.statusCode).toBe(403);
    const ok = await post('/api/v1/auth/cambiar-clave', s.headers, cuerpo);
    expect(ok.statusCode).toBe(200);
  });

  it('el token CSRF de otra sesión no sirve', async () => {
    const a = await crearUsuario();
    const b = await crearUsuario();
    const sa = await entrar(app, a.email, a.clave);
    const sb = await entrar(app, b.email, b.clave);
    const r = await post('/api/v1/auth/logout', { cookie: `edu_sid=${sa.cookie}`, 'x-edu-csrf': sb.csrf, origin: ORIGEN });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: s(sa) })).statusCode).toBe(200); // sigue viva
  });

  it('logout sin CSRF no cierra la sesión; con CSRF sí', async () => {
    const u = await crearUsuario();
    const s1 = await entrar(app, u.email, u.clave);
    expect((await post('/api/v1/auth/logout', { cookie: `edu_sid=${s1.cookie}`, origin: ORIGEN })).statusCode).toBe(403);
    expect((await post('/api/v1/auth/logout', s1.headers)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: s(s1) })).statusCode).toBe(401);
  });

  it('GET no exige CSRF', async () => {
    const u = await crearUsuario();
    const s1 = await entrar(app, u.email, u.clave);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { cookie: `edu_sid=${s1.cookie}` } })).statusCode).toBe(200);
  });
});

const s = (x: { cookie: string }) => ({ cookie: `edu_sid=${x.cookie}` });

describe('CSRF: comprobación de Origin', () => {
  it('rechaza orígenes ajenos, "null" y esquemas distintos en métodos no seguros', async () => {
    const u = await crearUsuario();
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3001', 'https://localhost:3000']) {
      const r = await login(app, u.email, u.clave, { origin });
      expect(r.statusCode, origin).toBe(403);
      expect(r.json().error.codigo).toBe('origen_no_permitido');
    }
  });

  it('acepta el origen público y los de ALLOWED_ORIGINS (p. ej. Capacitor)', async () => {
    const u = await crearUsuario();
    expect((await login(app, u.email, u.clave, { origin: ORIGEN })).statusCode).toBe(200);
    expect((await login(app, u.email, u.clave, { origin: 'https://localhost' })).statusCode).toBe(200);
  });

  it('sin Origin se permite a clientes no navegador, pero no si el navegador declara cross-site', async () => {
    const u = await crearUsuario();
    const base = { method: 'POST' as const, url: '/api/v1/auth/login', payload: { email: u.email, clave: u.clave } };
    expect((await app.inject({ ...base })).statusCode).toBe(200);
    expect((await app.inject({ ...base, headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
    expect((await app.inject({ ...base, headers: { 'sec-fetch-site': 'same-origin' } })).statusCode).toBe(200);
  });

  it('con una sesión válida, un Origin ajeno falla antes de tocar nada', async () => {
    const u = await crearUsuario();
    const s1 = await entrar(app, u.email, u.clave);
    const r = await post('/api/v1/auth/logout', { ...s1.headers, origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: s(s1) })).statusCode).toBe(200);
  });

  it('no hay cabeceras CORS (mismo origen)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});
