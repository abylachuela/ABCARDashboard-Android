import type { Config } from './config.js';
import type { Mailer } from './auth/mailer.js';
import type { SesionActiva } from './auth/sesiones.js';
import type { Pool } from './db/pool.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Pool;
    mailer: Mailer;
    /** Trabajos en segundo plano (p. ej. envío de correos); las pruebas los esperan. */
    tareas: Set<Promise<unknown>>;
    esperarTareas(): Promise<void>;
  }
  interface FastifyRequest {
    sesion?: SesionActiva;
  }
}
