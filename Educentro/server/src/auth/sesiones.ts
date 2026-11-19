import type { Config } from '../config.js';
import type { Ejecutor } from '../db/pool.js';
import { csrfDe, hashToken, nuevoToken } from './tokens.js';

export interface UsuarioPublico {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  centroId: string | null;
  refId: string | null;
}

export interface SesionActiva {
  id: string;
  usuario: UsuarioPublico;
  debeCambiarClave: boolean;
  csrf: string;
}

export const truncar = (s: string | undefined | null, n: number): string | null =>
  s ? s.slice(0, n) : null;

export async function crearSesion(
  db: Ejecutor,
  cfg: Config,
  usuarioId: string,
  ip: string | undefined,
  userAgent: string | undefined,
): Promise<{ token: string; id: string; csrf: string }> {
  const token = nuevoToken();
  const id = hashToken(token);
  await db.query(
    `INSERT INTO sesiones (id, usuario_id, expira, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [id, usuarioId, cfg.sesionAbsolutaSeg, truncar(ip, 45), truncar(userAgent, 200)],
  );
  return { token, id, csrf: csrfDe(cfg.sessionSecret, id) };
}

interface FilaSesion {
  id: string;
  usuario_id: string;
  centro_id: string | null;
  rol: string;
  ref_id: string | null;
  nombre: string;
  email: string;
  debe_cambiar_clave: boolean;
}

/** Devuelve la sesión válida (no caducada, sin exceso de inactividad, usuario activo) o null. */
export async function buscarSesion(db: Ejecutor, cfg: Config, token: string): Promise<SesionActiva | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const id = hashToken(token);
  const { rows } = await db.query<FilaSesion>(
    `SELECT s.id, u.id AS usuario_id, u.centro_id, u.rol, u.ref_id, u.nombre, u.email, u.debe_cambiar_clave
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = $1 AND u.activo
        AND s.expira > now()
        AND s.ultima_actividad > now() - make_interval(secs => $2)`,
    [id, cfg.sesionInactividadSeg],
  );
  const f = rows[0];
  if (!f) {
    // Limpieza oportunista de la sesión caducada (si existía).
    await db.query('DELETE FROM sesiones WHERE id = $1 AND (expira <= now() OR ultima_actividad <= now() - make_interval(secs => $2))', [
      id,
      cfg.sesionInactividadSeg,
    ]);
    return null;
  }
  await db.query(
    "UPDATE sesiones SET ultima_actividad = now() WHERE id = $1 AND ultima_actividad < now() - interval '30 seconds'",
    [id],
  );
  return {
    id: f.id,
    usuario: { id: f.usuario_id, nombre: f.nombre, email: f.email, rol: f.rol, centroId: f.centro_id, refId: f.ref_id },
    debeCambiarClave: f.debe_cambiar_clave,
    csrf: csrfDe(cfg.sessionSecret, f.id),
  };
}

export async function revocarSesion(db: Ejecutor, id: string): Promise<void> {
  await db.query('DELETE FROM sesiones WHERE id = $1', [id]);
}

export async function revocarTodas(db: Ejecutor, usuarioId: string): Promise<void> {
  await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
}
