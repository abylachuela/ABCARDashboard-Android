import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { cargarConfig } from '../src/config.js';
import { crearPool } from '../src/db/pool.js';
import { MailerMemoria, crearApp, envBase, owner, prepararBD, ORIGEN } from './helpers/app.js';

let app: FastifyInstance;
beforeAll(async () => {
  await prepararBD();
  app = (await crearApp()).app;
});
afterAll(async () => {
  await app.close();
  await owner().end();
});

describe('health', () => {
  it('GET /api/health comprueba la BD y no expone datos sensibles', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ estado: 'ok' });
  });

  it('responde 503 genérico si la BD no responde', async () => {
    const pool = crearPool('postgres://educentro_app:mala@127.0.0.1:5432/educentro_test', { max: 1 });
    const a = await buildApp(cargarConfig(envBase({ LOG_LEVEL: 'silent' })), { pool, mailer: new MailerMemoria() });
    try {
      const r = await a.inject({ method: 'GET', url: '/api/health' });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ estado: 'degradado' });
      expect(r.body).not.toMatch(/password|educentro_app|127\.0\.0\.1/);
    } finally {
      await a.close();
      await pool.end();
    }
  });
});

describe('cabeceras y límites de la API', () => {
  it('añade cabeceras de seguridad y no cachea', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('rechaza cuerpos de más de 1 MB con 413 en español', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.test', clave: 'x'.repeat(1_100_000) }),
    });
    expect(r.statusCode).toBe(413);
    expect(r.json().error.codigo).toBe('cuerpo_demasiado_grande');
  });

  it('rechaza tipos de contenido no JSON (415) y rutas inexistentes (404) sin detalles internos', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, 'content-type': 'text/plain' }, payload: 'hola' });
    expect(r.statusCode).toBe(415);
    const n = await app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(n.statusCode).toBe(404);
    expect(n.json().error.codigo).toBe('no_encontrado');
  });

  it('ignora __proto__ en el cuerpo JSON (sin contaminación de prototipos)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, 'content-type': 'application/json' },
      payload: '{"email":"a@b.test","clave":"x","__proto__":{"admin":true}}',
    });
    expect([400, 422]).toContain(r.statusCode);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });
});
