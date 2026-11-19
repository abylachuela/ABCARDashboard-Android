import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { cargarConfig } from '../src/config.js';
import {
  CLAVE_BUENA, ORIGEN, cookieDe, crearApp, crearUsuario, entrar, envBase, limpiarBD, login, owner, prepararBD,
  MailerMemoria, type Contexto,
} from './helpers/app.js';

let ctx: Contexto;
let app: FastifyInstance;
beforeAll(async () => {
  await prepararBD();
  ctx = await crearApp({ LOGIN_MAX_INTENTOS: '3', LOGIN_BLOQUEO_MIN: '15' });
  app = ctx.app;
});
afterAll(async () => {
  await app.close();
  await owner().end();
});
beforeEach(limpiarBD);

const eventos = async (usuarioId?: string) =>
  (await owner().query('SELECT evento, usuario_id FROM auditoria_accesos WHERE ($1::text IS NULL OR usuario_id = $1) ORDER BY id', [usuarioId ?? null])).rows;

describe('login', () => {
  it('correcto: devuelve usuario, CSRF y fija la cookie de sesión', async () => {
    const u = await crearUsuario({ rol: 'director' });
    const r = await login(app, u.email.toUpperCase(), u.clave); // el correo no distingue mayúsculas
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.usuario).toMatchObject({ id: u.id, rol: 'director', centroId: 'ctr_prueba', refId: null });
    expect(b.usuario.hash).toBeUndefined();
    expect(b.csrfToken).toMatch(/^[\w-]{40,}$/);
    expect(b.debeCambiarClave).toBe(false);
    expect(cookieDe(r)).toBeTruthy();
    expect((await eventos(u.id)).map((e) => e.evento)).toEqual(['login_ok']);
  });

  it('el token de sesión es de 256 bits y la BD solo guarda su hash SHA-256', async () => {
    const u = await crearUsuario();
    const r = await login(app, u.email, u.clave);
    const token = cookieDe(r) as string;
    expect(Buffer.from(token, 'base64url').length).toBe(32);
    const { rows } = await owner().query('SELECT id FROM sesiones');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].id).not.toContain(token);
  });

  it('admin_red inicia sesión sin centro', async () => {
    const u = await crearUsuario({ rol: 'admin_red' });
    const r = await login(app, u.email, u.clave);
    expect(r.json().usuario.centroId).toBeNull();
  });

  it('contraseña incorrecta y usuario inexistente dan respuesta idéntica', async () => {
    const u = await crearUsuario();
    const mala = await login(app, u.email, 'Incorrecta-12345');
    const nada = await login(app, 'no-existe@prueba.test', 'Incorrecta-12345');
    expect(mala.statusCode).toBe(401);
    expect(nada.statusCode).toBe(401);
    expect(mala.body).toBe(nada.body);
    expect(mala.json().error.codigo).toBe('credenciales_invalidas');
    expect(cookieDe(mala)).toBeUndefined();
    expect(mala.headers['content-type']).toBe(nada.headers['content-type']);
  });

  it('usuario inactivo: misma respuesta genérica aunque la contraseña sea correcta', async () => {
    const u = await crearUsuario({ activo: false });
    const r = await login(app, u.email, u.clave);
    expect(r.statusCode).toBe(401);
    expect(r.json().error.codigo).toBe('credenciales_invalidas');
  });

  it('valida el cuerpo con mensajes en español y sin detalles internos', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN }, payload: { email: 'a@b.test' } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatchObject({ codigo: 'datos_invalidos', campos: ['clave'] });
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN }, payload: { email: 'a@b.test', clave: 'x', admin: true } });
    expect(r2.statusCode).toBe(422); // strict: sin campos extra
    const r3 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, 'content-type': 'application/json' }, payload: '{"email":' });
    expect(r3.statusCode).toBe(400);
    expect(r3.body).not.toMatch(/Unexpected|JSON|at /);
  });

  it('rechaza un intento de inyección SQL como credencial (consulta parametrizada)', async () => {
    const r = await login(app, "' OR '1'='1' --@x.test", "' OR '1'='1");
    expect(r.statusCode).toBe(401);
  });
});

