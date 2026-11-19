// Repositorio genérico de colecciones (tablas con columnas comunes + `datos` jsonb).
// Todo recibe un `Tx` (transacción con contexto + RLS). Los registros viajan como objetos PLANOS:
//   {id, centroId, ...campos, creadoEn, actualizadoEn}
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ErrorHttp } from '../errores.js';
import { calcularAlcance, condicionAlcance, type Alcance, type SesionApi } from '../domain/alcance.js';
import { AUDITADAS, type MetaColeccion } from '../domain/colecciones.js';
import { puede, type Registro } from '../domain/autorizacion.js';
import type { Tx } from '../db/contexto.js';
import { aplicarFiltros, paginacion, sqlOrden, type Columnas, type Consulta } from './consulta.js';
import { registrarAuditoria } from './auditoria.js';

export const MAX_DATOS_BYTES = 256 * 1024;
export const MAX_LOTE = 500;
const RESERVADAS = ['id', 'centroId', 'creadoEn', 'actualizadoEn', 'borradoEn'] as const;
const ID_VALIDO = /^[A-Za-z0-9_.:-]{1,100}$/;
const COLUMNAS: Columnas = { id: 'id', centroId: 'centro_id', creadoEn: 'creado_en', actualizadoEn: 'actualizado_en' };
const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SEL = `id, centro_id, datos, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en, borrado_en IS NOT NULL AS borrado`;

interface Fila {
  id: string;
  centro_id: string;
  datos: Registro;
  creado_en: string;
  actualizado_en: string;
  borrado: boolean;
  [k: string]: unknown;
}

export const aPlano = (f: Fila): Registro => ({ ...f.datos, id: f.id, centroId: f.centro_id, creadoEn: f.creado_en, actualizadoEn: f.actualizado_en });

/** Contexto de una petición: sesión + alcance (calculado una sola vez por transacción). */
export class Peticion {
  #alc: Alcance | null | undefined;
  constructor(readonly tx: Tx, readonly ses: SesionApi) {}
  async alcance(): Promise<Alcance | null> {
    if (this.#alc === undefined) this.#alc = await calcularAlcance(this.tx, this.ses);
    return this.#alc;
  }
  async cargaDeActividad(id: string): Promise<string | null> {
    const r = await this.tx.query<{ c: string | null }>(`SELECT datos->>'cargaId' AS c FROM actividades WHERE id = $1 AND borrado_en IS NULL`, [id]);
    return r.rows[0]?.c ?? null;
  }
}

const tabla = (m: MetaColeccion): string => {
  if (!/^[a-z_]+$/.test(m.tabla)) throw new Error('tabla inválida'); // defensa: viene de constantes
  return m.tabla;
};

/** ¿El centro pedido es permitido? (el cliente no decide: no admin_red solo puede el suyo). */
export function centroDePeticion(ses: SesionApi, pedido: string | null | undefined): string | null {
  if (ses.rol === 'admin_red') return pedido ?? null;
  if (pedido !== undefined && pedido !== null && pedido !== ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
  return ses.centroId;
}

// ------------------------------------------------------------------------------------------------ lectura
export async function listar(p: Peticion, meta: MetaColeccion, c: Consulta): Promise<{ datos: Registro[]; total: number; siguiente: number | null }> {
  const params: unknown[] = [];
  const where = ['borrado_en IS NULL'];
  const cond = condicionAlcance(meta.nombre, p.ses, await p.alcance(), params);
  if (cond) where.push(cond);
  const centro = centroDePeticion(p.ses, c.centroId);
  if (centro) {
    params.push(centro);
    where.push(`centro_id = $${params.length}`);
  } else if (p.ses.rol !== 'admin_red') {
    where.push('FALSE'); // sin centro no se lee (RLS también lo impediría)
  }
  aplicarFiltros(c, COLUMNAS, params, where);
  const t = tabla(meta);
  const total = (await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE ${where.join(' AND ')}`, params)).rows[0]?.n ?? 0;
  const orden = sqlOrden(c, COLUMNAS, params);
  params.push(c.limite, c.offset);
  const r = await p.tx.query<Fila>(
    `SELECT ${SEL} FROM ${t} WHERE ${where.join(' AND ')} ${orden} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const datos = r.rows.map(aPlano).map((x) => ocultarSegunRol(p.ses, meta, x));
  return { datos, ...paginacion(c, total, datos.length) };
}

export async function obtener(p: Peticion, meta: MetaColeccion, id: string): Promise<Registro | null> {
  const params: unknown[] = [id];
  const where = ['id = $1', 'borrado_en IS NULL'];
  const cond = condicionAlcance(meta.nombre, p.ses, await p.alcance(), params);
  if (cond) where.push(cond);
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM ${tabla(meta)} WHERE ${where.join(' AND ')}`, params);
  const f = r.rows[0];
  return f ? ocultarSegunRol(p.ses, meta, aPlano(f)) : null;
}

/** Comunicados: quien no los gestiona solo ve sus propias lecturas (no quién más los leyó). */
function ocultarSegunRol(ses: SesionApi, meta: MetaColeccion, r: Registro): Registro {
  if (meta.nombre === 'comunicados' && !['admin_red', 'director', 'secretaria'].includes(ses.rol) && Array.isArray(r.lecturas)) {
    return { ...r, lecturas: (r.lecturas as Registro[]).filter((l) => l?.usuarioId === ses.usuarioId) };
  }
  return r;
}

// ---------------------------------------------------------------------------------------------- escritura
export const esquemaId = z.string().regex(ID_VALIDO, 'id no válido');

export function validarCuerpo(cuerpo: unknown, etiqueta = ''): Registro {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}El cuerpo debe ser un objeto JSON.`, ['(cuerpo)']);
  }
  if (Object.keys(cuerpo).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 100)) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}Nombre de campo no permitido.`, ['(cuerpo)']);
  }
  return cuerpo as Registro;
}

export interface OpcionesEscritura {
  modo: 'crear' | 'editar' | 'upsert';
  /** id de la URL (editar). */
  idUrl?: string;
  /** Valor de If-Match (actualizadoEn). */
  ifMatch?: string | null;
  /** Solo la carga de datos de desarrollo: conserva creadoEn/actualizadoEn del registro. */
  conservarFechas?: boolean;
}

export interface Resultado {
  registro: Registro;
  antes: Registro | null;
  creado: boolean;
}

const idNuevo = (m: MetaColeccion): string => `${m.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const fechaIso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : null);

