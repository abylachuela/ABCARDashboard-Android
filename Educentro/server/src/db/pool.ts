import pg from 'pg';

export type Pool = pg.Pool;
export type Cliente = pg.PoolClient;
export type Ejecutor = Pick<pg.Pool | pg.PoolClient, 'query'>;

export function crearPool(url: string, opciones: { max?: number; nombre?: string } = {}): Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: opciones.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    application_name: opciones.nombre ?? 'educentro-api',
  });
  // Un error en un cliente inactivo no debe tumbar el proceso.
  pool.on('error', () => undefined);
  return pool;
}

/** Ejecuta `fn` en una transacción; revierte si lanza. */
export async function transaccion<T>(pool: Pool, fn: (c: Cliente) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* conexión rota: se descarta abajo */
    }
    throw e;
  } finally {
    c.release();
  }
}
