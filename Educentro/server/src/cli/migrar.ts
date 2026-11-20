import { migrar } from '../db/migrar.js';
import { cargarConfigCli, poolDe } from './comun.js';

const cfg = cargarConfigCli();
const pool = poolDe(cfg.migrationDatabaseUrl);
try {
  const r = await migrar(pool, undefined, (m) => console.log(m));
  console.log(`Migraciones: ${r.aplicadas.length} aplicadas, ${r.yaAplicadas.length} ya estaban.`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
