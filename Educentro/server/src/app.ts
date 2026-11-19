import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { crearMailer, type Mailer } from './auth/mailer.js';
import { rutasAuth } from './auth/rutas.js';
import { exigirSesion } from './auth/guardia.js';
import type { Config } from './config.js';
import { crearPool, type Pool } from './db/pool.js';
import { aRespuesta, ErrorHttp } from './errores.js';
import { rutasSalud } from './routes/salud.js';

export interface Dependencias {
  pool?: Pool;
  mailer?: Mailer;
  /** Destino del log (por defecto stdout). Las pruebas pasan un flujo para inspeccionarlo. */
  logStream?: Writable;
}

const REDACTAR = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-edu-csrf"]',
  'res.headers["set-cookie"]',
  'res.headers.authorization',
  '*.password',
  '*.clave',
  '*.claveActual',
  '*.claveNueva',
  '*.token',
  '*.hash',
  '*.csrf',
  '*.csrfToken',
  '*.secret',
  '*.pass',
  'password',
  'clave',
  'token',
  'authorization',
  'cookie',
];

export async function buildApp(config: Config, deps: Dependencias = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: REDACTAR, censor: '[REDACTADO]' },
      // Serializadores explícitos: sin cabeceras, sin query string (podría llevar tokens).
      serializers: {
        req: (r) => ({ method: r.method, url: String(r.url ?? '').split('?')[0], remoteAddress: r.ip }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576, // 1 MB
    routerOptions: { maxParamLength: 200 },
  });

  const pool = deps.pool ?? crearPool(config.databaseUrl);
  const mailer = deps.mailer ?? crearMailer(config);
  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('mailer', mailer);
  const tareas = new Set<Promise<unknown>>();
  app.decorate('tareas', tareas);
  app.decorate('esperarTareas', async () => {
    while (tareas.size) await Promise.allSettled([...tareas]);
  });
  app.decorateRequest('sesion', undefined);

  app.removeContentTypeParser('text/plain'); // solo JSON (y sin cuerpo)
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new Error('rate limit'), {
        statusCode: 429,
        codigo: 'demasiadas_solicitudes',
        mensaje: `Demasiados intentos. Inténtalo de nuevo en ${Math.max(1, Math.ceil(ctx.ttl / 1000))} s.`,
      }),
  });

  // Cabeceras de seguridad en todas las respuestas de la API.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (config.produccion) reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.removeHeader('X-Powered-By');
  });

  // Protección CSRF, parte 1: comprobación de Origin en métodos no seguros.
  const origenesOk = new Set<string>([new URL(config.publicUrl).origin, ...config.origenesPermitidos]);
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const propio = config.produccion ? null : `${req.protocol}://${req.host}`;
      if (!origenesOk.has(origin) && origin !== propio) {
        throw new ErrorHttp(403, 'origen_no_permitido', 'Origen de la solicitud no permitido.');
      }
      return;
    }
    // Sin Origin (clientes no navegador): se rechaza si el navegador declara que es una petición entre sitios.
    const sfs = req.headers['sec-fetch-site'];
    if (sfs === 'cross-site' || sfs === 'same-site') {
      throw new ErrorHttp(403, 'origen_no_permitido', 'Origen de la solicitud no permitido.');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    let e: unknown = err;
    if (err instanceof ZodError) {
      const campos = [...new Set(err.issues.map((i) => i.path.join('.') || '(cuerpo)'))];
      e = new ErrorHttp(422, 'datos_invalidos', 'Hay datos inválidos en la solicitud.', campos);
    }
    const { status, cuerpo } = aRespuesta(e);
    if (status >= 500) req.log.error({ err: { tipo: (err as Error).name, codigo: (err as { code?: string }).code } }, 'error interno');
    return reply.code(status).send(cuerpo);
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { codigo: 'no_encontrado', mensaje: 'Recurso no encontrado.' } }),
  );

  await app.register(rutasSalud, { prefix: '/api' });
  await app.register(
    async (v1) => {
      await v1.register(rutasAuth, { prefix: '/auth' });
      v1.get('/ping', { preHandler: exigirSesion() }, async (req) => ({
        pong: true,
        usuario: req.sesion?.usuario.id,
      }));
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => {
    await app.esperarTareas();
    if (!deps.pool) await pool.end();
  });
  return app;
}

/** Limpieza periódica de sesiones y tokens caducados. La inicia server.ts, no los tests. */
export function iniciarLimpieza(app: FastifyInstance, cadaMs = 3_600_000): void {
  const t = setInterval(() => {
    const cfg = app.config;
    app.db
      .query('DELETE FROM sesiones WHERE expira <= now() OR ultima_actividad <= now() - make_interval(secs => $1)', [
        cfg.sesionInactividadSeg,
      ])
      .then(() => app.db.query("DELETE FROM tokens_recuperacion WHERE expira <= now() - interval '1 day'"))
      .catch((err: Error) => app.log.warn({ err: { tipo: err.name } }, 'fallo en la limpieza periódica'));
  }, cadaMs);
  t.unref();
  app.addHook('onClose', async () => clearInterval(t));
}
