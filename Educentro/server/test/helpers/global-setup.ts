import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ADMIN_URL, CLAVE_APP, CLAVE_OWNER, DB_NOMBRE } from './entorno.js';

// Recrea la base de pruebas desde cero con db/roles.sql (el mismo script que se documenta para producción).
// Las migraciones las aplica cada archivo de prueba que las necesita (ver helpers/app.ts).
export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `No se pudo conectar a PostgreSQL de pruebas (${(e as Error).message}). ` +
        'Arranca PostgreSQL 16 y/o define TEST_PG_ADMIN_URL (superusuario). Ver server/README.md.',
    );
  }
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NOMBRE} WITH (FORCE)`);
  await admin.end();
  const roles = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/roles.sql');
  execFileSync(
    'psql',
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `owner_pw=${CLAVE_OWNER}`, '-v', `app_pw=${CLAVE_APP}`, '-v', `dbname=${DB_NOMBRE}`, '-f', roles, ADMIN_URL],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
