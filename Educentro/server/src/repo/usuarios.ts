// Colección `usuarios`: proyección sobre la tabla de autenticación de la Fase 0.
// NUNCA se exponen hash, tokens, intentos ni bloqueos (las consultas seleccionan columnas explícitas).
// Alta: contraseña temporal aleatoria devuelta UNA vez + debe_cambiar_clave. «Borrar» = desactivar.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashClave } from '../auth/password.js';
import { ErrorHttp } from '../errores.js';
import { puede, type Registro } from '../domain/autorizacion.js';
import { ROLES } from '../domain/permisos.js';
import { aplicarFiltros, paginacion, sqlOrden, type Columnas, type Consulta } from './consulta.js';
import { esquemaId, type Peticion } from './generico.js';

const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SEL = `id, centro_id, nombre, email, rol, ref_id, activo, debe_cambiar_clave, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en`;
const COLUMNAS: Columnas = {
  id: 'id', centroId: 'centro_id', nombre: 'nombre', email: 'email', rol: 'rol', refId: 'ref_id', activo: 'activo', creadoEn: 'creado_en', actualizadoEn: 'actualizado_en',
};

interface Fila {
  id: string;
  centro_id: string | null;
  nombre: string;
  email: string;
  rol: string;
  ref_id: string | null;
  activo: boolean;
  debe_cambiar_clave: boolean;
  creado_en: string;
  actualizado_en: string;
  [k: string]: unknown;
}
const plano = (f: Fila): Registro => ({
  id: f.id,
  centroId: f.centro_id,
  nombre: f.nombre,
  email: f.email,
  rol: f.rol,
  refId: f.ref_id,
  activo: f.activo,
  debeCambiarClave: f.debe_cambiar_clave,
  creadoEn: f.creado_en,
  actualizadoEn: f.actualizado_en,
});

/** Visibilidad: admin_red todos; director su centro; el resto solo a sí mismo. */
function visibilidad(p: Peticion, params: unknown[]): string {
  const { ses } = p;
  if (ses.rol === 'admin_red') return 'TRUE';
  if (ses.rol === 'director') {
    params.push(ses.centroId);
    return `centro_id = $${params.length}`;
  }
  params.push(ses.usuarioId);
  return `id = $${params.length}`;
}