describe('bloqueo por usuario', () => {
  it('bloquea tras N fallos, rechaza incluso la clave correcta, y registra auditoría', async () => {
    const u = await crearUsuario();
    for (let i = 0; i < 3; i++) expect((await login(app, u.email, 'Mala-clave-123')).statusCode).toBe(401);
    const { rows } = await owner().query('SELECT intentos, bloqueado_hasta > now() AS bloq FROM usuarios WHERE id = $1', [u.id]);
    expect(rows[0]).toEqual({ intentos: 3, bloq: true });
    const bloqueada = await login(app, u.email, u.clave);
    expect(bloqueada.statusCode).toBe(401);
    expect(bloqueada.json().error.codigo).toBe('credenciales_invalidas'); // no revela el bloqueo
    expect((await eventos(u.id)).map((e) => e.evento)).toEqual(['login_fallo', 'login_fallo', 'bloqueo', 'login_fallo', 'login_fallo']);
  });

  it('se desbloquea al vencer el plazo y un acceso correcto reinicia los intentos', async () => {
    const u = await crearUsuario();
    for (let i = 0; i < 3; i++) await login(app, u.email, 'Mala-clave-123');
    await owner().query("UPDATE usuarios SET bloqueado_hasta = now() - interval '1 second' WHERE id = $1", [u.id]);
    expect((await login(app, u.email, u.clave)).statusCode).toBe(200);
    const { rows } = await owner().query('SELECT intentos, bloqueado_hasta FROM usuarios WHERE id = $1', [u.id]);
    expect(rows[0]).toEqual({ intentos: 0, bloqueado_hasta: null });
  });

  it('el bloqueo crece (backoff): 15 min, luego 30 min', async () => {
    const u = await crearUsuario();
    const dur = async () =>
      Number((await owner().query('SELECT round(extract(epoch FROM (bloqueado_hasta - now())) / 60) AS m FROM usuarios WHERE id = $1', [u.id])).rows[0].m);
    for (let i = 0; i < 3; i++) await login(app, u.email, 'Mala-clave-123');
    expect(await dur()).toBe(15);
    await owner().query("UPDATE usuarios SET bloqueado_hasta = now() - interval '1 second' WHERE id = $1", [u.id]);
    for (let i = 0; i < 3; i++) await login(app, u.email, 'Mala-clave-123');
    expect(await dur()).toBe(30);
  });

  it('un usuario inexistente nunca se bloquea ni crea filas (sin enumeración)', async () => {
    for (let i = 0; i < 5; i++) await login(app, 'fantasma@prueba.test', 'Mala-clave-123');
    expect((await owner().query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n).toBe(0);
  });
});

describe('cookie de sesión', () => {
  it('desarrollo: edu_sid HttpOnly, SameSite=Lax, Path=/ y sin Secure', async () => {
    const u = await crearUsuario();
    const r = await login(app, u.email, u.clave);
    const c = r.cookies.find((x) => x.name === 'edu_sid');
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(c?.secure).toBeFalsy();
    expect(c?.domain).toBeUndefined();
    expect(Number(c?.maxAge)).toBe(12 * 3600);
  });

  it('producción: __Host-edu_sid HttpOnly; Secure; SameSite=Lax; Path=/; sin Domain', async () => {
    const config = cargarConfig(
      envBase({
        NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(48), PUBLIC_URL: ORIGEN.replace('http:', 'https:'),
        LOG_LEVEL: 'silent', MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.ejemplo.invalid',
      }),
    );
    const prod = await buildApp(config, { mailer: new MailerMemoria() });
    try {
      const u = await crearUsuario();
      const r = await prod.inject({
        method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://localhost:3000' }, payload: { email: u.email, clave: u.clave },
      });
      expect(r.statusCode).toBe(200);
      const raw = String(r.headers['set-cookie']);
      expect(raw).toMatch(/^__Host-edu_sid=/);
      for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(raw).toContain(f);
      expect(raw).not.toMatch(/Domain=/i);
      expect(r.headers['strict-transport-security']).toBeTruthy();
    } finally {
      await prod.close();
    }
  });

  it('rota el id al iniciar sesión: la sesión previa queda revocada', async () => {
    const u = await crearUsuario();
    const s1 = await entrar(app, u.email, u.clave);
    const r2 = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN, cookie: `edu_sid=${s1.cookie}` },
      payload: { email: u.email, clave: u.clave },
    });
    const c2 = cookieDe(r2) as string;
    expect(c2).not.toBe(s1.cookie);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${s1.cookie}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${c2}` } })).statusCode).toBe(200);
  });

  it('rechaza cookies falsas, manipuladas o con el hash en vez del token', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    const hash = (await owner().query('SELECT id FROM sesiones')).rows[0].id as string;
    for (const c of ['x', 'A'.repeat(43), hash, s.cookie.slice(0, -2) + 'AA']) {
      const r = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${c}` } });
      expect(r.statusCode).toBe(401);
    }
  });
});

it('usa una contraseña correcta de referencia', () => {
  expect(CLAVE_BUENA.length).toBeGreaterThanOrEqual(10);
});
