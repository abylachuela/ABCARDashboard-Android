import { randomBytes } from 'node:crypto';
import { hashClave } from '../auth/password.js';
import { conContexto } from '../db/contexto.js';
import { COLECCIONES, metaDe } from '../domain/colecciones.js';
import { generarSemillaDemo } from '../dev/semilla-demo.js';
import { guardarCentro } from '../repo/centros.js';
import { guardar, Peticion } from '../repo/generico.js';
import { cargarConfigCli, poolDe } from './comun.js';

// Solo desarrollo: carga en PostgreSQL la semilla demo del frontend (datos ficticios) y crea un usuario por rol
// con contraseñas aleatorias, impresas UNA vez. Idempotente (los registros se actualizan por id).
if (process.env.NODE_ENV === 'production') {
  console.error('semilla-dev está deshabilitada cuando NODE_ENV=production.');
  process.exit(1);
}

const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'] as const;
const CENTRO_DEMO = 'cen_1';

async function main(): Promise<void> {
  const cfg = cargarConfigCli();
  if (cfg.produccion) throw new Error('semilla-dev está deshabilitada en producción.');
  const pool = poolDe(cfg.databaseUrl);
  try {
    const demo = generarSemillaDemo();
    const admin = { rol: 'admin_red' as const, centroId: null, usuarioId: 'semilla-dev' };
    const conteo: Record<string, number> = {};
    await conContexto(pool, admin, async (tx) => {
      const p = new Peticion(tx, { ...admin, usuarioId: admin.usuarioId, refId: null });
      for (const nombre of COLECCIONES) {
        const meta = metaDe(nombre);
        if (!meta || meta.tipo === 'usuarios' || meta.tipo === 'auditoria') continue; // usuarios: ver abajo
        const op = { modo: 'upsert' as const, conservarFechas: true, sinAuditoria: true };
        let n = 0;
        for (const r of demo[nombre] ?? []) {
          if (meta.tipo === 'centros') await guardarCentro(p, meta, r, op);
          else await guardar(p, meta, r, op);
          n++;
        }
        conteo[nombre] = n;
      }
    });
    console.log('Semilla demo cargada: ' + Object.entries(conteo).filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(' '));

    // Un usuario de acceso por rol, enlazado a fichas de la semilla (cen_1). Los usuarios de la demo no tienen contraseña.
    const filas: string[] = [];
    for (const rol of ROLES) {
      const ficha = (demo.usuarios ?? []).find((u) => u.rol === rol && u.centroId === CENTRO_DEMO);
      const email = `${rol.replace('_', '-')}@dev.educentro.test`;
      const clave = randomBytes(15).toString('base64url');
      const r = await pool.query(
        `INSERT INTO usuarios (id, centro_id, rol, ref_id, nombre, email, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING`,
        [`usr_dev_${rol}`, rol === 'admin_red' ? null : CENTRO_DEMO, rol, (ficha?.refId as string | null | undefined) ?? null, `Usuario ${rol} (dev)`, email, await hashClave(clave)],
      );
      filas.push(r.rowCount ? `${rol.padEnd(11)} ${email.padEnd(36)} ${clave}` : `${rol.padEnd(11)} ${email.padEnd(36)} (ya existía: contraseña no recuperable)`);
    }
    console.log('\nUsuarios de desarrollo (las contraseñas se muestran UNA sola vez):\n');
    console.log(filas.join('\n'));
  } finally {
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
