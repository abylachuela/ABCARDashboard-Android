import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { transaccion, type Ejecutor } from '../db/pool.js';
import { ErrorHttp } from '../errores.js';
import { registrarAcceso } from './auditoria.js';
import { nombreCookie, opcionesBorrado, opcionesCookie } from './cookie.js';
import { exigirSesion, resolverSesion, verificarCsrf } from './guardia.js';
import { hashClave, hashFicticio, verificarClave } from './password.js';
import { validarClave } from './politica.js';
import { crearSesion, revocarSesion, revocarTodas, type SesionActiva } from './sesiones.js';
import { hashToken, nuevoToken } from './tokens.js';

const emailEsquema = z.string().trim().min(3).max(254).transform((s) => s.toLowerCase());
const claveEsquema = z.string().min(1).max(1024);

const loginEsquema = z.object({ email: emailEsquema, clave: claveEsquema }).strict();
const cambiarEsquema = z.object({ claveActual: claveEsquema, claveNueva: claveEsquema }).strict();
const recuperarEsquema = z.object({ email: emailEsquema }).strict();
const restablecerEsquema = z
  .object({ token: z.string().min(20).max(200), clave: claveEsquema })
  .strict();

const MSG_LOGIN = 'Correo o contraseña incorrectos, o la cuenta está bloqueada temporalmente.';
const MSG_RECUPERAR = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
const MSG_TOKEN = 'El enlace no es válido o ya caducó. Solicita uno nuevo.';

interface FilaUsuario {
  id: string;
  centro_id: string | null;
  rol: string;
  ref_id: string | null;
  nombre: string;
  email: string;
  hash: string;
  activo: boolean;
  debe_cambiar_clave: boolean;
  bloqueado: boolean;
}

const usuarioDe = (u: Pick<FilaUsuario, 'id' | 'nombre' | 'email' | 'rol' | 'centro_id' | 'ref_id'>) => ({
  id: u.id,
  nombre: u.nombre,
  email: u.email,
  rol: u.rol,
  centroId: u.centro_id,
  refId: u.ref_id,
});

const agente = (req: FastifyRequest) => req.headers['user-agent'];

/** Suma un fallo y, si toca, bloquea con retroceso exponencial (15 min, 30, 60… hasta 24 h). Devuelve si bloqueó. */
export async function registrarFallo(db: Ejecutor, cfgMax: number, cfgMin: number, usuarioId: string): Promise<boolean> {
  const { rows } = await db.query<{ bloqueado: boolean }>(
    `UPDATE usuarios SET
       intentos = intentos + 1,
       bloqueado_hasta = CASE WHEN (intentos + 1) % $2 = 0
         THEN now() + make_interval(mins => LEAST(1440, $3 * (2 ^ LEAST(10, ((intentos + 1) / $2) - 1))::int))
         ELSE bloqueado_hasta END
     WHERE id = $1
     RETURNING ((intentos) % $2 = 0) AS bloqueado`,
    [usuarioId, cfgMax, cfgMin],
  );
  return rows[0]?.bloqueado ?? false;
}

function emitirSesion(req: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.setCookie(nombreCookie(req.server.config), token, opcionesCookie(req.server.config));
}

