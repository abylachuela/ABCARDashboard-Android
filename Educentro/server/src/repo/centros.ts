// Colección `centros`: tabla propia (id, nombre, codigo, activo + `datos`). Los centros no llevan centroId.
// Lectura: admin_red todos; el resto solo el suyo (además lo impone la RLS). Escritura: solo admin_red (ESCRIBE).
import { randomUUID } from 'node:crypto';
import { ErrorHttp } from '../errores.js';
import { puede, type Registro } from '../domain/autorizacion.js';
import type { MetaColeccion } from '../domain/colecciones.js';
import { aplicarFiltros, paginacion, sqlOrden, type Columnas, type Consulta } from './consulta.js';
import { COLECCIONES, metaDe } from '../domain/colecciones.js';
import { calculo, normalizar } from '../domain/calculo-shim.js';
import { esquemaId, MAX_DATOS_BYTES, type Peticion, type Resultado } from './generico.js';
import { insertarDatos } from './util-negocio.js';

/** Colecciones de configuración básica que se retiran junto con un centro vacío (el resto cuenta como «datos»). */
const CONFIG_BASICA = ['anios', 'periodos', 'escalas', 'asignaturas'];

const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SEL = `id, nombre, codigo, activo, datos, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en`;
const COLUMNAS: Columnas = { id: 'id', nombre: 'nombre', codigo: 'codigo', activo: 'activo', creadoEn: 'creado_en', actualizadoEn: 'actualizado_en' };
const RESERVADAS = ['id', 'nombre', 'codigo', 'activo', 'creadoEn', 'actualizadoEn', 'borradoEn', 'centroId'];

interface Fila {
  id: string;
  nombre: string;
  codigo: string | null;
  activo: boolean;
  datos: Registro;
  creado_en: string;
  actualizado_en: string;
  [k: string]: unknown;
}
const plano = (f: Fila): Registro => ({ ...f.datos, id: f.id, nombre: f.nombre, codigo: f.codigo, activo: f.activo, creadoEn: f.creado_en, actualizadoEn: f.actualizado_en });

export async function listarCentros(p: Peticion, c: Consulta): Promise<{ datos: Registro[]; total: number; siguiente: number | null }> {
  const params: unknown[] = [];
  const where = ['borrado_en IS NULL'];
  if (p.ses.rol !== 'admin_red') {
    params.push(p.ses.centroId);
    where.push(`id = $${params.length}`);
  }
  aplicarFiltros(c, COLUMNAS, params, where);
  const w = where.join(' AND ');
  const total = (await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM centros WHERE ${w}`, params)).rows[0]?.n ?? 0;
  const orden = sqlOrden(c, COLUMNAS, params);
  params.push(c.limite, c.offset);
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM centros WHERE ${w} ${orden} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const datos = r.rows.map(plano);
  return { datos, ...paginacion(c, total, datos.length) };
}

export async function obtenerCentro(p: Peticion, id: string): Promise<Registro | null> {
  const params: unknown[] = [id];
  let w = 'id = $1 AND borrado_en IS NULL';
  if (p.ses.rol !== 'admin_red') {
    params.push(p.ses.centroId);
    w += ' AND id = $2';
  }
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM centros WHERE ${w}`, params);
  return r.rows[0] ? plano(r.rows[0]) : null;
}

const fechaIso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : null);

