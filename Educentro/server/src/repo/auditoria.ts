// Auditoría de datos (tabla append-only `auditoria`). usuarioId, rol y fecha los fija SIEMPRE el servidor.
import { createHash } from 'node:crypto';
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
    // seq, prev_hash, hash y fecha los fija el trigger de la cadena (migración 0009); usuario, rol, IP y UA, el servidor.
    `INSERT INTO auditoria (centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, extra, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11) RETURNING id`,
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
      tx.contexto.ip ? tx.contexto.ip.slice(0, 45) : null,
      tx.contexto.ua ? tx.contexto.ua.slice(0, 200) : null,
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
  seq: string;
  hash: string;
  prev_hash: string;
  ip: string | null;
  user_agent: string | null;
  [k: string]: unknown;
}
const SEL = `id, centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, extra, ${iso('fecha')} AS fecha, seq, hash, prev_hash, ip, user_agent`;
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
  seq: Number(f.seq),
  hash: f.hash,
  prevHash: f.prev_hash,
  ip: f.ip,
  userAgent: f.user_agent,
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
  const r = await tx.query<FilaAud>(`SELECT ${SEL} FROM auditoria ${w} ORDER BY fecha DESC, seq DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
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

// ------------------------------------------------------------------------------------------------ verificación
/** Expresión SQL del contenido canónico: IDÉNTICA a `auditoria_canon` de la migración 0009 (una prueba lo vigila). */
const CANON_SQL = `jsonb_build_array(seq, id, centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, extra,
  to_char(fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ip, user_agent, prev_hash)::text`;
const GENESIS = '0'.repeat(64);
const MAX_ERRORES = 50;

export interface ErrorCadena {
  seq: number | null;
  id: string | null;
  tipo: 'hash_alterado' | 'enlace_roto' | 'seq_discontinuo' | 'cabeza_distinta' | 'cabeza_ausente';
  mensaje: string;
}
export interface InformeCadena {
  centroId: string;
  ok: boolean;
  registros: number;
  ultimoSeq: number;
  ultimoHash: string;
  verificadoEn: string;
  errores: ErrorCadena[];
  /** true si había más errores que los listados. */
  truncado: boolean;
}

/**
 * Recorre la cadena de un centro y recalcula cada hash EN ESTE PROCESO (SHA-256 de Node sobre el texto canónico que
 * entrega PostgreSQL con funciones nativas, no con funciones de la BD que un propietario pudiera sustituir).
 * Detecta: contenido alterado, filas borradas o insertadas (hueco de `seq`/enlace roto), reordenamiento y
 * truncado de la cola (la cabeza guardada no coincide con la última fila). NO detecta que quien controla toda la
 * BD reescriba cadena y cabeza completas: para eso se ancla el hash final fuera de la VM (`anclar-auditoria`).
 */
export async function verificarCadena(tx: Tx, centroId: string): Promise<InformeCadena> {
  const errores: ErrorCadena[] = [];
  let truncado = false;
  const err = (e: ErrorCadena): void => {
    if (errores.length < MAX_ERRORES) errores.push(e);
    else truncado = true;
  };
  let esperadoSeq = 1;
  let hashPrevio = GENESIS;
  let registros = 0;
  let ultimoSeq = 0;
  let ultimoHash = GENESIS;
  const LOTE = 2000;
  for (let desdeSeq = Number.MIN_SAFE_INTEGER; ; ) {
    const r = await tx.query<{ seq: string; id: string; prev_hash: string; hash: string; canon: string }>(
      `SELECT seq, id, prev_hash, hash, ${CANON_SQL} AS canon FROM auditoria WHERE centro_id = $1 AND seq > $2 ORDER BY seq LIMIT ${LOTE}`,
      [centroId, desdeSeq],
    );
    for (const f of r.rows) {
      const seq = Number(f.seq);
      registros++;
      if (seq !== esperadoSeq) {
        err({ seq, id: f.id, tipo: 'seq_discontinuo', mensaje: `Se esperaba la entrada ${esperadoSeq} y se encontró la ${seq}: faltan o sobran registros.` });
        esperadoSeq = seq;
      }
      if (f.prev_hash !== hashPrevio) {
        err({ seq, id: f.id, tipo: 'enlace_roto', mensaje: 'El enlace con la entrada anterior no coincide (registro borrado, insertado o reordenado).' });
      }
      const calculado = createHash('sha256').update(f.canon, 'utf8').digest('hex');
      if (calculado !== f.hash) {
        err({ seq, id: f.id, tipo: 'hash_alterado', mensaje: 'El contenido de la entrada no coincide con su hash (alterada).' });
      }
      hashPrevio = f.hash;
      esperadoSeq = seq + 1;
      ultimoSeq = seq;
      ultimoHash = f.hash;
    }
    if (r.rows.length < LOTE) break;
    desdeSeq = Number((r.rows[r.rows.length - 1] as { seq: string }).seq);
  }
  const cab = await tx.query<{ seq: string; hash: string }>('SELECT seq, hash FROM auditoria_cabeza WHERE centro_id = $1', [centroId]);
  const c = cab.rows[0];
  if (!c) {
    if (registros > 0) err({ seq: null, id: null, tipo: 'cabeza_ausente', mensaje: 'Falta la cabeza de la cadena del centro.' });
  } else if (Number(c.seq) !== ultimoSeq || c.hash !== ultimoHash) {
    err({ seq: Number(c.seq), id: null, tipo: 'cabeza_distinta', mensaje: 'La última entrada no coincide con la cabeza registrada (cola truncada o alterada).' });
  }
  return { centroId, ok: errores.length === 0, registros, ultimoSeq, ultimoHash, verificadoEn: new Date().toISOString(), errores, truncado };
}
