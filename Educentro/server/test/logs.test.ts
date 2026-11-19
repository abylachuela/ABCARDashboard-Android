import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGEN, cookieDe, crearApp, crearUsuario, limpiarBD, login, owner, prepararBD } from './helpers/app.js';

beforeAll(prepararBD);
afterAll(() => owner().end());
beforeEach(limpiarBD);

describe('logging', () => {
  it('el log no contiene contraseñas, tokens, cookies ni CSRF a lo largo de todos los flujos', async () => {
    const ctx = await crearApp({ LOG_LEVEL: 'trace' });
    const { app, mailer, logs } = ctx;
    try {
      const u = await crearUsuario();
      const mala = 'Contrasena-erronea-XYZ-9876';
      const nueva = 'Clave-nueva-muy-secreta-4455';
      const restab = 'Clave-restablecida-secreta-7788';
      await login(app, u.email, mala);
      const l = await login(app, u.email, u.clave);
      const cookie = cookieDe(l) as string;
      const csrf = l.json().csrfToken as string;
      const h = { cookie: `edu_sid=${cookie}`, 'x-edu-csrf': csrf, origin: ORIGEN, authorization: 'Bearer token-secreto-abc' };
      await app.inject({ method: 'GET', url: '/api/v1/auth/me?token=en-la-url-123', headers: h });
      const c = await app.inject({ method: 'POST', url: '/api/v1/auth/cambiar-clave', headers: h, payload: { claveActual: u.clave, claveNueva: nueva } });
      await app.inject({ method: 'POST', url: '/api/v1/auth/recuperar', headers: { origin: ORIGEN }, payload: { email: u.email } });
      await app.esperarTareas();
      const tokenReset = mailer.tokenDe();
      await app.inject({ method: 'POST', url: '/api/v1/auth/restablecer', headers: { origin: ORIGEN }, payload: { token: tokenReset, clave: restab } });
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, 'content-type': 'application/json' }, payload: '{"email":"x","clave":"JSON-roto-secreto' });

      const todo = logs.join('');
      expect(todo.length).toBeGreaterThan(500);
      for (const secreto of [
        mala, u.clave, nueva, restab, cookie, cookieDe(c) as string, csrf, tokenReset, 'token-secreto-abc', 'en-la-url-123', 'JSON-roto-secreto',
        u.email, // tampoco correos
      ]) {
        expect(todo, `el log contiene ${secreto.slice(0, 8)}…`).not.toContain(secreto);
      }
      expect(todo).not.toMatch(/set-cookie/i);
    } finally {
      await app.close();
    }
  });
});
