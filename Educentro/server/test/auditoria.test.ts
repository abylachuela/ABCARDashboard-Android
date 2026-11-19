import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearPool } from '../src/db/pool.js';
import { APP_URL } from './helpers/entorno.js';
import { crearApp, crearUsuario, entrar, limpiarBD, login, owner, prepararBD, type Contexto } from './helpers/app.js';

let ctx: Contexto;
beforeAll(async () => {
  await prepararBD();
  ctx = await crearApp();
});
afterAll(async () => {
  await ctx.app.close();
  await owner().end();
});
beforeEach(limpiarBD);

describe('auditoría de accesos (append-only)', () => {
  it('registra login_ok, login_fallo, logout y la IP, sin datos personales', async () => {
    const u = await crearUsuario();
    await login(ctx.app, u.email, 'Mala-clave-123', { 'user-agent': 'PruebaUA/1.0' });
    const s = await entrar(ctx.app, u.email, u.clave);
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: s.headers });
    const { rows } = await owner().query('SELECT * FROM auditoria_accesos WHERE usuario_id = $1 ORDER BY id', [u.id]);
    expect(rows.map((r) => r.evento)).toEqual(['login_fallo', 'login_ok', 'logout']);
    expect(rows[0].ip).toBe('127.0.0.1');
    expect(rows[0].user_agent).toBe('PruebaUA/1.0');
    expect(Object.keys(rows[0]).sort()).toEqual(['evento', 'fecha', 'id', 'ip', 'user_agent', 'usuario_id']);
    expect(JSON.stringify(rows)).not.toContain(u.email);
    expect(JSON.stringify(rows)).not.toContain(u.clave);
  });

  it('trunca el user-agent y solo admite eventos conocidos', async () => {
    const u = await crearUsuario();
    await login(ctx.app, u.email, 'Mala-clave-123', { 'user-agent': 'x'.repeat(500) });
    const { rows } = await owner().query('SELECT length(user_agent) AS n FROM auditoria_accesos ORDER BY id DESC LIMIT 1');
    expect(rows[0].n).toBe(200);
    await expect(owner().query("INSERT INTO auditoria_accesos (evento) VALUES ('inventado')")).rejects.toThrow(/check/);
  });

  it('UPDATE, DELETE y TRUNCATE fallan para el rol de la aplicación', async () => {
    const u = await crearUsuario();
    await login(ctx.app, u.email, u.clave);
    const app = crearPool(APP_URL, { max: 1 });
    try {
      await expect(app.query("UPDATE auditoria_accesos SET evento = 'logout'")).rejects.toThrow(/permission denied/);
      await expect(app.query('DELETE FROM auditoria_accesos')).rejects.toThrow(/permission denied/);
      await expect(app.query('TRUNCATE auditoria_accesos')).rejects.toThrow(/permission denied/);
      expect((await app.query('SELECT count(*)::int AS n FROM auditoria_accesos')).rows[0].n).toBeGreaterThan(0);
      await app.query("INSERT INTO auditoria_accesos (evento) VALUES ('logout')"); // insertar sí
    } finally {
      await app.end();
    }
  });

  it('UPDATE, DELETE y TRUNCATE fallan incluso para el propietario (trigger)', async () => {
    const u = await crearUsuario();
    await login(ctx.app, u.email, u.clave);
    await expect(owner().query("UPDATE auditoria_accesos SET evento = 'logout'")).rejects.toThrow(/solo de anexado/);
    await expect(owner().query('DELETE FROM auditoria_accesos')).rejects.toThrow(/solo de anexado/);
    await expect(owner().query('TRUNCATE auditoria_accesos')).rejects.toThrow(/solo de anexado/);
  });

  it('sobrevive al borrado del usuario (sin clave foránea)', async () => {
    const u = await crearUsuario();
    await login(ctx.app, u.email, u.clave);
    await owner().query('DELETE FROM usuarios WHERE id = $1', [u.id]);
    const { rows } = await owner().query('SELECT count(*)::int AS n FROM auditoria_accesos WHERE usuario_id = $1', [u.id]);
    expect(rows[0].n).toBe(1);
  });
});