export async function listarUsuarios(p: Peticion, c: Consulta): Promise<{ datos: Registro[]; total: number; siguiente: number | null }> {
  const params: unknown[] = [];
  const where = [visibilidad(p, params)];
  if (c.centroId) {
    if (p.ses.rol !== 'admin_red' && c.centroId !== p.ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
    params.push(c.centroId);
    where.push(`centro_id = $${params.length}`);
  }
  // Solo columnas conocidas: no hay `datos` en esta tabla.
  for (const f of c.filtros) if (!Object.hasOwn(COLUMNAS, f.campo)) throw new ErrorHttp(422, 'filtro_no_permitido', 'Campo de filtro no permitido.', [`f.${f.campo}`]);
  aplicarFiltros(c, COLUMNAS, params, where);
  if (c.orden && !Object.hasOwn(COLUMNAS, c.orden)) throw new ErrorHttp(422, 'orden_no_permitido', 'Campo de orden no permitido.', ['orden']);
  const w = where.join(' AND ');
  const total = (await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM usuarios WHERE ${w}`, params)).rows[0]?.n ?? 0;
  const orden = sqlOrden(c, COLUMNAS, params);
  params.push(c.limite, c.offset);
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM usuarios WHERE ${w} ${orden} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const datos = r.rows.map(plano);
  return { datos, ...paginacion(c, total, datos.length) };
}

export async function obtenerUsuario(p: Peticion, id: string): Promise<Registro | null> {
  const params: unknown[] = [id];
  const w = visibilidad(p, params);
  const r = await p.tx.query<Fila>(`SELECT ${SEL} FROM usuarios WHERE id = $1 AND ${w}`, params);
  return r.rows[0] ? plano(r.rows[0]) : null;
}

const base = {
  nombre: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  rol: z.enum(ROLES),
  refId: z.string().min(1).max(100).nullable().optional(),
  centroId: z.string().min(1).max(100).nullable().optional(),
  activo: z.boolean().optional(),
};
const esquemaAlta = z.object({ id: esquemaId.optional(), ...base });
const esquemaCambio = z.object({ id: esquemaId.optional(), ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.optional()])) } as {
  id: z.ZodOptional<typeof esquemaId>;
} & { [K in keyof typeof base]: z.ZodOptional<(typeof base)[K]> });

export const claveTemporal = (): string => randomBytes(12).toString('base64url'); // 96 bits

function traducir(e: unknown): never {
  const x = e as { code?: string; constraint?: string };
  if (x.code === '23505') {
    if (x.constraint === 'usuarios_email_unico') throw new ErrorHttp(409, 'email_en_uso', 'Ese correo ya está registrado.', ['email']);
    throw new ErrorHttp(409, 'ya_existe', 'Ya existe un usuario con ese id.');
  }
  if (x.code === '23503') throw new ErrorHttp(422, 'referencia_invalida', 'El centro indicado no existe.', ['centroId']);
  throw e;
}

export async function crearUsuario(p: Peticion, cuerpo: unknown): Promise<{ registro: Registro; claveTemporal: string }> {
  const { ses, tx } = p;
  const d = esquemaAlta.parse(cuerpo);
  let centro: string | null;
  if (ses.rol === 'admin_red') {
    centro = d.centroId ?? null;
    if (d.rol === 'admin_red' && centro !== null) throw new ErrorHttp(422, 'datos_invalidos', 'Un usuario admin_red no pertenece a un centro.', ['centroId']);
    if (d.rol !== 'admin_red' && !centro) throw new ErrorHttp(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
  } else {
    if (d.centroId !== undefined && d.centroId !== null && d.centroId !== ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
    centro = ses.centroId;
  }
  const nuevo: Registro = { id: d.id, nombre: d.nombre, email: d.email, rol: d.rol, refId: d.refId ?? null, centroId: centro };
  const dec = await puede(ses, 'usuarios', 'crear', nuevo);
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  const id = d.id ?? `usr_${randomBytes(10).toString('hex')}`;
  const clave = claveTemporal();
  try {
    const r = await tx.query<Fila>(
      `INSERT INTO usuarios (id, centro_id, rol, ref_id, nombre, email, hash, activo, debe_cambiar_clave)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING ${SEL}`,
      [id, centro, d.rol, d.refId ?? null, d.nombre, d.email, await hashClave(clave), d.activo ?? true],
    );
    return { registro: plano(r.rows[0] as Fila), claveTemporal: clave };
  } catch (e) {
    return traducir(e);
  }
}

export async function cambiarUsuario(p: Peticion, id: string, cuerpo: unknown, ifMatch?: string | null): Promise<Registro> {
  const { ses, tx } = p;
  const d = esquemaCambio.parse(cuerpo);
  if (d.id !== undefined && d.id !== id) throw new ErrorHttp(422, 'id_inconsistente', 'El id del cuerpo no coincide con el de la URL.', ['id']);
  const params: unknown[] = [id];
  const w = visibilidad(p, params);
  const r = await tx.query<Fila>(`SELECT ${SEL} FROM usuarios WHERE id = $1 AND ${w} FOR UPDATE`, params);
  const fila = r.rows[0];
  if (!fila) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if (ifMatch) {
    const t = Date.parse(ifMatch.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
    if (Number.isNaN(t)) throw new ErrorHttp(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
    if (new Date(t).toISOString() !== fila.actualizado_en) throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
  }
  const antes = plano(fila);
  if (d.centroId !== undefined && (d.centroId ?? null) !== fila.centro_id) {
    throw new ErrorHttp(422, 'centro_inmutable', 'No se puede cambiar el centro de un registro.', ['centroId']);
  }
  const nuevo: Registro = {
    ...antes,
    nombre: d.nombre ?? fila.nombre,
    email: d.email ?? fila.email,
    rol: d.rol ?? fila.rol,
    refId: d.refId === undefined ? fila.ref_id : d.refId,
    activo: d.activo ?? fila.activo,
  };
  const dec = await puede(ses, 'usuarios', 'editar', nuevo, { antes });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  if (fila.id === ses.usuarioId && nuevo.activo === false) throw new ErrorHttp(403, 'sin_permiso', 'No puedes desactivar tu propia cuenta.');
  // admin_red no pertenece a un centro y el resto sí (la BD lo impone también): no se permite convertir uno en otro.
  if ((nuevo.rol === 'admin_red') !== (fila.rol === 'admin_red')) throw new ErrorHttp(422, 'datos_invalidos', 'No se puede pasar un usuario desde o hacia admin_red.', ['rol']);
  try {
    const u = await tx.query<Fila>(
      `UPDATE usuarios SET nombre = $2, email = $3, rol = $4, ref_id = $5, activo = $6 WHERE id = $1 RETURNING ${SEL}`,
      [id, nuevo.nombre, nuevo.email, nuevo.rol, nuevo.refId, nuevo.activo],
    );
    if (nuevo.activo === false || nuevo.rol !== fila.rol) await tx.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
    return plano(u.rows[0] as Fila);
  } catch (e) {
    return traducir(e);
  }
}

/** «Borrar» un usuario = desactivarlo (y revocar sus sesiones). */
export async function desactivarUsuario(p: Peticion, id: string, ifMatch?: string | null): Promise<void> {
  const { ses, tx } = p;
  const params: unknown[] = [id];
  const w = visibilidad(p, params);
  const r = await tx.query<Fila>(`SELECT ${SEL} FROM usuarios WHERE id = $1 AND ${w} FOR UPDATE`, params);
  const fila = r.rows[0];
  if (!fila || !fila.activo) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if (ifMatch) {
    const t = Date.parse(ifMatch.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
    if (Number.isNaN(t)) throw new ErrorHttp(422, 'if_match_invalido', 'If-Match debe ser el valor actualizadoEn del registro.', ['If-Match']);
    if (new Date(t).toISOString() !== fila.actualizado_en) throw new ErrorHttp(409, 'conflicto_version', 'El registro cambió desde que lo leíste. Recarga e inténtalo de nuevo.');
  }
  const dec = await puede(ses, 'usuarios', 'borrar', plano(fila), { antes: plano(fila) });
  if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  if (fila.id === ses.usuarioId) throw new ErrorHttp(403, 'sin_permiso', 'No puedes desactivar tu propia cuenta.');
  await tx.query('UPDATE usuarios SET activo = false WHERE id = $1', [id]);
  await tx.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
}
