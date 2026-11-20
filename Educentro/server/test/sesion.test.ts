import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGEN, cookieDe, crearApp, crearUsuario, entrar, limpiarBD, login, owner, prepararBD } from './helpers/app.js';

let app: FastifyInstance;
beforeAll(async () => {
  await prepararBD();
  app = (await crearApp()).app;
});
afterAll(async () => {
  await app.close();
  await owner().end();
});
beforeEach(limpiarBD);

const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${cookie}` } });
const cambiar = (s: { headers: Record<string, string> }, claveActual: string, claveNueva: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/cambiar-clave', headers: s.headers, payload: { claveActual, claveNueva } });

describe('sesión', () => {
  it('GET /me devuelve el usuario y un CSRF estable; sin cookie, 401 en español', async () => {
    const u = await crearUsuario({ rol: 'tutor' });
    const s = await entrar(app, u.email, u.clave);
    const r = await me(s.cookie);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ usuario: { id: u.id, rol: 'tutor' }, csrfToken: s.csrf });
    const sin = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(sin.statusCode).toBe(401);
    expect(sin.json().error).toEqual({ codigo: 'no_autenticado', mensaje: 'Debes iniciar sesión.' });
  });

  it('caduca por inactividad (2 h) y se borra', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    await owner().query("UPDATE sesiones SET ultima_actividad = now() - interval '119 minutes'");
    expect((await me(s.cookie)).statusCode).toBe(200); // aún dentro del plazo (y renueva la actividad)
    await owner().query("UPDATE sesiones SET ultima_actividad = now() - interval '121 minutes'");
    expect((await me(s.cookie)).statusCode).toBe(401);
    expect((await owner().query('SELECT count(*)::int AS n FROM sesiones')).rows[0].n).toBe(0);
  });

  it('caduca de forma absoluta (12 h) aunque haya actividad', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    await owner().query("UPDATE sesiones SET creada = now() - interval '13 hours', expira = now() - interval '1 hour'");
    expect((await me(s.cookie)).statusCode).toBe(401);
  });

  it('la actividad renueva la inactividad', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    await owner().query("UPDATE sesiones SET ultima_actividad = now() - interval '100 minutes'");
    await me(s.cookie);
    const { rows } = await owner().query("SELECT ultima_actividad > now() - interval '1 minute' AS reciente FROM sesiones");
    expect(rows[0].reciente).toBe(true);
  });

  it('un usuario desactivado pierde el acceso con su sesión vigente', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    await owner().query('UPDATE usuarios SET activo = false WHERE id = $1', [u.id]);
    expect((await me(s.cookie)).statusCode).toBe(401);
  });

  it('logout revoca la sesión y borra la cookie; sin sesión también responde 204', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: s.headers });
    expect(r.statusCode).toBe(204);
    expect(String(r.headers['set-cookie'])).toMatch(/edu_sid=;/);
    expect((await me(s.cookie)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin: ORIGEN } })).statusCode).toBe(204);
  });

  it('GET /api/v1/ping exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/ping' })).statusCode).toBe(401);
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    const r = await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { cookie: `edu_sid=${s.cookie}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ pong: true, usuario: u.id });
  });
});

describe('cambiar contraseña', () => {
  it('revoca TODAS las sesiones, emite una nueva y la clave vieja deja de servir', async () => {
    const u = await crearUsuario();
    const s1 = await entrar(app, u.email, u.clave);
    const s2 = await entrar(app, u.email, u.clave);
    const r = await cambiar(s1, u.clave, 'Nueva-clave-segura-77');
    expect(r.statusCode).toBe(200);
    expect((await me(s1.cookie)).statusCode).toBe(401);
    expect((await me(s2.cookie)).statusCode).toBe(401);
    const nueva = cookieDe(r) as string;
    expect((await me(nueva)).statusCode).toBe(200);
    expect((await login(app, u.email, u.clave)).statusCode).toBe(401);
    expect((await login(app, u.email, 'Nueva-clave-segura-77')).statusCode).toBe(200);
    expect((await owner().query("SELECT count(*)::int AS n FROM auditoria_accesos WHERE evento = 'cambio_clave' AND usuario_id = $1", [u.id])).rows[0].n).toBe(1);
  });

  it('exige la contraseña actual correcta (y suma un fallo)', async () => {
    const u = await crearUsuario();
    const s = await entrar(app, u.email, u.clave);
    const r = await cambiar(s, 'Equivocada-12345', 'Nueva-clave-segura-77');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.codigo).toBe('clave_actual_incorrecta');
    expect((await owner().query('SELECT intentos FROM usuarios WHERE id = $1', [u.id])).rows[0].intentos).toBe(1);
    expect((await me(s.cookie)).statusCode).toBe(200); // no se revoca nada
  });

  it('aplica la política: corta, común, con el correo y repetida', async () => {
    const u = await crearUsuario({ email: 'persona.prueba@escuela.test' });
    const s = await entrar(app, u.email, u.clave);
    for (const mala of ['Corta1!', 'password123', 'xpersona.pruebax1', u.clave]) {
      const r = await cambiar(s, u.clave, mala);
      expect(r.statusCode, mala).toBe(422);
      expect(r.json().error.codigo).toBe('clave_no_valida');
    }
    expect((await me(s.cookie)).statusCode).toBe(200);
  });

  it('con debe_cambiar_clave solo permite /me, cambiar-clave y logout', async () => {
    const u = await crearUsuario({ debeCambiar: true });
    const l = await login(app, u.email, u.clave);
    expect(l.json().debeCambiarClave).toBe(true);
    const s = await entrar(app, u.email, u.clave);
    const ping = await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { cookie: `edu_sid=${s.cookie}` } });
    expect(ping.statusCode).toBe(403);
    expect(ping.json().error.codigo).toBe('cambio_clave_obligatorio');
    expect((await me(s.cookie)).statusCode).toBe(200);
    const r = await cambiar(s, u.clave, 'Nueva-clave-segura-77');
    expect(r.statusCode).toBe(200);
    expect(r.json().debeCambiarClave).toBe(false);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { cookie: `edu_sid=${cookieDe(r)}` } });
    expect(ok.statusCode).toBe(200);
  });
});
