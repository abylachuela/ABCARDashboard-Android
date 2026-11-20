import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorHttp } from '../errores.js';
import { nombreCookie, opcionesBorrado } from './cookie.js';
import { buscarSesion } from './sesiones.js';
import { igualesSeguro } from './tokens.js';

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resuelve la sesión desde la cookie (sin exigirla). */
export async function resolverSesion(req: FastifyRequest): Promise<void> {
  const token = req.cookies[nombreCookie(req.server.config)];
  if (token) req.sesion = (await buscarSesion(req.server.db, req.server.config, token)) ?? undefined;
}

export function verificarCsrf(req: FastifyRequest): void {
  if (SEGUROS.has(req.method) || !req.sesion) return;
  const h = req.headers['x-edu-csrf'];
  if (typeof h !== 'string' || !igualesSeguro(h, req.sesion.csrf)) {
    throw new ErrorHttp(403, 'csrf_invalido', 'Solicitud rechazada por seguridad. Recarga la página e inténtalo de nuevo.');
  }
}

/** preHandler: exige sesión válida; en métodos no seguros exige CSRF. Bloquea si la clave debe cambiarse. */
export function exigirSesion(opciones: { permitirCambioPendiente?: boolean } = {}) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await resolverSesion(req);
    if (!req.sesion) {
      if (req.cookies[nombreCookie(req.server.config)]) {
        reply.clearCookie(nombreCookie(req.server.config), opcionesBorrado(req.server.config));
      }
      throw new ErrorHttp(401, 'no_autenticado', 'Debes iniciar sesión.');
    }
    verificarCsrf(req);
    if (req.sesion.debeCambiarClave && !opciones.permitirCambioPendiente) {
      throw new ErrorHttp(403, 'cambio_clave_obligatorio', 'Debes cambiar tu contraseña antes de continuar.');
    }
  };
}
