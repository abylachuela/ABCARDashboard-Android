// Cursos y talleres (colección `cursosExtra`) e inscripciones: reglas de cupo, lista de espera, grado, choques de horario,
// retiro con promoción automática y cierre, TODO en la transacción de la petición con el curso bloqueado (FOR UPDATE).
// Port de js/vistas/cursos-logica.js (validarEstudiante, asignar, promover, retirar, reinscribir, chocan).
// Orden de bloqueo: curso → bloqueo asesor por estudiante (ordenado por id) → filas de inscripción.
import { ErrorHttp } from '../errores.js';
import type { Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { registrarAuditoria } from './auditoria.js';
import type { Peticion } from './generico.js';
import {
  actualizarDatos, bloquearClave, esFecha, exigirRolEscribe, hoyServidor, insertarDatos, invalido, leerFila, siguienteSecuencia, str,
} from './util-negocio.js';

const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
const nombreDe = (d: Registro): string => `${str(d.nombres) ?? str(d.nombre) ?? ''} ${str(d.apellidos) ?? ''}`.trim() || 'El estudiante';
export const insId = (cursoId: string, estId: string): string => `ins_${cursoId}_${estId}`;
const ACTIVOS = ['inscrito', 'en_lista_espera'];
const OCUPAN = ['inscrito', 'completado'];

// ------------------------------------------------------------------------------------------------ choque de horarios
interface ItemHorario {
  dia?: unknown;
  franjaId?: unknown;
  desde?: unknown;
  hasta?: unknown;
  texto?: unknown;
}
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const hm = (s: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof s === 'string' ? s : '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
function itemTxt(h: ItemHorario): string {
  const dia = DIAS[Number(h.dia)] ?? String(h.dia ?? '');
  const t = h.desde || h.hasta ? `${str(h.desde) ?? '?'}–${str(h.hasta) ?? '?'}` : '';
  return dia + (t ? ' ' + t : '') + (str(h.texto) ? ` (${str(h.texto)})` : '');
}
function itemChoca(a: ItemHorario, b: ItemHorario): boolean {
  if (Number(a.dia) !== Number(b.dia)) return false;
  if (str(a.franjaId) && str(b.franjaId) && a.franjaId === b.franjaId) return true;
  const a1 = hm(a.desde), a2 = hm(a.hasta), b1 = hm(b.desde), b2 = hm(b.hasta);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false;
  return a1 < b2 && b1 < a2;
}
const fechasSolapan = (a: Registro, b: Registro): boolean => {
  const a1 = str(a.inicio) ?? '', a2 = str(a.fin) ?? '9999', b1 = str(b.inicio) ?? '', b2 = str(b.fin) ?? '9999';
  return a1 <= b2 && b1 <= a2;
};
/** Texto del primer par de horarios en conflicto entre dos cursos, o null. */
export function chocan(a: Registro, b: Registro): string | null {
  if (!fechasSolapan(a, b)) return null;
  const ha = Array.isArray(a.horario) ? (a.horario as ItemHorario[]) : [];
  const hb = Array.isArray(b.horario) ? (b.horario as ItemHorario[]) : [];
  for (const x of ha) for (const y of hb) if (itemChoca(x, y)) return itemTxt(x);
  return null;
}

// ------------------------------------------------------------------------------------------------ contexto de evaluación
interface Curso {
  id: string;
  centroId: string;
  datos: Registro;
}
interface Resultado {
  estudianteId: string;
  ok: boolean;
  estado?: string;
  codigo?: string;
  mensaje?: string;
  inscripcion?: Registro;
}
class Falla extends Error {
  constructor(readonly codigo: string, mensaje: string) {
    super(mensaje);
  }
}

async function bloquearCurso(p: Peticion, cursoId: string): Promise<Curso> {
  const f = await leerFila(p, meta('cursosExtra'), cursoId, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'El curso no existe en este centro.');
  return { id: f.id, centroId: f.centroId, datos: f.datos };
}

/** Datos de los estudiantes, su grado (matrícula activa) y sus otras inscripciones activas. */
async function contexto(p: Peticion, centro: string, estIds: string[]) {
  const est = await p.tx.query<{ id: string; datos: Registro }>('SELECT id, datos FROM estudiantes WHERE id = ANY($1::text[]) AND centro_id = $2 AND borrado_en IS NULL', [estIds, centro]);
  const grado = await p.tx.query<{ estudiante_id: string; nivel: string | null; grado: string | null }>(
    `SELECT m.estudiante_id, c.datos->>'nivel' AS nivel, c.datos->>'grado' AS grado FROM matriculas m
       JOIN secciones s ON s.id = m.seccion_id AND s.borrado_en IS NULL JOIN cursos c ON c.id = s.curso_id AND c.borrado_en IS NULL
      WHERE m.estudiante_id = ANY($1::text[]) AND m.estado = 'activa' AND m.borrado_en IS NULL`,
    [estIds],
  );
  const otras = await p.tx.query<{ id: string; estudiante_id: string; curso_id: string; datos: Registro; curso: Registro }>(
    `SELECT i.id, i.estudiante_id, i.curso_id, i.datos, c.datos AS curso FROM inscripciones i JOIN cursos_extra c ON c.id = i.curso_id AND c.borrado_en IS NULL
      WHERE i.estudiante_id = ANY($1::text[]) AND i.estado IN ('inscrito','en_lista_espera') AND i.borrado_en IS NULL AND c.datos->>'estado' IS DISTINCT FROM 'cerrado'`,
    [estIds],
  );
  return {
    est: new Map(est.rows.map((r) => [r.id, r.datos])),
    grado: new Map(grado.rows.map((r) => [r.estudiante_id, r.nivel && r.grado ? `${r.nivel}:${r.grado}` : null])),
    otras,
  };
}
type Ctx = Awaited<ReturnType<typeof contexto>>;

/** Mismas reglas que `validarEstudiante` del cliente (sin cupo). Lanza Falla. */
function validar(curso: Curso, ctx: Ctx, estId: string, prev: { id: string; estado: string } | null, ignorarIns?: string): void {
  const e = ctx.est.get(estId);
  if (!e) throw new Falla('estudiante_no_encontrado', 'Estudiante no encontrado en este centro.');
  const nom = nombreDe(e);
  if ((str(e.estado) ?? 'activo') !== 'activo') throw new Falla('estudiante_inactivo', `${nom} está inactivo/a (dado/a de baja).`);
  if (curso.datos.estado === 'cerrado') throw new Falla('curso_cerrado', 'El curso está cerrado.');
  if (prev && ACTIVOS.includes(prev.estado) && prev.id !== ignorarIns) {
    throw new Falla('inscripcion_duplicada', `${nom} ya está ${prev.estado === 'inscrito' ? 'inscrito/a' : 'en la lista de espera'} en este curso (inscripción duplicada).`);
  }
  if (prev && prev.estado === 'completado') throw new Falla('ya_completado', `${nom} ya completó este curso.`);
  const grados = Array.isArray(curso.datos.grados) ? (curso.datos.grados as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (grados.length) {
    const g = ctx.grado.get(estId);
    if (!g) throw new Falla('sin_matricula_activa', `${nom} no tiene matrícula activa; no se puede verificar el grado permitido.`);
    if (!grados.includes(g)) {
      const txt = grados.map((k) => `${k.split(':')[1]}.º ${k.split(':')[0]}`).join(', ');
      throw new Falla('grado_no_permitido', `${nom} (${g.split(':')[1]}.º ${g.split(':')[0]}) no cumple el grado permitido: ${txt}.`);
    }
  }
  for (const o of ctx.otras.rows) {
    if (o.estudiante_id !== estId || o.curso_id === curso.id || o.id === ignorarIns) continue;
    const ch = chocan(curso.datos, o.curso);
    if (ch) throw new Falla('choque_horario', `${nom} tiene choque de horario (${ch}) con «${str(o.curso.nombre) ?? o.curso_id}».`);
  }
}

async function ocupados(p: Peticion, cursoId: string): Promise<number> {
  return (await p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM inscripciones WHERE curso_id = $1 AND estado IN ('inscrito','completado') AND borrado_en IS NULL`, [cursoId])).rows[0]?.n ?? 0;
}
const cupoDe = (c: Curso): number | null => (c.datos.cupo === null || c.datos.cupo === undefined || c.datos.cupo === '' ? null : Number(c.datos.cupo));

async function nuevoTurno(p: Peticion, centro: string): Promise<number> {
  // la base es el mayor turno ya usado en el centro (los de la semilla/cliente local son marcas de tiempo): el turno nuevo siempre va detrás
  const r = await p.tx.query<{ n: string }>(`SELECT coalesce(max((datos->>'turno')::numeric), 0)::bigint::text AS n FROM inscripciones WHERE centro_id = $1 AND datos->>'turno' ~ '^[0-9]{1,18}$'`, [centro]);
  return siguienteSecuencia(p, centro, 'turno_inscripcion', Number(r.rows[0]?.n ?? 0));
}

/** Bloqueo por estudiante (ordenado): serializa inscripciones simultáneas del mismo estudiante en cursos distintos. */
async function bloquearEstudiantes(p: Peticion, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await bloquearClave(p, `ins-est:${id}`);
}

// ------------------------------------------------------------------------------------------------ inscribir
/** POST /cursos/:id/inscripciones {estudianteIds[] | estudianteId, fecha?}. */
export async function inscribir(p: Peticion, cursoId: string, cuerpo: unknown): Promise<{ resultados: Resultado[]; individual: boolean }> {
  exigirRolEscribe(p, 'inscripciones', 'crear');
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const individual = !Array.isArray(b.estudianteIds);
  const ids = individual ? [b.estudianteId] : (b.estudianteIds as unknown[]);
  if (!ids.length || ids.length > 200 || ids.some((x) => !str(x) || (x as string).length > 100)) throw invalido('Indica estudianteId o estudianteIds (1 a 200 ids válidos).', 'estudianteIds');
  const fecha = b.fecha === undefined || b.fecha === null ? hoyServidor() : b.fecha;
  if (!esFecha(fecha)) throw invalido('La fecha de inscripción no es válida (AAAA-MM-DD).', 'fecha');
  const curso = await bloquearCurso(p, cursoId);
  if (curso.datos.estado === 'cerrado') throw new ErrorHttp(409, 'curso_cerrado', 'El curso está cerrado: no admite inscripciones.');
  const lista = ids as string[];
  await bloquearEstudiantes(p, lista);
  const ctx = await contexto(p, curso.centroId, lista);
  const previas = await p.tx.query<{ id: string; estudiante_id: string; estado: string; datos: Registro }>(
    'SELECT id, estudiante_id, estado, datos FROM inscripciones WHERE curso_id = $1 AND estudiante_id = ANY($2::text[]) AND borrado_en IS NULL FOR UPDATE',
    [cursoId, lista],
  );
  const prevDe = new Map(previas.rows.map((r) => [r.estudiante_id, r]));
  const cupo = cupoDe(curso);
  let ocup = await ocupados(p, cursoId);
  const m = meta('inscripciones');
  const resultados: Resultado[] = [];
  const vistos = new Set<string>();
  const nuevas: Registro[] = [];
  for (const estId of lista) {
    try {
      if (vistos.has(estId)) throw new Falla('estudiante_repetido', 'Estudiante repetido en la selección.');
      vistos.add(estId);
      const prev = prevDe.get(estId) ?? null;
      validar(curso, ctx, estId, prev ? { id: prev.id, estado: prev.estado } : null);
      const estado = cupo === null || ocup < cupo ? 'inscrito' : 'en_lista_espera';
      if (estado === 'inscrito') ocup++;
      const turno = estado === 'en_lista_espera' ? await nuevoTurno(p, curso.centroId) : null;
      const datos: Registro = { cursoId, estudianteId: estId, fecha, estado, turno, asistencia: Array.isArray(prev?.datos.asistencia) ? prev?.datos.asistencia : [], nota: null, observacion: str(prev?.datos.observacion) ?? '' };
      let r: Registro;
      if (prev) r = await actualizarDatos(p, m, prev.id, datos, ['fechaRetiro', 'motivoRetiro', 'promovidoEn', 'fechaCierre']);
      else {
        const idDet = insId(cursoId, estId);
        r = await insertarDatos(p, m, idDet.length <= 100 ? idDet : `${m.prefijo}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`, curso.centroId, datos);
      }
      // se refleja en el contexto para que los choques entre inscripciones del mismo lote se vean
      ctx.otras.rows.push({ id: String(r.id), estudiante_id: estId, curso_id: cursoId, datos: r, curso: curso.datos });
      nuevas.push(r);
      resultados.push({ estudianteId: estId, ok: true, estado, inscripcion: r });
    } catch (e) {
      if (!(e instanceof Falla)) throw e;
      resultados.push({ estudianteId: estId, ok: false, codigo: e.codigo, mensaje: e.message });
    }
  }
  if (individual && resultados[0] && !resultados[0].ok) {
    const f = resultados[0];
    throw new ErrorHttp(409, f.codigo as string, f.mensaje as string);
  }
  if (nuevas.length) await registrarAuditoria(p.tx, p.ses, curso.centroId, { accion: 'inscribir_curso', coleccion: 'inscripciones', registroId: cursoId, extra: { inscritos: nuevas.length } });
  return { resultados, individual };
}

// ------------------------------------------------------------------------------------------------ promoción
export interface Promovido {
  inscripcion: Registro;
  estudianteId: string;
}
/** Promueve de la lista de espera (por turno) mientras haya plazas; los que no cumplen las reglas siguen esperando. */
async function promover(p: Peticion, curso: Curso): Promise<Promovido[]> {
  if (curso.datos.estado === 'cerrado') return [];
  const cupo = cupoDe(curso);
  let libres = cupo === null ? Infinity : Math.max(0, cupo - (await ocupados(p, curso.id)));
  if (libres <= 0) return [];
  const cola = await p.tx.query<{ id: string; estudiante_id: string; estado: string }>(
    `SELECT id, estudiante_id, estado FROM inscripciones WHERE curso_id = $1 AND estado = 'en_lista_espera' AND borrado_en IS NULL
      ORDER BY (datos->>'turno')::numeric NULLS LAST, id FOR UPDATE`,
    [curso.id],
  );
  if (!cola.rows.length) return [];
  await bloquearEstudiantes(p, cola.rows.map((r) => r.estudiante_id));
  const ctx = await contexto(p, curso.centroId, cola.rows.map((r) => r.estudiante_id));
  const hechos: Promovido[] = [];
  for (const i of cola.rows) {
    if (libres <= 0) break;
    try {
      validar(curso, ctx, i.estudiante_id, { id: i.id, estado: i.estado }, i.id);
    } catch (e) {
      if (e instanceof Falla) continue;
      throw e;
    }
    const r = await actualizarDatos(p, meta('inscripciones'), i.id, { estado: 'inscrito', turno: null, promovidoEn: hoyServidor() });
    ctx.otras.rows.push({ id: i.id, estudiante_id: i.estudiante_id, curso_id: curso.id, datos: r, curso: curso.datos });
    libres--;
    hechos.push({ inscripcion: r, estudianteId: i.estudiante_id });
  }
  if (hechos.length) await registrarAuditoria(p.tx, p.ses, curso.centroId, { accion: 'promover_lista_espera', coleccion: 'inscripciones', registroId: curso.id, extra: { promovidos: hechos.length } });
  return hechos;
}

/** Bloquea el curso de una inscripción y luego la inscripción (curso primero, como inscribir y cerrar). */
async function bloquearInscripcion(p: Peticion, id: string): Promise<{ curso: Curso; ins: { id: string; datos: Registro; centroId: string } }> {
  const previa = await leerFila(p, meta('inscripciones'), id);
  if (!previa) throw new ErrorHttp(404, 'no_encontrado', 'La inscripción no existe.');
  const cursoId = str(previa.datos.cursoId);
  if (!cursoId) throw new ErrorHttp(409, 'inscripcion_incompleta', 'La inscripción no tiene curso.');
  const curso = await bloquearCurso(p, cursoId);
  const f = await leerFila(p, meta('inscripciones'), id, 'update');
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'La inscripción no existe.');
  return { curso, ins: { id: f.id, datos: f.datos, centroId: f.centroId } };
}

/** POST /inscripciones/:id/retirar {motivo?}: retira y, en la MISMA transacción, promueve de la lista de espera. */
export async function retirarInscripcion(p: Peticion, id: string, cuerpo: unknown): Promise<{ inscripcion: Registro; promovidos: Promovido[] }> {
  exigirRolEscribe(p, 'inscripciones', 'editar');
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const motivo = typeof b.motivo === 'string' ? b.motivo.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const { curso, ins } = await bloquearInscripcion(p, id);
  const estado = str(ins.datos.estado) ?? '';
  if (!ACTIVOS.includes(estado)) throw new ErrorHttp(409, 'inscripcion_no_activa', 'Solo se puede retirar una inscripción activa o en lista de espera.');
  const eraInscrito = OCUPAN.includes(estado);
  const r = await actualizarDatos(p, meta('inscripciones'), id, { estado: 'retirado', fechaRetiro: hoyServidor(), motivoRetiro: motivo, turno: null });
  await registrarAuditoria(p.tx, p.ses, ins.centroId, { accion: 'retirar_inscripcion', coleccion: 'inscripciones', registroId: id, antes: { ...ins.datos, id }, despues: r });
  const promovidos = eraInscrito ? await promover(p, curso) : [];
  return { inscripcion: r, promovidos };
}

/** POST /inscripciones/:id/reinscribir: pasa por todas las validaciones y por el cupo (puede quedar en lista de espera). */
export async function reinscribirInscripcion(p: Peticion, id: string): Promise<Registro> {
  exigirRolEscribe(p, 'inscripciones', 'editar');
  const { curso, ins } = await bloquearInscripcion(p, id);
  if (ins.datos.estado !== 'retirado') throw new ErrorHttp(409, 'inscripcion_no_retirada', 'Solo se puede reinscribir a quien fue retirado.');
  if (curso.datos.estado === 'cerrado') throw new ErrorHttp(409, 'curso_cerrado', 'El curso está cerrado.');
  const estId = str(ins.datos.estudianteId) as string;
  await bloquearEstudiantes(p, [estId]);
  const ctx = await contexto(p, curso.centroId, [estId]);
  try {
    validar(curso, ctx, estId, { id, estado: 'retirado' });
  } catch (e) {
    if (e instanceof Falla) throw new ErrorHttp(409, e.codigo, e.message);
    throw e;
  }
  const cupo = cupoDe(curso);
  const estado = cupo === null || (await ocupados(p, curso.id)) < cupo ? 'inscrito' : 'en_lista_espera';
  const turno = estado === 'en_lista_espera' ? await nuevoTurno(p, curso.centroId) : null;
  return actualizarDatos(p, meta('inscripciones'), id, { estado, turno, fecha: hoyServidor() }, ['fechaRetiro', 'motivoRetiro']);
}

// ------------------------------------------------------------------------------------------------ estado del curso
const TRANSICIONES: Record<string, string[]> = { abierto: ['en_curso', 'cerrado'], en_curso: ['abierto', 'cerrado'], cerrado: [] };

/** POST /cursos/:id/estado {estado}: abierto ⇄ en_curso → cerrado (terminal). Cerrar pasa la lista de espera a «retirado». */
export async function cambiarEstadoCurso(p: Peticion, cursoId: string, cuerpo: unknown): Promise<{ curso: Registro; retirados: number }> {
  exigirRolEscribe(p, 'cursosExtra', 'editar');
  const nuevo = str(((cuerpo ?? {}) as Record<string, unknown>).estado);
  if (!nuevo || !(nuevo in TRANSICIONES)) throw invalido('estado debe ser abierto, en_curso o cerrado.', 'estado');
  const curso = await bloquearCurso(p, cursoId);
  const actual = str(curso.datos.estado) ?? 'abierto';
  if (actual === nuevo) return { curso: { ...curso.datos, id: curso.id, centroId: curso.centroId }, retirados: 0 };
  if (!(TRANSICIONES[actual] ?? []).includes(nuevo)) throw new ErrorHttp(409, 'transicion_invalida', actual === 'cerrado' ? 'El curso está cerrado y no puede reabrirse.' : `No se puede pasar el curso de «${actual}» a «${nuevo}».`);
  let retirados = 0;
  if (nuevo === 'cerrado') {
    const r = await p.tx.query(
      `UPDATE inscripciones SET datos = datos || jsonb_build_object('estado', 'retirado', 'motivoRetiro', 'Curso cerrado', 'fechaRetiro', $2::text, 'turno', NULL)
        WHERE curso_id = $1 AND estado = 'en_lista_espera' AND borrado_en IS NULL`,
      [cursoId, hoyServidor()],
    );
    retirados = r.rowCount;
  }
  const c = await actualizarDatos(p, meta('cursosExtra'), cursoId, { estado: nuevo });
  await registrarAuditoria(p.tx, p.ses, curso.centroId, { accion: 'estado_curso', coleccion: 'cursosExtra', registroId: cursoId, antes: { estado: actual }, despues: { estado: nuevo }, extra: { listaEsperaRetirada: retirados } });
  return { curso: c, retirados };
}

// ------------------------------------------------------------------------------------------------ notas y finalización
/** POST /cursos/:id/notas {registros:[{inscripcionId, nota, completado}]}: atómico; el estado «completado» solo cambia aquí. */
export async function guardarNotasCurso(p: Peticion, cursoId: string, cuerpo: unknown): Promise<Registro[]> {
  exigirRolEscribe(p, 'inscripciones', 'editar');
  const regs = ((cuerpo ?? {}) as Record<string, unknown>).registros;
  if (!Array.isArray(regs) || !regs.length || regs.length > 500) throw invalido('registros debe tener entre 1 y 500 elementos.', 'registros');
  const curso = await bloquearCurso(p, cursoId);
  const out: Registro[] = [];
  for (const [k, x] of regs.entries()) {
    const r = (x ?? {}) as Record<string, unknown>;
    const id = str(r.inscripcionId);
    if (!id) throw invalido(`Registro ${k + 1}: inscripcionId es obligatorio.`, 'registros');
    const nota = r.nota === null || r.nota === undefined || r.nota === '' ? null : Number(r.nota);
    if (nota !== null && (!Number.isFinite(nota) || nota < 0 || nota > 100)) throw invalido(`Registro ${k + 1}: la nota debe estar entre 0 y 100.`, 'registros', 'fuera_de_rango');
    const f = await leerFila(p, meta('inscripciones'), id, 'update');
    if (!f || f.datos.cursoId !== cursoId) throw new ErrorHttp(404, 'no_encontrado', `Registro ${k + 1}: la inscripción no pertenece a este curso.`);
    const estado = str(f.datos.estado) ?? '';
    if (estado !== 'inscrito' && estado !== 'completado') throw new ErrorHttp(409, 'inscripcion_no_activa', `Registro ${k + 1}: solo se califica a quien está inscrito o completó el curso.`);
    const completado = r.completado === true;
    const cambios: Registro = { nota, estado: completado ? 'completado' : 'inscrito' };
    if (completado) cambios.fechaCierre = hoyServidor();
    out.push(await actualizarDatos(p, meta('inscripciones'), id, cambios, completado ? [] : ['fechaCierre']));
  }
  await registrarAuditoria(p.tx, p.ses, curso.centroId, { accion: 'notas_curso', coleccion: 'inscripciones', registroId: cursoId, extra: { registros: out.length } });
  return out;
}
