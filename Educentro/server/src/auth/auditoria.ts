import type { Ejecutor } from '../db/pool.js';
import { truncar } from './sesiones.js';

export type EventoAcceso =
  | 'login_ok'
  | 'login_fallo'
  | 'logout'
  | 'bloqueo'
  | 'cambio_clave'
  | 'recuperacion_solicitada'
  | 'restablecida';

/** Solo evento, usuario, IP, agente y fecha (la pone la BD). Nunca contraseñas, tokens ni correos. */
export async function registrarAcceso(
  db: Ejecutor,
  evento: EventoAcceso,
  usuarioId: string | null,
  ip: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  await db.query('INSERT INTO auditoria_accesos (evento, usuario_id, ip, user_agent) VALUES ($1, $2, $3, $4)', [
    evento,
    usuarioId,
    truncar(ip, 45),
    truncar(userAgent, 200),
  ]);
}
