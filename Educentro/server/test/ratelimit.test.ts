import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGEN, crearApp, crearUsuario, limpiarBD, login, owner, prepararBD } from './helpers/app.js';

beforeAll(prepararBD);
afterAll(() => owner().end());
beforeEach(limpiarBD);

describe('rate limit por IP en /auth/*', () => {
  it('limita login tras el máximo configurado con 429 y mensaje en español', async () => {
    const { app } = await crearApp({ RATE_LIMIT_AUTH_MAX: '4', RATE_LIMIT_WINDOW_S: '60' });
    try {
      const u = await crearUsuario();
      const codigos: number[] = [];
      for (let i = 0; i < 6; i++) codigos.push((await login(app, u.email, 'Mala-clave-123')).statusCode);
      expect(codigos).toEqual([401, 401, 401, 401, 429, 429]);
      const r = await login(app, u.email, u.clave); // ni la clave correcta pasa mientras dure el límite
      expect(r.statusCode).toBe(429);
      expect(r.json().error.codigo).toBe('demasiadas_solicitudes');
      expect(r.json().error.mensaje).toMatch(/Demasiados intentos/);
      expect(r.headers['retry-after']).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('recuperar tiene su propio límite, más estricto', async () => {
    const { app } = await crearApp({ RATE_LIMIT_RECUPERAR_MAX: '2' });
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await app.inject({ method: 'POST', url: '/api/v1/auth/recuperar', headers: { origin: ORIGEN }, payload: { email: 'x@y.test' } });
        codigos.push(r.statusCode);
      }
      expect(codigos).toEqual([202, 202, 429, 429]);
    } finally {
      await app.close();
    }
  });

  it('con TRUST_PROXY la clave del límite es la IP de X-Forwarded-For; sin él se ignora la cabecera', async () => {
    const con = await crearApp({ RATE_LIMIT_AUTH_MAX: '1', TRUST_PROXY: '127.0.0.1' });
    const sin = await crearApp({ RATE_LIMIT_AUTH_MAX: '1' });
    try {
      const intento = (a: typeof con.app, ip: string) => login(a, 'a@b.test', 'Mala-clave-123', { 'x-forwarded-for': ip });
      expect((await intento(con.app, '203.0.113.1')).statusCode).toBe(401);
      expect((await intento(con.app, '203.0.113.2')).statusCode).toBe(401); // otra IP, otro cubo
      expect((await intento(con.app, '203.0.113.1')).statusCode).toBe(429);
      expect((await intento(sin.app, '203.0.113.1')).statusCode).toBe(401);
      expect((await intento(sin.app, '203.0.113.2')).statusCode).toBe(429); // el cliente no puede falsear su IP
    } finally {
      await con.app.close();
      await sin.app.close();
    }
  });
});