export const rutasAuth: FastifyPluginAsync = async (app) => {
  const cfg = app.config;
  const limite = (max: number) => ({ config: { rateLimit: { max, timeWindow: cfg.rateLimitVentanaSeg * 1000 } } });

  // ---- POST /login
  app.post('/login', limite(cfg.rateLimitAuthMax), async (req, reply) => {
    const { email, clave } = loginEsquema.parse(req.body);
    const { rows } = await app.db.query<FilaUsuario>(
      `SELECT id, centro_id, rol, ref_id, nombre, email, hash, activo, debe_cambiar_clave,
              (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueado
         FROM usuarios WHERE email = $1`,
      [email],
    );
    const u = rows[0];
    // Siempre se verifica un hash (ficticio si no existe): mismo coste y misma respuesta en todos los casos de fallo.
    const correcta = await verificarClave(u ? u.hash : await hashFicticio(), clave);

    if (!u || !u.activo || u.bloqueado || !correcta) {
      if (u && u.activo && !u.bloqueado) {
        const bloqueo = await registrarFallo(app.db, cfg.loginMaxIntentos, cfg.loginBloqueoMin, u.id);
        if (bloqueo) await registrarAcceso(app.db, 'bloqueo', u.id, req.ip, agente(req));
      }
      await registrarAcceso(app.db, 'login_fallo', u?.id ?? null, req.ip, agente(req));
      throw new ErrorHttp(401, 'credenciales_invalidas', MSG_LOGIN);
    }

    // Rotación: si llegó con una sesión previa, se revoca; la nueva siempre tiene un id nuevo.
    const previo = req.cookies[nombreCookie(cfg)];
    const sesion = await transaccion(app.db, async (c) => {
      await c.query('UPDATE usuarios SET intentos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
      if (previo) await revocarSesion(c, hashToken(previo));
      const s = await crearSesion(c, cfg, u.id, req.ip, agente(req));
      await registrarAcceso(c, 'login_ok', u.id, req.ip, agente(req));
      return s;
    });
    emitirSesion(req, reply, sesion.token);
    return { usuario: usuarioDe(u), csrfToken: sesion.csrf, debeCambiarClave: u.debe_cambiar_clave };
  });

  // ---- POST /logout
  app.post('/logout', limite(cfg.rateLimitAuthMax * 6), async (req, reply) => {
    await resolverSesion(req);
    if (req.sesion) {
      verificarCsrf(req);
      await app.db.query('DELETE FROM sesiones WHERE id = $1', [req.sesion.id]);
      await registrarAcceso(app.db, 'logout', req.sesion.usuario.id, req.ip, agente(req));
    }
    reply.clearCookie(nombreCookie(cfg), opcionesBorrado(cfg));
    return reply.code(204).send();
  });

  // ---- GET /me
  app.get('/me', { preHandler: exigirSesion({ permitirCambioPendiente: true }), ...limite(cfg.rateLimitAuthMax * 6) }, async (req) => {
    const s = req.sesion as SesionActiva;
    return { usuario: s.usuario, csrfToken: s.csrf, debeCambiarClave: s.debeCambiarClave };
  });

  // ---- POST /cambiar-clave
  app.post(
    '/cambiar-clave',
    { preHandler: exigirSesion({ permitirCambioPendiente: true }), ...limite(cfg.rateLimitAuthMax) },
    async (req, reply) => {
      const s = req.sesion as SesionActiva;
      const { claveActual, claveNueva } = cambiarEsquema.parse(req.body);
      const { rows } = await app.db.query<{ hash: string }>('SELECT hash FROM usuarios WHERE id = $1', [s.usuario.id]);
      const hashActual = rows[0]?.hash;
      if (!hashActual || !(await verificarClave(hashActual, claveActual))) {
        // También cuenta como fallo: una sesión robada no debe poder adivinar la contraseña a ritmo libre.
        const bloqueo = await registrarFallo(app.db, cfg.loginMaxIntentos, cfg.loginBloqueoMin, s.usuario.id);
        if (bloqueo) await registrarAcceso(app.db, 'bloqueo', s.usuario.id, req.ip, agente(req));
        await registrarAcceso(app.db, 'login_fallo', s.usuario.id, req.ip, agente(req));
        throw new ErrorHttp(403, 'clave_actual_incorrecta', 'La contraseña actual no es correcta.');
      }
      const motivo = validarClave(claveNueva, { email: s.usuario.email, nombre: s.usuario.nombre });
      if (motivo) throw new ErrorHttp(422, 'clave_no_valida', motivo);
      if (claveNueva === claveActual) {
        throw new ErrorHttp(422, 'clave_no_valida', 'La nueva contraseña debe ser distinta de la actual.');
      }
      const nuevoHash = await hashClave(claveNueva);
      const sesion = await transaccion(app.db, async (c) => {
        await c.query(
          'UPDATE usuarios SET hash = $2, debe_cambiar_clave = false, intentos = 0, bloqueado_hasta = NULL WHERE id = $1',
          [s.usuario.id, nuevoHash],
        );
        await revocarTodas(c, s.usuario.id); // incluye la sesión actual
        await c.query('UPDATE tokens_recuperacion SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL', [s.usuario.id]);
        const nueva = await crearSesion(c, cfg, s.usuario.id, req.ip, agente(req));
        await registrarAcceso(c, 'cambio_clave', s.usuario.id, req.ip, agente(req));
        return nueva;
      });
      emitirSesion(req, reply, sesion.token);
      return { usuario: s.usuario, csrfToken: sesion.csrf, debeCambiarClave: false };
    },
  );

  // ---- POST /recuperar  (siempre 202; el trabajo real va en segundo plano para no filtrar por tiempo)
  app.post('/recuperar', limite(cfg.rateLimitRecuperarMax), async (req, reply) => {
    const { email } = recuperarEsquema.parse(req.body);
    const ip = req.ip;
    const ua = agente(req);
    const trabajo = (async () => {
      const { rows } = await app.db.query<{ id: string; nombre: string; email: string }>(
        'SELECT id, nombre, email FROM usuarios WHERE email = $1 AND activo',
        [email],
      );
      const u = rows[0];
      if (!u) {
        await registrarAcceso(app.db, 'recuperacion_solicitada', null, ip, ua);
        return;
      }
      const token = nuevoToken();
      const emitido = await transaccion(app.db, async (c) => {
        // Anti-bombardeo de correo: como máximo un enlace por minuto y usuario.
        const { rowCount } = await c.query(
          "SELECT 1 FROM tokens_recuperacion WHERE usuario_id = $1 AND creado_en > now() - interval '60 seconds'",
          [u.id],
        );
        if (rowCount) return false;
        await c.query('UPDATE tokens_recuperacion SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL', [u.id]);
        await c.query(
          `INSERT INTO tokens_recuperacion (hash, usuario_id, expira)
           VALUES ($1, $2, now() + make_interval(mins => $3))`,
          [hashToken(token), u.id, cfg.resetTokenMin],
        );
        await registrarAcceso(c, 'recuperacion_solicitada', u.id, ip, ua);
        return true;
      });
      if (emitido) {
        // El enlace usa fragmento (#): no viaja al servidor web ni a sus registros.
        await app.mailer.enviarRecuperacion(u.email, u.nombre, `${cfg.publicUrl}/#/restablecer/${token}`, cfg.resetTokenMin);
      }
    })().catch((err: Error & { code?: string }) => {
      app.log.error({ err: { tipo: err.name, codigo: err.code } }, 'fallo en la recuperación de contraseña');
    });
    app.tareas.add(trabajo);
    void trabajo.finally(() => app.tareas.delete(trabajo));
    return reply.code(202).send({ mensaje: MSG_RECUPERAR });
  });

  // ---- POST /restablecer
  app.post('/restablecer', limite(cfg.rateLimitAuthMax), async (req, reply) => {
    const { token, clave } = restablecerEsquema.parse(req.body);
    const hashT = hashToken(token);
    const nuevoHash = await hashClave(clave); // coste constante aunque el token sea inválido
    await transaccion(app.db, async (c) => {
      const { rows } = await c.query<{ usuario_id: string; email: string; nombre: string }>(
        `SELECT t.usuario_id, u.email, u.nombre
           FROM tokens_recuperacion t JOIN usuarios u ON u.id = t.usuario_id
          WHERE t.hash = $1 AND t.usado_en IS NULL AND t.expira > now() AND u.activo
          FOR UPDATE OF t`,
        [hashT],
      );
      const f = rows[0];
      if (!f) throw new ErrorHttp(400, 'token_invalido', MSG_TOKEN);
      const motivo = validarClave(clave, { email: f.email, nombre: f.nombre });
      if (motivo) throw new ErrorHttp(422, 'clave_no_valida', motivo); // revierte: el token no se consume
      await c.query('UPDATE tokens_recuperacion SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL', [f.usuario_id]);
      await c.query(
        'UPDATE usuarios SET hash = $2, debe_cambiar_clave = false, intentos = 0, bloqueado_hasta = NULL WHERE id = $1',
        [f.usuario_id, nuevoHash],
      );
      await revocarTodas(c, f.usuario_id);
      await registrarAcceso(c, 'restablecida', f.usuario_id, req.ip, agente(req));
    });
    reply.clearCookie(nombreCookie(cfg), opcionesBorrado(cfg));
    return { mensaje: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' };
  });
};
