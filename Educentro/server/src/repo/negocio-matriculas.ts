// Operaciones TRANSACCIONALES de matrícula y personas (Fase 3A). Cada una corre dentro de la transacción de la petición,
// bloquea con SELECT … FOR UPDATE lo que decide (sección, ficha) y responde 409 con un código claro cuando la regla falla.
// Orden de bloqueo (evita interbloqueos): sección → fichas de estudiantes (por id) → matrículas.
import { randomUUID } from 'node:crypto';
import { ErrorHttp } from '../errores.js';
import type { Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { registrarAuditoria } from './auditoria.js';
import type { Peticion } from './generico.js';
import {
  actualizarDatos, centroDeEscritura, esFecha, exigirRolEscribe, hoyServidor, insertarDatos, invalido, leerFila, str,
} from './util-negocio.js';

const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
const nombrePersona = (d: Registro): string => `${str(d.nombres) ?? str(d.nombre) ?? ''} ${str(d.apellidos) ?? ''}`.trim() || 'El estudiante';

// ----------------------------------------------------------------------------------------------------------- matricular
export interface PedidoMatricula {
  anioId: string;
  seccionId: string;
  estudianteIds: string[];
  fecha?: string;
}

/**
 * Valida (con bloqueo de la sección y de las fichas) que `estudianteIds` puedan matricularse en `seccionId`/`anioId`.
 * `excluirMatricula`: id de una matrícula que se está reactivando (no cuenta como duplicado ni como ocupación).
 * Lanza 409/422 con código claro; si todo está bien devuelve la sección.
 */
export async function validarMatriculas(
  p: Peticion,
  centro: string,
  d: { anioId: string; seccionId: string; estudianteIds: string[]; excluirMatricula?: string; contarCupo?: boolean },
): Promise<{ capacidad: number | null }> {
  const { tx } = p;
  const sec = await tx.query<{ id: string; datos: Registro }>(
    'SELECT id, datos FROM secciones WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL FOR UPDATE',
    [d.seccionId, centro],
  );
  const s = sec.rows[0];
  if (!s) throw new ErrorHttp(422, 'referencia_invalida', 'La sección no existe en este centro.', ['seccionId']);
  const an = await tx.query('SELECT 1 FROM anios WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL', [d.anioId, centro]);
  if (!an.rowCount) throw new ErrorHttp(422, 'referencia_invalida', 'El año lectivo no existe en este centro.', ['anioId']);

  const anioSec = str(s.datos.anioId);
  if (anioSec && anioSec !== d.anioId) throw new ErrorHttp(409, 'anio_incoherente', 'La sección pertenece a otro año lectivo distinto del indicado.', ['anioId']);
  const cap = s.datos.capacidad === null || s.datos.capacidad === undefined || s.datos.capacidad === '' ? null : Number(s.datos.capacidad);
  const ids = [...new Set(d.estudianteIds)].sort();
  if (ids.length !== d.estudianteIds.length) throw new ErrorHttp(422, 'datos_invalidos', 'Hay estudiantes repetidos en la selección.', ['estudianteIds']);

  if (d.contarCupo !== false && cap !== null && Number.isFinite(cap)) {
    const n = (await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM matriculas WHERE seccion_id = $1 AND estado = 'activa' AND borrado_en IS NULL AND ($2::text IS NULL OR id <> $2)`,
      [d.seccionId, d.excluirMatricula ?? null],
    )).rows[0]?.n ?? 0;
    const libres = Math.max(0, cap - n);
    if (ids.length > libres) {
      throw new ErrorHttp(409, 'seccion_completa', libres === 0 ? `La sección está completa (${n}/${cap}).` : `La sección solo tiene ${libres} ${libres === 1 ? 'cupo disponible' : 'cupos disponibles'}.`, undefined, { capacidad: cap, ocupados: n, libres });
    }
  }

  // fichas de los estudiantes (FOR SHARE: una baja concurrente espera a que termine la matrícula, y al revés)
  const est = await tx.query<{ id: string; datos: Registro }>(
    'SELECT id, datos FROM estudiantes WHERE id = ANY($1::text[]) AND centro_id = $2 AND borrado_en IS NULL ORDER BY id FOR SHARE',
    [ids, centro],
  );
  const porId = new Map(est.rows.map((r) => [r.id, r.datos]));
  const ya = await tx.query<{ estudiante_id: string; estado: string; id: string }>(
    `SELECT estudiante_id, estado, id FROM matriculas WHERE centro_id = $1 AND anio_id = $2 AND estudiante_id = ANY($3::text[]) AND borrado_en IS NULL AND ($4::text IS NULL OR id <> $4)`,
    [centro, d.anioId, ids, d.excluirMatricula ?? null],
  );
  const matDe = new Map(ya.rows.map((r) => [r.estudiante_id, r]));
  const problemas: { estudianteId: string; codigo: string; mensaje: string }[] = [];
  for (const id of ids) {
    const e = porId.get(id);
    if (!e) {
      problemas.push({ estudianteId: id, codigo: 'estudiante_no_encontrado', mensaje: 'Estudiante no encontrado en este centro.' });
      continue;
    }
    const nom = nombrePersona(e);
    if ((str(e.estado) ?? 'activo') !== 'activo') problemas.push({ estudianteId: id, codigo: 'estudiante_inactivo', mensaje: `${nom} está dado de baja.` });
    const m = matDe.get(id);
    if (m) {
      problemas.push({
        estudianteId: id,
        codigo: 'matricula_duplicada',
        mensaje: `${nom} ya tiene una matrícula en este año lectivo${m.estado !== 'activa' ? ' (retirada: reactívala en lugar de matricular de nuevo)' : ''}.`,
      });
    }
  }
  if (problemas.length) {
    const primero = problemas[0] as (typeof problemas)[number];
    throw new ErrorHttp(409, primero.codigo, problemas.length === 1 ? primero.mensaje : `${primero.mensaje} (y ${problemas.length - 1} más)`, ['estudianteIds'], { rechazadas: problemas });
  }
  return { capacidad: cap };
}

/** POST /matriculas: matrícula individual o en lote, todo o nada. */
export async function matricular(p: Peticion, cuerpo: unknown): Promise<Registro[]> {
  exigirRolEscribe(p, 'matriculas', 'crear');
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const anioId = str(b.anioId);
  const seccionId = str(b.seccionId);
  if (!anioId) throw invalido('anioId es obligatorio.', 'anioId');
  if (!seccionId) throw invalido('seccionId es obligatorio.', 'seccionId');
  let ids: unknown[];
  if (Array.isArray(b.estudianteIds)) ids = b.estudianteIds;
  else if (str(b.estudianteId)) ids = [b.estudianteId];
  else throw invalido('Indica estudianteId o estudianteIds.', 'estudianteIds');
  if (!ids.length || ids.length > 200 || ids.some((x) => !str(x) || (x as string).length > 100)) throw invalido('estudianteIds debe tener entre 1 y 200 ids válidos.', 'estudianteIds');
  const fecha = b.fecha === undefined || b.fecha === null ? hoyServidor() : b.fecha;
  if (!esFecha(fecha)) throw invalido('La fecha de matrícula no es válida (AAAA-MM-DD).', 'fecha');
  // centro: el de la sección (admin_red) o el de la sesión
  let centro: string;
  if (p.ses.rol === 'admin_red') {
    const s = await leerFila(p, meta('secciones'), seccionId);
    if (!s) throw new ErrorHttp(422, 'referencia_invalida', 'La sección no existe.', ['seccionId']);
    centro = s.centroId;
  } else centro = centroDeEscritura(p, undefined);
  await validarMatriculas(p, centro, { anioId, seccionId, estudianteIds: ids as string[] });
  const m = meta('matriculas');
  const out: Registro[] = [];
  for (const est of [...(ids as string[])]) {
    const id = `${m.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const r = await insertarDatos(p, m, id, centro, { estudianteId: est, seccionId, anioId, estado: 'activa', fecha });
    await registrarAuditoria(p.tx, p.ses, centro, { accion: 'matricular', coleccion: 'matriculas', registroId: id, despues: r });
    out.push(r);
  }
  return out;
}

/** POST /matriculas/:id/retirar. Motivo y fecha obligatorios. */
export async function retirarMatricula(p: Peticion, id: string, cuerpo: unknown): Promise<Registro> {
  exigirRolEscribe(p, 'matriculas', 'editar');
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const motivo = typeof b.motivo === 'string' ? b.motivo.replace(/\s+/g, ' ').trim() : '';
  if (motivo.length < 3 || motivo.length > 200) throw invalido('El motivo del retiro es obligatorio (3 a 200 caracteres).', 'motivo');
  if (!esFecha(b.fecha)) throw invalido('La fecha de retiro es obligatoria (AAAA-MM-DD).', 'fecha');
  if (b.fecha > hoyServidor()) throw invalido('La fecha de retiro no puede ser futura.', 'fecha', 'fecha_futura');
  const m = meta('matriculas');
  const f = await leerFila(p, m, id, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Matrícula no encontrada.');
  if (f.datos.estado !== 'activa') throw new ErrorHttp(409, 'matricula_no_activa', 'La matrícula ya está retirada.');
  const antes = { ...f.datos, id };
  const r = await actualizarDatos(p, m, id, { estado: 'retirada', fechaRetiro: b.fecha, motivoRetiro: motivo });
  await registrarAuditoria(p.tx, p.ses, f.centroId, { accion: 'retirar_matricula', coleccion: 'matriculas', registroId: id, antes, despues: r });
  return r;
}

/** POST /matriculas/:id/reactivar: cupo de la sección y ninguna otra matrícula activa del estudiante en el año. */
export async function reactivarMatricula(p: Peticion, id: string): Promise<Registro> {
  exigirRolEscribe(p, 'matriculas', 'editar');
  const m = meta('matriculas');
  // 1) sin bloquear: para conocer la sección y bloquearla ANTES que la matrícula (orden de bloqueo uniforme)
  const previa = await leerFila(p, m, id);
  if (!previa) throw new ErrorHttp(404, 'no_encontrado', 'Matrícula no encontrada.');
  const seccionId = str(previa.datos.seccionId);
  const anioId = str(previa.datos.anioId);
  const estId = str(previa.datos.estudianteId);
  if (!seccionId || !anioId || !estId) throw new ErrorHttp(409, 'matricula_incompleta', 'La matrícula no tiene sección, año o estudiante.');
  const centro = previa.centroId;
  await p.tx.query('SELECT 1 FROM secciones WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL FOR UPDATE', [seccionId, centro]);
  const f = await leerFila(p, m, id, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Matrícula no encontrada.');
  if (f.datos.estado === 'activa') throw new ErrorHttp(409, 'matricula_activa', 'La matrícula ya está activa.');
  const e = await p.tx.query<{ datos: Registro }>('SELECT datos FROM estudiantes WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL ORDER BY id FOR SHARE', [estId, centro]);
  if (!e.rows[0]) throw new ErrorHttp(409, 'estudiante_no_encontrado', 'El estudiante ya no existe.');
  if ((str(e.rows[0].datos.estado) ?? 'activo') !== 'activo') throw new ErrorHttp(409, 'estudiante_inactivo', `${nombrePersona(e.rows[0].datos)} está dado de baja; reactívalo primero en Personas.`);
  const otra = await p.tx.query('SELECT 1 FROM matriculas WHERE estudiante_id = $1 AND anio_id = $2 AND estado = \'activa\' AND borrado_en IS NULL AND id <> $3', [estId, anioId, id]);
  if (otra.rowCount) throw new ErrorHttp(409, 'matricula_duplicada', `${nombrePersona(e.rows[0].datos)} ya tiene otra matrícula activa en este año.`);
  // la matrícula retirada propia no cuenta como duplicado (excluirMatricula); cualquier otro problema se informa tal cual
  await validarMatriculas(p, centro, { anioId, seccionId, estudianteIds: [estId], excluirMatricula: id });
  const antes = { ...f.datos, id };
  const r = await actualizarDatos(p, m, id, { estado: 'activa' }, ['fechaRetiro', 'motivoRetiro']);
  await registrarAuditoria(p.tx, p.ses, centro, { accion: 'reactivar_matricula', coleccion: 'matriculas', registroId: id, antes, despues: r });
  return r;
}

// --------------------------------------------------------------------------------------------------------------- personas
export type ColPersona = 'estudiantes' | 'docentes' | 'tutores';

/** POST /{estudiantes|docentes|tutores}/:id/baja. Docente: bloqueada si tiene cargas. Estudiante: retira su matrícula activa. */
export async function bajaPersona(p: Peticion, col: ColPersona, id: string, cuerpo: unknown): Promise<Registro> {
  exigirRolEscribe(p, col, 'editar');
  const m = meta(col);
  const f = await leerFila(p, m, id, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if ((str(f.datos.estado) ?? 'activo') !== 'activo') throw new ErrorHttp(409, 'ya_inactivo', 'La persona ya está dada de baja.');
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const hoy = hoyServidor();
  const motivo = typeof b.motivo === 'string' ? b.motivo.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (col === 'docentes') {
    const n = (await p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM cargas WHERE docente_id = $1 AND borrado_en IS NULL', [id])).rows[0]?.n ?? 0;
    if (n) throw new ErrorHttp(409, 'docente_con_cargas', `No se puede dar de baja: tiene ${n} ${n === 1 ? 'asignación docente' : 'asignaciones docentes'}. Reasígnalas primero.`, undefined, { cargas: n });
  }
  let retiradas = 0;
  if (col === 'estudiantes') {
    exigirRolEscribe(p, 'matriculas', 'editar');
    const mats = await p.tx.query<{ id: string; seccion_id: string | null; centro_id: string }>(
      `SELECT id, seccion_id, centro_id FROM matriculas WHERE estudiante_id = $1 AND estado = 'activa' AND borrado_en IS NULL ORDER BY id FOR UPDATE`,
      [id],
    );
    for (const mt of mats.rows) {
      await actualizarDatos(p, meta('matriculas'), mt.id, { estado: 'retirada', fechaRetiro: hoy, motivoRetiro: motivo || 'Baja del estudiante' });
      await registrarAuditoria(p.tx, p.ses, f.centroId, { accion: 'retirar_matricula', coleccion: 'matriculas', registroId: mt.id, extra: { causa: 'baja_estudiante' } });
      retiradas++;
    }
  }
  const antes = { ...f.datos, id };
  const r = await actualizarDatos(p, m, id, { estado: 'inactivo', fechaBaja: hoy, ...(motivo ? { motivoBaja: motivo } : {}) });
  await registrarAuditoria(p.tx, p.ses, f.centroId, { accion: 'baja', coleccion: col, registroId: id, antes, despues: r, extra: { matriculasRetiradas: retiradas } });
  return r;
}

/** POST /{estudiantes|docentes|tutores}/:id/reactivar (no restablece matrículas). */
export async function reactivarPersona(p: Peticion, col: ColPersona, id: string): Promise<Registro> {
  exigirRolEscribe(p, col, 'editar');
  const m = meta(col);
  const f = await leerFila(p, m, id, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if ((str(f.datos.estado) ?? 'activo') === 'activo') throw new ErrorHttp(409, 'ya_activo', 'La persona ya está activa.');
  const r = await actualizarDatos(p, m, id, { estado: 'activo' }, ['fechaBaja', 'motivoBaja']);
  await registrarAuditoria(p.tx, p.ses, f.centroId, { accion: 'reactivar', coleccion: col, registroId: id, antes: { ...f.datos, id }, despues: r });
  return r;
}

/** POST /tutores/:id/vincular y /desvincular {estudianteId}. */
export async function vincularTutor(p: Peticion, id: string, cuerpo: unknown, quitar: boolean): Promise<Registro> {
  exigirRolEscribe(p, 'tutores', 'editar');
  const estId = str(((cuerpo ?? {}) as Record<string, unknown>).estudianteId);
  if (!estId) throw invalido('estudianteId es obligatorio.', 'estudianteId');
  const m = meta('tutores');
  const t = await leerFila(p, m, id, 'update');
  if (!t) throw new ErrorHttp(404, 'no_encontrado', 'Tutor no encontrado.');
  const actuales = Array.isArray(t.datos.estudianteIds) ? (t.datos.estudianteIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (!quitar) {
    if ((str(t.datos.estado) ?? 'activo') !== 'activo') throw new ErrorHttp(409, 'tutor_inactivo', 'El tutor está dado de baja.');
    const e = await p.tx.query<{ datos: Registro }>('SELECT datos FROM estudiantes WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL FOR SHARE', [estId, t.centroId]);
    if (!e.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'El estudiante no existe en este centro.', ['estudianteId']);
    if ((str(e.rows[0].datos.estado) ?? 'activo') !== 'activo') throw new ErrorHttp(409, 'estudiante_inactivo', 'El estudiante está dado de baja.');
  }
  const nuevos = quitar ? actuales.filter((x) => x !== estId) : actuales.includes(estId) ? actuales : [...actuales, estId];
  const r = await actualizarDatos(p, m, id, { estudianteIds: nuevos });
  await registrarAuditoria(p.tx, p.ses, t.centroId, { accion: quitar ? 'desvincular_tutor' : 'vincular_tutor', coleccion: 'tutores', registroId: id, extra: { estudianteId: estId } });
  return r;
}

// ------------------------------------------------------------------------------------------------------------ año activo
/** POST /anios/:id/activar: un solo año activo por centro, en una transacción. */
export async function activarAnio(p: Peticion, id: string): Promise<Registro> {
  exigirRolEscribe(p, 'anios', 'editar');
  const m = meta('anios');
  const previa = await leerFila(p, m, id);
  if (!previa) throw new ErrorHttp(404, 'no_encontrado', 'Año lectivo no encontrado.');
  // bloquea TODOS los años del centro (orden por id) para serializar activaciones simultáneas
  await p.tx.query('SELECT id FROM anios WHERE centro_id = $1 AND borrado_en IS NULL ORDER BY id FOR UPDATE', [previa.centroId]);
  const f = await leerFila(p, m, id);
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Año lectivo no encontrado.');
  await p.tx.query(
    `UPDATE anios SET datos = datos || '{"activo":false}'::jsonb WHERE centro_id = $1 AND borrado_en IS NULL AND activo AND id <> $2`,
    [previa.centroId, id],
  );
  const r = await actualizarDatos(p, m, id, { activo: true });
  await registrarAuditoria(p.tx, p.ses, previa.centroId, { accion: 'activar_anio', coleccion: 'anios', registroId: id, despues: r });
  return r;
}
