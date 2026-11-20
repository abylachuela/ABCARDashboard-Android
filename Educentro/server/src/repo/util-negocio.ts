// Utilidades comunes de las reglas de negocio del servidor (Fase 3A): fechas con la hora del SERVIDOR, lecturas con bloqueo
// y escrituras directas sobre `datos` (las usan los endpoints transaccionales, que aplican sus propias reglas).
import { ErrorHttp } from '../errores.js';
import type { Registro } from '../domain/autorizacion.js';
import type { MetaColeccion } from '../domain/colecciones.js';
import { puedeRol, type Accion } from '../domain/autorizacion.js';
import type { Peticion } from './generico.js';

export const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
export const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const EPS = 1e-9;

/** Zona horaria de los centros (la «hoy» del servidor). Configurable con EDU_TZ; por defecto República Dominicana. */
const ZONA = process.env.EDU_TZ || 'America/Santo_Domingo';
/** Fecha de hoy (YYYY-MM-DD) según el RELOJ DEL SERVIDOR en la zona de los centros; el cliente no decide qué día es. */
export function hoyServidor(ahora: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  } catch {
    return ahora.toISOString().slice(0, 10);
  }
}

/** YYYY-MM-DD que existe en el calendario (rechaza 2026-02-30). */
export function esFecha(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** Día de la semana ISO (1 = lunes … 7 = domingo). */
export const diaSemana = (s: string): number => {
  const w = new Date(`${s}T12:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};

export const invalido = (mensaje: string, campo: string, codigo = 'datos_invalidos'): ErrorHttp => new ErrorHttp(422, codigo, mensaje, [campo]);
export const protegido = (campo: string, mensaje: string): ErrorHttp => new ErrorHttp(422, 'campo_protegido', mensaje, [campo]);
export const sinPermiso = (mensaje = 'Sin permiso para esta operación.'): ErrorHttp => new ErrorHttp(403, 'sin_permiso', mensaje);

/** Exige que el rol de la sesión pueda escribir (crear/editar) en la colección; si no, 403 antes de tocar la BD. */
export function exigirRolEscribe(p: Peticion, col: string, accion: Accion = 'editar'): void {
  const d = puedeRol(p.ses, col, accion);
  if (!d.ok) throw new ErrorHttp(d.status, d.codigo, d.mensaje);
}

const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export interface FilaDatos {
  id: string;
  centroId: string;
  datos: Registro;
  actualizadoEn: string;
}
interface FilaSql {
  id: string;
  centro_id: string;
  datos: Registro;
  actualizado_en: string;
  [k: string]: unknown;
}
const nombreTabla = (m: MetaColeccion): string => {
  if (!/^[a-z_]+$/.test(m.tabla)) throw new Error('tabla inválida');
  return m.tabla;
};
const aFila = (f: FilaSql): FilaDatos => ({ id: f.id, centroId: f.centro_id, datos: f.datos, actualizadoEn: f.actualizado_en });
export const aPlanoDatos = (f: FilaDatos & { creadoEn?: string }): Registro => ({ ...f.datos, id: f.id, centroId: f.centroId, actualizadoEn: f.actualizadoEn, ...(f.creadoEn ? { creadoEn: f.creadoEn } : {}) });

/** Lee un registro vivo (la RLS limita al centro de la sesión). `bloquear`: FOR UPDATE / FOR SHARE. */
export async function leerFila(p: Peticion, m: MetaColeccion, id: string, bloquear: 'update' | 'share' | false = false): Promise<FilaDatos | null> {
  const r = await p.tx.query<FilaSql>(
    `SELECT id, centro_id, datos, ${iso('actualizado_en')} AS actualizado_en FROM ${nombreTabla(m)} WHERE id = $1 AND borrado_en IS NULL${bloquear === 'update' ? ' FOR UPDATE' : bloquear === 'share' ? ' FOR SHARE' : ''}`,
    [id],
  );
  return r.rows[0] ? aFila(r.rows[0]) : null;
}

/** Fusiona `cambios` en `datos` y quita las claves de `quitar`. Devuelve el registro plano resultante. */
export async function actualizarDatos(p: Peticion, m: MetaColeccion, id: string, cambios: Registro, quitar: string[] = []): Promise<Registro> {
  const r = await p.tx.query<FilaSql & { creado_en: string }>(
    `UPDATE ${nombreTabla(m)} SET datos = (datos - $3::text[]) || $2::jsonb WHERE id = $1
     RETURNING id, centro_id, datos, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en`,
    [id, JSON.stringify(cambios), quitar],
  );
  const f = r.rows[0] as FilaSql & { creado_en: string };
  return aPlanoDatos({ ...aFila(f), creadoEn: f.creado_en });
}

/** Inserta un registro nuevo (id generado o dado) sin pasar por la capa genérica. */
export async function insertarDatos(p: Peticion, m: MetaColeccion, id: string, centro: string, datos: Registro): Promise<Registro> {
  const r = await p.tx.query<FilaSql & { creado_en: string }>(
    `INSERT INTO ${nombreTabla(m)} (id, centro_id, datos) VALUES ($1, $2, $3::jsonb)
     RETURNING id, centro_id, datos, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en`,
    [id, centro, JSON.stringify(datos)],
  );
  const f = r.rows[0] as FilaSql & { creado_en: string };
  return aPlanoDatos({ ...aFila(f), creadoEn: f.creado_en });
}

/** ¿Existe un registro vivo con ese id en el centro? */
export async function existeEnCentro(p: Peticion, tabla: string, id: string, centro: string): Promise<boolean> {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error('tabla inválida');
  const r = await p.tx.query(`SELECT 1 FROM ${tabla} WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL`, [id, centro]);
  return r.rowCount > 0;
}

/** Cuenta registros vivos de `tabla` cuyo `expr` (columna o expresión constante) es igual a `valor`. */
export async function contar(p: Peticion, tabla: string, expr: string, valor: string, extra = ''): Promise<number> {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error('tabla inválida');
  const r = await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabla} WHERE borrado_en IS NULL AND ${expr} = $1 ${extra}`, [valor]);
  return r.rows[0]?.n ?? 0;
}

/**
 * Centro sobre el que opera un endpoint de creación: el de la sesión; admin_red debe indicarlo (`centroId`).
 * (Los endpoints sobre un registro usan el centro del propio registro.)
 */
export function centroDeEscritura(p: Peticion, pedido: unknown): string {
  if (p.ses.rol === 'admin_red') {
    const c = str(pedido);
    if (!c) throw invalido('centroId es obligatorio (elige un centro).', 'centroId');
    return c;
  }
  if (pedido !== undefined && pedido !== null && pedido !== p.ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
  return p.ses.centroId as string;
}

/** Bloqueo asesor por clave de texto (dura hasta el fin de la transacción): serializa operaciones sobre un mismo recurso lógico. */
export async function bloquearClave(p: Peticion, clave: string): Promise<void> {
  await p.tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [clave]);
}

/** Siguiente valor de una secuencia del centro (`base` = mayor valor ya usado). */
export async function siguienteSecuencia(p: Peticion, centro: string, nombre: string, base: number): Promise<number> {
  const r = await p.tx.query<{ n: string }>('SELECT siguiente_secuencia($1, $2, $3::bigint)::text AS n', [centro, nombre, Math.max(0, Math.floor(base))]);
  return Number((r.rows[0] as { n: string }).n);
}
