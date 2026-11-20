import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGEN, crearApp, crearUsuario, entrar, limpiarBD, login, owner, prepararBD, type Contexto } from './helpers/app.js';

let ctx: Contexto;
let app: FastifyInstance;
beforeAll(async () => {
  await prepararBD();
  ctx = await crearApp({ LOGIN_MAX_INTENTOS: '3' });
  app = ctx.app;
});
afterAll(async () => {
  await app.close();
  await owner().end();
});
beforeEach(async () => {
  await limpiarBD();
  ctx.mailer.enviados.length = 0;
});

const recuperar = async (email: string) => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/recuperar', headers: { origin: ORIGEN }, payload: { email } });
  await app.esperarTareas();
  return r;
};
const restablecer = (token: string, clave: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/restablecer', headers: { origin: ORIGEN }, payload: { token, clave } });

describe('recuperar', () => {
  it('responde 202 idéntico exista o no el correo; solo envía correo si existe', async () => {
    const u = await crearUsuario();
    const a = await recuperar(u.email);
    const b = await recuperar('no-existe@prueba.test');
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(a.body).toBe(b.body);
    expect(ctx.mailer.enviados).toHaveLength(1);
    expect(ctx.mailer.enviados[0]?.destino).toBe(u.email);
    expect(ctx.mailer.enviados[0]?.enlace).toMatch(/^http:\/\/localhost:3000\/#\/restablecer\/[\w-]{40,}$/);
  });

  it('un usuario inactivo recibe el mismo 202 y ningún correo', async () => {
    const u = await crearUsuario({ activo: false });
    expect((await recuperar(u.email)).statusCode).toBe(202);
    expect(ctx.mailer.enviados).toHaveLength(0);
  });

  it('solo guarda el hash del token, con caducidad de 30 min', async () => {
    const u = await crearUsuario();
    await recuperar(u.email);
    const token = ctx.mailer.tokenDe();
    const { rows } = await owner().query(
      'SELECT hash, usado_en, round(extract(epoch FROM (expira - creado_en)) / 60) AS min FROM tokens_recuperacion',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(rows[0].hash).not.toContain(token);
    expect(Number(rows[0].min)).toBe(30);
    expect(rows[0].usado_en).toBeNull();
  });

  it('limita a un enlace por minuto y usuario; uno nuevo invalida el anterior', async () => {
    const u = await crearUsuario();
    await recuperar(u.email);
    await recuperar(u.email);
    expect(ctx.mailer.enviados).toHaveLength(1);
    await owner().query("UPDATE tokens_recuperacion SET creado_en = now() - interval '2 minutes'");
    await recuperar(u.email);
    expect(ctx.mailer.enviados).toHaveLength(2);
    expect((await restablecer(ctx.mailer.tokenDe(0), 'Nueva-clave-segura-77')).statusCode).toBe(400);
    expect((await restablecer(ctx.mailer.tokenDe(1), 'Nueva-clave-segura-77')).statusCode).toBe(200);
  });

  it('un fallo del correo no cambia la respuesta ni filtra detalles', async () => {
    const u = await crearUsuario();
    const original = ctx.mailer.enviarRecuperacion.bind(ctx.mailer);
    ctx.mailer.enviarRecuperacion = async () => {
      throw Object.assign(new Error('smtp caído: secreto@interno'), { code: 'ECONNREFUSED' });
    };
    const r = await recuperar(u.email);
    ctx.mailer.enviarRecuperacion = original;
    expect(r.statusCode).toBe(202);
    expect(ctx.logs.join('')).not.toContain('secreto@interno');
  });
});

describe('restablecer', () => {
  it('cambia la clave, revoca todas las sesiones y limpia el bloqueo', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    for (let i = 0; i < 3; i++) await login(app, u.email, 'Mala-clave-123'); // bloquea
    await recuperar(u.email);
    const r = await restablecer(ctx.mailer.tokenDe(), 'Clave-restablecida-91');
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${s.cookie}` } })).statusCode).toBe(401);
    expect((await login(app, u.email, u.clave)).statusCode).toBe(401);
    expect((await login(app, u.email, 'Clave-restablecida-91')).statusCode).toBe(200);
    const evs = (await owner().query("SELECT evento FROM auditoria_accesos WHERE usuario_id = $1 AND evento IN ('restablecida','recuperacion_solicitada')", [u.id])).rows.map((x) => x.evento).sort();
    expect(evs).toEqual(['recuperacion_solicitada', 'restablecida']);
  });

  it('el token es de un solo uso', async () => {
    const u = await crearUsuario();
    await recuperar(u.email);
    const token = ctx.mailer.tokenDe();
    expect((await restablecer(token, 'Clave-restablecida-91')).statusCode).toBe(200);
    const otra = await restablecer(token, 'Otra-clave-distinta-23');
    expect(otra.statusCode).toBe(400);
    expect(otra.json().error.codigo).toBe('token_invalido');
    expect((await login(app, u.email, 'Clave-restablecida-91')).statusCode).toBe(200);
  });

  it('un token caducado o inexistente da el mismo error', async () => {
    const u = await crearUsuario();
    await recuperar(u.email);
    await owner().query("UPDATE tokens_recuperacion SET expira = now() - interval '1 second'");
    const caducado = await restablecer(ctx.mailer.tokenDe(), 'Clave-restablecida-91');
    const falso = await restablecer('A'.repeat(43), 'Clave-restablecida-91');
    expect(caducado.statusCode).toBe(400);
    expect(caducado.body).toBe(falso.body);
    expect((await login(app, u.email, u.clave)).statusCode).toBe(200); // clave intacta
  });

  it('una clave que incumple la política no consume el token', async () => {
    const u = await crearUsuario();
    await recuperar(u.email);
    const token = ctx.mailer.tokenDe();
    const mala = await restablecer(token, 'password123');
    expect(mala.statusCode).toBe(422);
    expect(mala.json().error.codigo).toBe('clave_no_valida');
    expect((await restablecer(token, 'Clave-restablecida-91')).statusCode).toBe(200);
  });

  it('cambiar la clave estando autenticado también invalida los enlaces pendientes', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    await recuperar(u.email);
    await app.inject({ method: 'POST', url: '/api/v1/auth/cambiar-clave', headers: s.headers, payload: { claveActual: u.clave, claveNueva: 'Nueva-clave-segura-77' } });
    expect((await restablecer(ctx.mailer.tokenDe(), 'Clave-restablecida-91')).statusCode).toBe(400);
  });
});
