// Anclas de la auditoría: último hash de la cadena de cada centro + fecha, para guardarlo FUERA de la VM.
import { conContexto } from '../db/contexto.js';
import type { Pool } from '../db/pool.js';
import { verificarCadena } from './auditoria.js';

export interface Ancla {
  centroId: string;
  seq: number;
  hash: string;
  registros: number;
  /** false si la cadena no verifica: NO se debe anclar un hash de una cadena alterada. */
  ok: boolean;
  fecha: string;
}

/** Verifica y devuelve el ancla de cada centro con auditoría (o solo `centroId`). Contexto admin_red (solo lectura). */
export async function calcularAnclas(pool: Pool, centroId?: string): Promise<Ancla[]> {
  return conContexto(pool, { rol: 'admin_red', centroId: null, usuarioId: 'cli-anclar-auditoria' }, async (tx) => {
    const centros = centroId
      ? [centroId]
      : (await tx.query<{ centro_id: string }>('SELECT centro_id FROM auditoria_cabeza ORDER BY centro_id')).rows.map((r) => r.centro_id);
    const out: Ancla[] = [];
    for (const c of centros) {
      const i = await verificarCadena(tx, c);
      out.push({ centroId: c, seq: i.ultimoSeq, hash: i.ultimoHash, registros: i.registros, ok: i.ok, fecha: i.verificadoEn });
    }
    return out;
  });
}
