// Carga la semilla demo del frontend (datos ficticios) en la BD de pruebas, como hace `semilla-dev`, y crea usuarios de acceso.
import { hashClave } from '../../src/auth/password.js';
import { conContexto } from '../../src/db/contexto.js';
import { COLECCIONES, metaDe } from '../../src/domain/colecciones.js';
import { generarSemillaDemo, type SemillaDemo } from '../../src/dev/semilla-demo.js';
import { guardarCentro } from '../../src/repo/centros.js';
import { guardar, Peticion } from '../../src/repo/generico.js';
import { CLAVE_BUENA, owner } from './app.js';
import { poolApp } from './mundo.js';

export async function cargarSemilla(): Promise<SemillaDemo> {
  const demo = generarSemillaDemo();
  const admin = { rol: 'admin_red' as const, centroId: null, usuarioId: 'semilla-prueba' };
  await conContexto(poolApp(), admin, async (tx) => {
    const p = new Peticion(tx, { ...admin, refId: null });
    for (const nombre of COLECCIONES) {
      const meta = metaDe(nombre);
      if (!meta || meta.tipo === 'usuarios' || meta.tipo === 'auditoria') continue;
      const op = { modo: 'upsert' as const, conservarFechas: true, sinAuditoria: true, sinReglas: true };
      for (const r of demo[nombre] ?? []) {
        if (meta.tipo === 'centros') await guardarCentro(p, meta, r, op);
        else await guardar(p, meta, r, op);
      }
    }
  });
  return demo;
}

/** Crea el usuario de acceso de una ficha de la semilla (clave común de pruebas). Devuelve el correo. */
export async function crearAcceso(demo: SemillaDemo, usuarioId: string): Promise<string> {
  const u = (demo.usuarios ?? []).find((x) => x.id === usuarioId);
  if (!u) throw new Error(`usuario de semilla desconocido: ${usuarioId}`);
  const email = `${usuarioId.replace(/_/g, '-')}@semilla.test`;
  await owner().query('INSERT INTO usuarios (id, centro_id, rol, ref_id, nombre, email, hash) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    usuarioId, u.centroId ?? null, u.rol, u.refId ?? null, `Usuario ${usuarioId}`, email, await hashClave(CLAVE_BUENA),
  ]);
  return email;
}