function normalizarIfMatch(h: string | null | undefined): string | null {
  if (h === undefined || h === null || h === '') return null;
  const limpio = h.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const f = fechaIso(limpio);
  if (!f) throw new ErrorHttp(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
  return f;
}

export async function guardar(p: Peticion, meta: MetaColeccion, cuerpo: Registro, op: OpcionesEscritura, etiqueta = ''): Promise<Resultado> {
  const { ses, tx } = p;
  const t = tabla(meta);
  const bruto = { ...cuerpo };
  const idCuerpo = bruto.id;
  const centroCuerpo = bruto.centroId;
  const fechaCreado = op.conservarFechas ? fechaIso(bruto.creadoEn) : null;
  const fechaActual = op.conservarFechas ? fechaIso(bruto.actualizadoEn) : null;
  for (const k of RESERVADAS) delete bruto[k];

  // id
  if (idCuerpo !== undefined && idCuerpo !== null && !esquemaId.safeParse(idCuerpo).success) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}El id no es válido.`, ['id']);
  }
  if (op.modo === 'editar' && idCuerpo !== undefined && idCuerpo !== op.idUrl) {
    throw new ErrorHttp(422, 'id_inconsistente', `${etiqueta}El id del cuerpo no coincide con el de la URL.`, ['id']);
  }
  if (op.modo === 'upsert' && (idCuerpo === undefined || idCuerpo === null)) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}Cada registro del lote debe traer su id.`, ['id']);
  }
  const id = (op.modo === 'editar' ? op.idUrl : (idCuerpo as string | undefined)) ?? idNuevo(meta);

  // centro: el cliente NO decide (solo admin_red puede elegir; el resto queda fijado al de su sesión)
  if (centroCuerpo !== undefined && centroCuerpo !== null && typeof centroCuerpo !== 'string') {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}centroId no es válido.`, ['centroId']);
  }
  const centroPedido = centroDePeticion(ses, (centroCuerpo as string | null | undefined) ?? null);

  // estado actual (bloqueo de fila; la RLS ya limita al centro) + si cae dentro del alcance del rol
  const params: unknown[] = [id];
  const cond = condicionAlcance(meta.nombre, ses, await p.alcance(), params);
  const r = await tx.query<Fila & { visible: boolean }>(`SELECT ${SEL}, ${cond ?? 'TRUE'} AS visible FROM ${t} WHERE id = $1 FOR UPDATE`, params);
  const fila = r.rows[0];
  const vivo = !!fila && !fila.borrado;
  const oculto = vivo && !fila.visible;

  if (op.modo === 'editar' && (!vivo || oculto)) throw new ErrorHttp(404, 'no_encontrado', `${etiqueta}Registro no encontrado.`);
  if (op.modo === 'crear' && vivo) throw new ErrorHttp(409, 'ya_existe', `${etiqueta}Ya existe un registro con ese id.`);
  if (op.modo === 'upsert' && oculto) throw new ErrorHttp(404, 'no_encontrado', `${etiqueta}Registro no encontrado.`);
  const actualiza = vivo; // editar o upsert sobre registro vivo
  const antes = actualiza ? aPlano(fila) : null;

  if (actualiza && centroPedido && centroPedido !== fila.centro_id) {
    throw new ErrorHttp(422, 'centro_inmutable', `${etiqueta}No se puede cambiar el centro de un registro.`, ['centroId']);
  }
  const centro = actualiza ? fila.centro_id : (fila?.borrado ? fila.centro_id : centroPedido);
  if (!centro) throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}centroId es obligatorio (elige un centro).`, ['centroId']);
  if (fila?.borrado && centroPedido && centroPedido !== fila.centro_id) {
    throw new ErrorHttp(409, 'ya_existe', `${etiqueta}Ya existe un registro con ese id.`);
  }

  if (op.modo === 'editar') {
    const im = normalizarIfMatch(op.ifMatch);
    if (im && im !== fila?.actualizado_en) {
      throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
    }
  }

  // campos que solo gestiona el servidor
  if (meta.nombre === 'comunicados') {
    if (antes && Array.isArray(antes.lecturas)) bruto.lecturas = antes.lecturas;
    else delete bruto.lecturas;
  }

  const nuevoPlano: Registro = { ...bruto, id, centroId: centro };
  const bytes = Buffer.byteLength(JSON.stringify(bruto), 'utf8');
  if (bytes > MAX_DATOS_BYTES) {
    throw new ErrorHttp(413, 'registro_demasiado_grande', `${etiqueta}El registro supera el máximo de ${MAX_DATOS_BYTES / 1024} KB.`);
  }

  // autorización (rol, centro, alcance, propiedad)
  const dec = await puede(ses, meta.nombre, actualiza ? 'editar' : 'crear', nuevoPlano, {
    antes,
    alcance: await p.alcance(),
    cargaDeActividad: (a) => p.cargaDeActividad(a),
  });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, etiqueta + dec.mensaje);

  const json = JSON.stringify(bruto);
  let guardada: Fila;
  if (actualiza) {
    const u = await tx.query<Fila>(
      `UPDATE ${t} SET datos = $2::jsonb, actualizado_en = coalesce($3::timestamptz, actualizado_en) WHERE id = $1 RETURNING ${SEL}`,
      [id, json, fechaActual],
    );
    guardada = u.rows[0] as Fila;
  } else if (fila?.borrado) {
    // El id pertenecía a un registro borrado: se reutiliza (p. ej. cal_<actividad>_<estudiante> es determinista).
    const u = await tx.query<Fila>(
      `UPDATE ${t} SET datos = $2::jsonb, borrado_en = NULL, creado_en = now() WHERE id = $1 RETURNING ${SEL}`,
      [id, json],
    );
    guardada = u.rows[0] as Fila;
  } else {
    const u = await tx.query<Fila>(
      `INSERT INTO ${t} (id, centro_id, datos, creado_en, actualizado_en)
       VALUES ($1, $2, $3::jsonb, coalesce($4::timestamptz, now()), coalesce($5::timestamptz, $4::timestamptz, now())) RETURNING ${SEL}`,
      [id, centro, json, fechaCreado, fechaActual],
    );
    guardada = u.rows[0] as Fila;
  }
  const registro = aPlano(guardada);
  if (AUDITADAS.includes(meta.nombre)) {
    await registrarAuditoria(tx, ses, centro, { accion: antes ? 'editar' : 'crear', coleccion: meta.nombre, registroId: id, antes, despues: registro });
  }
  return { registro, antes, creado: !antes };
}

export async function borrar(p: Peticion, meta: MetaColeccion, id: string, ifMatch?: string | null): Promise<void> {
  const params: unknown[] = [id];
  const where = ['id = $1', 'borrado_en IS NULL'];
  const cond = condicionAlcance(meta.nombre, p.ses, await p.alcance(), params);
  if (cond) where.push(cond);
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM ${tabla(meta)} WHERE ${where.join(' AND ')} FOR UPDATE`, params);
  const fila = r.rows[0];
  if (!fila) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  const antes = aPlano(fila);
  const im = normalizarIfMatch(ifMatch);
  if (im && im !== fila.actualizado_en) throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
  const dec = await puede(p.ses, meta.nombre, 'borrar', antes, { antes, alcance: await p.alcance(), cargaDeActividad: (a) => p.cargaDeActividad(a) });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  await p.tx.query(`UPDATE ${tabla(meta)} SET borrado_en = now() WHERE id = $1`, [id]);
  if (AUDITADAS.includes(meta.nombre)) {
    await registrarAuditoria(p.tx, p.ses, fila.centro_id, { accion: 'borrar', coleccion: meta.nombre, registroId: id, antes, despues: null });
  }
}
