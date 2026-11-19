import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './pool.js';

export const DIR_MIGRACIONES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
// Clave del bloqueo asesor (entero de 64 bits arbitrario y fijo para esta aplicación).
const CLAVE_BLOQUEO = '727482615041';
const NOMBRE_VALIDO = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface ResultadoMigracion {
  aplicadas: string[];
  yaAplicadas: string[];
}

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Aplica las migraciones .sql numeradas pendientes, cada una en su propia transacción, bajo un bloqueo asesor
 * (dos instancias a la vez no se pisan). Registra versión y checksum; si un archivo ya aplicado cambió, aborta.
 * Debe ejecutarse con el rol propietario.
 */
export async function migrar(
  pool: Pool,
  dir: string = DIR_MIGRACIONES,
  log: (m: string) => void = () => undefined,
): Promise<ResultadoMigracion> {
  const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const vistos = new Set<string>();
  for (const f of archivos) {
    const m = NOMBRE_VALIDO.exec(f);
    if (!m) throw new Error(`Nombre de migración inválido: ${f} (use NNNN_descripcion.sql)`);
    if (vistos.has(m[1] as string)) throw new Error(`Número de migración repetido: ${m[1]}`);
    vistos.add(m[1] as string);
  }

  const c = await pool.connect();
  const resultado: ResultadoMigracion = { aplicadas: [], yaAplicadas: [] };
  try {
    await c.query('SELECT pg_advisory_lock($1)', [CLAVE_BLOQUEO]);
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        aplicada_en timestamptz NOT NULL DEFAULT now())`);
      const { rows } = await c.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM migraciones_aplicadas',
      );
      const aplicadas = new Map(rows.map((r) => [r.version, r.checksum]));

      for (const archivo of archivos) {
        const sql = await readFile(path.join(dir, archivo), 'utf8');
        const checksum = sha256(sql);
        const previo = aplicadas.get(archivo);
        if (previo !== undefined) {
          if (previo !== checksum) {
            throw new Error(`La migración ya aplicada ${archivo} fue modificada (checksum distinto). No se edita: cree una nueva.`);
          }
          resultado.yaAplicadas.push(archivo);
          continue;
        }
        try {
          await c.query('BEGIN');
          await c.query(sql);
          await c.query('INSERT INTO migraciones_aplicadas (version, checksum) VALUES ($1, $2)', [archivo, checksum]);
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`);
        }
        log(`migración aplicada: ${archivo}`);
        resultado.aplicadas.push(archivo);
      }
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [CLAVE_BLOQUEO]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
  return resultado;
}
