// Auditoría de datos (tabla append-only `auditoria`). usuarioId, rol y fecha los fija SIEMPRE el servidor.
import { z } from 'zod';
import { ErrorHttp } from '../errores.js';
import type { SesionApi } from '../domain/alcance.js';
import { AUDITADAS, metaDe } from '../domain/colecciones.js';
import type { Tx } from '../db/contexto.js';
import { paginacion, parsearConsulta, type Columnas, type Consulta } from './consulta.js';

type Json = Record<string, unknown>;
const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export interface EntradaAuditoria {
  accion: string;
  coleccion?: string | null;
  registroId?: string | null;
  antes?: unknown;
  despues?: unknown;
  extra?: Json;
}

export async function registrarAuditoria(tx: Tx, ses: SesionApi, centroId: string, e: EntradaAuditoria): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO auditoria (centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb) RETURNING id`,
    [
      centroId,
      ses.usuarioId,
      ses.rol,
      e.accion.slice(0, 60),
      e.coleccion ?? null,
      e.registroId ?? null,
      e.antes === undefined || e.antes === null ? null : JSON.stringify(e.antes),
      e.despues === undefined || e.despues === null ? null : JSON.stringify(e.despues),
      JSON.stringify(e.extra ?? {}),
    ],
  );
  return (r.rows[0] as { id: string }).id;
}

interface FilaAud {
  id: string;
  centro_id: string;
  usuario_id: string;
  rol: string;
  accion: string;
  coleccion: string | null;
  registro_id: string | null;
  antes: unknown;
  despues: unknown;
  extra: Json;
  fecha: string;
  [k: string]: unknown;
}
const SEL = `id, centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, extra, ${iso('fecha')} AS fecha`;
const plano = (f: FilaAud): Json => ({
  ...f.extra,
  id: f.id,
  centroId: f.centro_id,
  usuarioId: f.usuario_id,
  rol: f.rol,
  accion: f.accion,
  coleccion: f.coleccion,
  registroId: f.registro_id,
  antes: f.antes,
  despues: f.despues,
  fecha: f.fecha,
});

const COLUMNAS: Columnas = { id: 'id', centroId: 'centro_id', usuarioId: 'usuario_id', rol: 'rol', accion: 'accion', coleccion: 'coleccion', registroId: 'registro_id', fecha: 'fecha' };

/** Quién puede leer la auditoría: admin_red (cualquier centro) y director (el suyo). */
export const ROLES_LEEN_AUDITORIA = ['admin_red', 'director'];
/** Quién puede registrar entradas: los roles que operan datos (tutor y estudiante no auditan). */
export const ROLES_AUDITAN = ['admin_red', 'director', 'docente', 'secretaria'];

export async function listarAuditoria(tx: Tx, ses: SesionApi, query: unknown): Promise<{ datos: Json[]; total: number; siguiente: number | null }> {
  const c: Consulta = parsearConsulta(query);
  const q = (query ?? {}) as Record<string, unknown>;
  // Filtros propios del endpoint: ?coleccion=&usuarioId=&accion=&registroId=&desde=&hasta=
  const params: unknown[] = [];
  const where: string[] = [];
  const centro = ses.rol === 'admin_red' ? c.centroId : ses.centroId;
  if (ses.rol !== 'admin_red' && c.centroId && c.centroId !== ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
  if (centro) {
    params.push(centro);
    where.push(`centro_id = $${params.length}`);
  }
  for (const k of ['coleccion', 'usuarioId', 'accion', 'registroId'] as const) {
    const v = q[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > 200) throw new ErrorHttp(422, 'datos_invalidos', 'Filtro no válido.', [k]);
    params.push(v);
    where.push(`${COLUMNAS[k]} = $${params.length}`);
  }
  for (const [k, op] of [['desde', '>='], ['hasta', '<=']] as const) {
    const v = q[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new ErrorHttp(422, 'datos_invalidos', 'Fecha no válida.', [k]);
    params.push(new Date(v).toISOString());
    where.push(`fecha ${op} $${params.length}::timestamptz`);
  }
  for (const f of c.filtros) {
    // f.accion=..., etc.: solo columnas conocidas (los demás campos viven en `extra` y no se filtran)
    if (!Object.hasOwn(COLUMNAS, f.campo)) throw new ErrorHttp(422, 'filtro_no_permitido', 'Campo de filtro no permitido.', [`f.${f.campo}`]);
    params.push(f.valores);
    where.push(`${COLUMNAS[f.campo]}::text = ANY($${params.length}::text[])`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM auditoria ${w}`, params)).rows[0]?.n ?? 0;
  params.push(c.limite, c.offset);
  const r = await tx.query<FilaAud>(`SELECT ${SEL} FROM auditoria ${w} ORDER BY fecha DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const datos = r.rows.map(plano);
  return { datos, ...paginacion(c, total, datos.length) };
}

export async function obtenerAuditoria(tx: Tx, ses: SesionApi, id: string): Promise<Json | null> {
  const params: unknown[] = [id];
  let w = 'id = $1';
  if (ses.rol !== 'admin_red') {
    params.push(ses.centroId);
    w += ' AND centro_id = $2';
  }
  const r = await tx.query<FilaAud>(`SELECT ${SEL} FROM auditoria WHERE ${w}`, params);
  return r.rows[0] ? plano(r.rows[0]) : null;
}

// ---- POST /auditoria: lista blanca de campos (CAMPOS_AUDIT de repo.js)
const texto = (n: number) => z.string().transform((s) => s.slice(0, n));
export const esquemaAuditoria = z.object({
  accion: z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/, 'acción no válida'),
  centroId: z.string().min(1).max(100).optional(),
  coleccion: z.string().max(60).optional(),
  registroId: texto(100).optional(),
  motivo: texto(600).optional(),
  archivo: texto(600).optional(),
  hojas: z.unknown().optional(),
  registros: z.unknown().optional(),
  valores: z.unknown().optional(),
  estudiantesCreados: z.unknown().optional(),
  matriculasCreadas: z.unknown().optional(),
  discrepancias: z.unknown().optional(),
  antes: z.unknown().optional(),
  despues: z.unknown().optional(),
});

export async function crearAuditoria(tx: Tx, ses: SesionApi, cuerpo: unknown): Promise<Json> {
  if (!ROLES_AUDITAN.includes(ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso para auditar.');
  const d = esquemaAuditoria.parse(cuerpo);
  if (JSON.stringify(d).length > 64 * 1024) throw new ErrorHttp(413, 'registro_demasiado_grande', 'La entrada de auditoría es demasiado grande.');
  if (d.coleccion !== undefined && !metaDe(d.coleccion)) throw new ErrorHttp(422, 'datos_invalidos', 'Colección desconocida.', ['coleccion']);
  if (d.coleccion === 'auditoria') throw new ErrorHttp(422, 'datos_invalidos', 'No se audita la propia auditoría.', ['coleccion']);
  // crear/editar/borrar de calificaciones y notasCompetencia los genera el servidor: el cliente no puede falsearlos.
  if (d.coleccion && AUDITADAS.includes(d.coleccion) && ['crear', 'editar', 'borrar'].includes(d.accion)) {
    throw new ErrorHttp(403, 'accion_reservada', 'Esa acción de auditoría la registra el servidor.');
  }
  const centro = ses.rol === 'admin_red' ? (d.centroId ?? null) : ses.centroId;
  if (ses.rol !== 'admin_red' && d.centroId !== undefined && d.centroId !== ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
  if (!centro) throw new ErrorHttp(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
  const extra: Json = {};
  for (const k of ['motivo', 'archivo', 'hojas', 'registros', 'valores', 'estudiantesCreados', 'matriculasCreadas', 'discrepancias'] as const) {
    if (d[k] !== undefined) extra[k] = d[k];
  }
  const id = await registrarAuditoria(tx, ses, centro, { accion: d.accion, coleccion: d.coleccion, registroId: d.registroId, antes: d.antes, despues: d.despues, extra });
  const r = await tx.query<FilaAud>(`SELECT ${SEL} FROM auditoria WHERE id = $1`, [id]);
  return plano(r.rows[0] as FilaAud);
}