export async function guardarCentro(
  p: Peticion,
  meta: MetaColeccion,
  cuerpo: Registro,
  op: { modo: 'crear' | 'editar' | 'upsert'; idUrl?: string; ifMatch?: string | null; conservarFechas?: boolean },
  etiqueta = '',
): Promise<Resultado> {
  const { tx, ses } = p;
  const bruto = { ...cuerpo };
  const idCuerpo = bruto.id;
  const fechaCreado = op.conservarFechas ? fechaIso(bruto.creadoEn) : null;
  const nombre = bruto.nombre;
  const codigo = bruto.codigo ?? null;
  const activo = bruto.activo === undefined ? true : bruto.activo;
  for (const k of RESERVADAS) delete bruto[k];
  if (typeof nombre !== 'string' || nombre.trim().length < 1 || nombre.length > 200) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}El nombre del centro es obligatorio (máx. 200 caracteres).`, ['nombre']);
  }
  if (codigo !== null && (typeof codigo !== 'string' || codigo.length < 1 || codigo.length > 50)) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}El código no es válido.`, ['codigo']);
  }
  if (typeof activo !== 'boolean') throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}activo debe ser verdadero o falso.`, ['activo']);
  if (idCuerpo !== undefined && idCuerpo !== null && !esquemaId.safeParse(idCuerpo).success) {
    throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}El id no es válido.`, ['id']);
  }
  if (op.modo === 'editar' && idCuerpo !== undefined && idCuerpo !== op.idUrl) {
    throw new ErrorHttp(422, 'id_inconsistente', `${etiqueta}El id del cuerpo no coincide con el de la URL.`, ['id']);
  }
  const id = (op.modo === 'editar' ? op.idUrl : (idCuerpo as string | undefined)) ?? `cen_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  if (op.modo === 'upsert' && !idCuerpo) throw new ErrorHttp(422, 'datos_invalidos', `${etiqueta}Cada registro del lote debe traer su id.`, ['id']);
  if (Buffer.byteLength(JSON.stringify(bruto), 'utf8') > MAX_DATOS_BYTES) {
    throw new ErrorHttp(413, 'registro_demasiado_grande', `${etiqueta}El registro supera el máximo de ${MAX_DATOS_BYTES / 1024} KB.`);
  }

  const r = await tx.query<Fila & { borrado: boolean }>(`SELECT ${SEL}, borrado_en IS NOT NULL AS borrado FROM centros WHERE id = $1 FOR UPDATE`, [id]);
  const fila = r.rows[0];
  const vivo = !!fila && !fila.borrado;
  if (op.modo === 'editar' && !vivo) throw new ErrorHttp(404, 'no_encontrado', `${etiqueta}Registro no encontrado.`);
  if (op.modo === 'crear' && vivo) throw new ErrorHttp(409, 'ya_existe', `${etiqueta}Ya existe un registro con ese id.`);
  if (op.modo === 'editar' && op.ifMatch) {
    const f = fechaIso(op.ifMatch.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
    if (!f) throw new ErrorHttp(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
    if (f !== fila?.actualizado_en) throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
  }
  const antes = vivo ? plano(fila) : null;
  const dec = await puede(ses, 'centros', vivo ? 'editar' : 'crear', { id }, { antes });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, etiqueta + dec.mensaje);

  const json = JSON.stringify(bruto);
  let g: Fila;
  if (fila) {
    g = (
      await tx.query<Fila>(
        `UPDATE centros SET nombre = $2, codigo = $3, activo = $4, datos = $5::jsonb, borrado_en = NULL ${vivo ? '' : ', creado_en = now()'} WHERE id = $1 RETURNING ${SEL}`,
        [id, nombre, codigo, activo, json],
      )
    ).rows[0] as Fila;
  } else {
    g = (
      await tx.query<Fila>(
        `INSERT INTO centros (id, nombre, codigo, activo, datos, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5::jsonb, coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now())) RETURNING ${SEL}`,
        [id, nombre, codigo, activo, json, fechaCreado],
      )
    ).rows[0] as Fila;
  }
  void meta;
  // un centro nuevo nace con su escala por defecto, en la MISMA transacción (el cliente no la crea aparte)
  if (!vivo && op.modo === 'crear') {
    const em = metaDe('escalas');
    if (em) await insertarDatos(p, em, `esc_${id}`.slice(0, 100), id, { activa: true, ...normalizar<Record<string, unknown>>(calculo().escalaPorDefecto()) });
  }
  return { registro: plano(g), antes, creado: !vivo };
}

export async function borrarCentro(p: Peticion, id: string, ifMatch?: string | null): Promise<void> {
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM centros WHERE id = $1 AND borrado_en IS NULL FOR UPDATE`, [id]);
  const fila = r.rows[0];
  if (!fila) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if (ifMatch) {
    const f = fechaIso(ifMatch.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
    if (!f) throw new ErrorHttp(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
    if (f !== fila.actualizado_en) throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
  }
  const dec = await puede(p.ses, 'centros', 'borrar', { id }, { antes: plano(fila) });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  // no se elimina un centro con datos (solo su configuración básica); la limpieza de esa configuración va en la misma transacción
  const con: Record<string, number> = {};
  for (const nombre of COLECCIONES) {
    const m = metaDe(nombre);
    if (!m || m.tipo !== 'generica' || CONFIG_BASICA.includes(nombre)) continue;
    const r = await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${m.tabla} WHERE centro_id = $1 AND borrado_en IS NULL`, [id]);
    if (r.rows[0]?.n) con[nombre] = r.rows[0].n;
  }
  const us = await p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM usuarios WHERE centro_id = $1 AND activo', [id]);
  if (us.rows[0]?.n) con.usuarios = us.rows[0].n;
  if (Object.keys(con).length) throw new ErrorHttp(409, 'centro_con_datos', 'No se puede eliminar el centro: tiene estudiantes, docentes, cursos, usuarios u otros datos. Desactívalo en su lugar.', undefined, { dependencias: con });
  for (const nombre of CONFIG_BASICA) {
    const m = metaDe(nombre);
    if (m) await p.tx.query(`UPDATE ${m.tabla} SET borrado_en = now() WHERE centro_id = $1 AND borrado_en IS NULL`, [id]);
  }
  await p.tx.query(`UPDATE centros SET borrado_en = now(), activo = false WHERE id = $1`, [id]);
}
