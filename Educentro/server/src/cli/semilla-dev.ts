import { randomBytes, randomUUID } from 'node:crypto';
import { hashClave } from '../auth/password.js';
import { cargarConfigCli, poolDe } from './comun.js';

// Solo desarrollo: crea un centro de prueba y un usuario por rol con contraseñas aleatorias, impresas UNA vez.
if (process.env.NODE_ENV === 'production') {
  console.error('semilla-dev está deshabilitada cuando NODE_ENV=production.');
  process.exit(1);
}

const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'] as const;

async function main(): Promise<void> {
  const cfg = cargarConfigCli();
  if (cfg.produccion) throw new Error('semilla-dev está deshabilitada en producción.');
  const pool = poolDe(cfg.databaseUrl);
  try {
    const centroId = 'ctr_dev';
    await pool.query(
      `INSERT INTO centros (id, nombre, codigo) VALUES ($1, 'Centro de Prueba (dev)', 'DEV-001') ON CONFLICT (id) DO NOTHING`,
      [centroId],
    );
    const filas: string[] = [];
    for (const rol of ROLES) {
      const email = `${rol.replace('_', '-')}@dev.educentro.test`;
      const clave = randomBytes(15).toString('base64url');
      const r = await pool.query(
        `INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING`,
        [`usr_${randomUUID()}`, rol === 'admin_red' ? null : centroId, rol, `Usuario ${rol} (dev)`, email, await hashClave(clave)],
      );
      filas.push(r.rowCount ? `${rol.padEnd(11)} ${email.padEnd(36)} ${clave}` : `${rol.padEnd(11)} ${email.padEnd(36)} (ya existía: contraseña no recuperable)`);
    }
    console.log('Usuarios de desarrollo (las contraseñas se muestran UNA sola vez):\n');
    console.log(filas.join('\n'));
  } finally {
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
