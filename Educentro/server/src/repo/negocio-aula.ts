// Asistencia por lote, justificaciones y comunicados (lista filtrada por el servidor, contadores y confirmaciones).
import { ErrorHttp } from '../errores.js';
import type { Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { parsearConsulta } from './consulta.js';
import { guardar, listar, obtener, type Peticion } from './generico.js';
import { esFecha, esObjeto, hoyServidor, invalido, leerFila, str } from './util-negocio.js';

const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
const ESTADOS = ['P', 'A', 'T', 'J'];

/** POST /asistencia/seccion-fecha {seccionId, fecha, registros:[{estudianteId, estado, justificacion?, nota?}]}: lote atómico. */
export async function asistenciaSeccionFecha(p: Peticion, cuerpo: unknown): Promise<Registro[]> {
  const b = esObjeto(cuerpo) ? cuerpo : {};
  const seccionId = str(b.seccionId);
  if (!seccionId) throw invalido('seccionId es obligatorio.', 'seccionId');
  if (!esFecha(b.fecha)) throw invalido('La fecha no es válida (AAAA-MM-DD).', 'fecha', 'fecha_invalida');
  if (b.fecha > hoyServidor()) throw invalido('No se puede registrar asistencia de fechas futuras.', 'fecha', 'fecha_futura');
  const regs = b.registros;
  if (!Array.isArray(regs) || !regs.length || regs.length > 200) throw invalido('registros debe tener entre 1 y 200 elementos.', 'registros');
  const sec = await leerFila(p, meta('secciones'), seccionId);
  if (!sec) throw new ErrorHttp(422, 'referencia_invalida', 'La sección no existe en este centro.', ['seccionId']);
  const vistos = new Set<string>();
  for (const [i, x] of regs.entries()) {
    if (!esObjeto(x) || !str(x.estudianteId)) throw invalido(`Registro ${i + 1}: estudianteId es obligatorio.`, 'registros');
    if (!ESTADOS.includes(String(x.estado))) throw invalido(`Registro ${i + 1}: el estado debe ser P, A, T o J.`, 'registros');
    if (vistos.has(x.estudianteId as string)) throw invalido(`Registro ${i + 1}: estudiante repetido.`, 'registros');
    vistos.add(x.estudianteId as string);
  }
  // registros existentes de esa sección y fecha (el id puede no seguir la convención)
  const ya = await p.tx.query<{ id: string; est: string }>(`SELECT id, datos->>'estudianteId' AS est FROM asistencia WHERE borrado_en IS NULL AND datos->>'seccionId' = $1 AND datos->>'fecha' = $2`, [seccionId, b.fecha]);
  const idDe = new Map(ya.rows.map((r) => [r.est, r.id]));
  const m = meta('asistencia');
  const out: Registro[] = [];
  for (const [i, x] of (regs as Registro[]).entries()) {
    const est = x.estudianteId as string;
    const campos: Registro = { seccionId, estudianteId: est, fecha: b.fecha, estado: x.estado };
    if (x.justificacion !== undefined && x.estado === 'J') campos.justificacion = x.justificacion;
    if (x.nota !== undefined && x.nota !== null && x.estado !== 'J') campos.nota = x.nota;
    const id = idDe.get(est) ?? `ast_${est}_${b.fecha}`;
    const r = await guardar(p, m, { ...campos, id, centroId: sec.centroId }, { modo: 'upsert' }, `Registro ${i + 1}: `);
    out.push(r.registro);
  }
  return out;
}

/** POST /asistencia/:id/justificar {justificacion} (A→J, o J→J con otro texto) y /quitar-justificacion (J→A). El servidor fija quién y cuándo. */
export async function cambiarJustificacion(p: Peticion, id: string, cuerpo: unknown, quitar: boolean): Promise<Registro> {
  const m = meta('asistencia');
  const antes = await obtener(p, m, id);
  if (!antes) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  if (quitar) {
    if (antes.estado !== 'J') throw new ErrorHttp(409, 'estado_no_justificable', 'Solo se puede quitar la justificación de una ausencia justificada.');
    return (await guardar(p, m, { ...antes, estado: 'A' }, { modo: 'editar', idUrl: id })).registro;
  }
  if (antes.estado !== 'A' && antes.estado !== 'J') throw new ErrorHttp(409, 'estado_no_justificable', 'Solo se puede justificar una ausencia.');
  const just = (esObjeto(cuerpo) ? cuerpo.justificacion : undefined) ?? (esObjeto(cuerpo) ? cuerpo.motivo : undefined);
  if (typeof just !== 'string' || just.trim().length < 3) throw invalido('La justificación es obligatoria (mínimo 3 caracteres).', 'justificacion', 'justificacion_requerida');
  return (await guardar(p, m, { ...antes, estado: 'J', justificacion: just }, { modo: 'editar', idUrl: id })).registro;
}

// ----------------------------------------------------------------------------------------------------------- comunicados
const GESTORES = ['admin_red', 'director', 'secretaria'];
const AUD: Record<string, string> = { docente: 'docentes', tutor: 'tutores', estudiante: 'estudiantes' };

interface Destinatario {
  usuarioId: string;
  nombre: string;
  rol: string;
  refId: string | null;
  centroId: string;
  secciones: Set<string>;
  cursos: Set<string>;
}
/** Usuarios activos (docente/tutor/estudiante) con sus secciones y cursos, de los centros indicados. Port de ctxDe/esDestinatario del cliente. */
async function destinatarios(p: Peticion, centros: string[]): Promise<Destinatario[]> {
  if (!centros.length) return [];
  const us = await p.tx.query<{ id: string; nombre: string; rol: string; ref_id: string | null; centro_id: string }>(
    `SELECT id, nombre, rol, ref_id, centro_id FROM usuarios WHERE activo AND rol IN ('docente','tutor','estudiante') AND centro_id = ANY($1::text[])`,
    [centros],
  );
  const cargas = await p.tx.query<{ docente: string | null; seccion: string | null }>(`SELECT docente_id AS docente, seccion_id AS seccion FROM cargas WHERE borrado_en IS NULL AND centro_id = ANY($1::text[])`, [centros]);
  const mats = await p.tx.query<{ est: string | null; seccion: string | null }>(`SELECT estudiante_id AS est, seccion_id AS seccion FROM matriculas WHERE borrado_en IS NULL AND estado = 'activa' AND centro_id = ANY($1::text[])`, [centros]);
  const tut = await p.tx.query<{ id: string; hijos: unknown }>(`SELECT id, datos->'estudianteIds' AS hijos FROM tutores WHERE borrado_en IS NULL AND centro_id = ANY($1::text[])`, [centros]);
  const secs = await p.tx.query<{ id: string; curso: string | null }>(`SELECT id, curso_id AS curso FROM secciones WHERE borrado_en IS NULL AND centro_id = ANY($1::text[])`, [centros]);
  const cursoDe = new Map(secs.rows.map((s) => [s.id, s.curso]));
  const porDocente = new Map<string, Set<string>>();
  for (const c of cargas.rows) if (c.docente && c.seccion) (porDocente.get(c.docente) ?? porDocente.set(c.docente, new Set()).get(c.docente)!).add(c.seccion);
  const porEst = new Map<string, Set<string>>();
  for (const m of mats.rows) if (m.est && m.seccion) (porEst.get(m.est) ?? porEst.set(m.est, new Set()).get(m.est)!).add(m.seccion);
  const hijosDe = new Map(tut.rows.map((t) => [t.id, Array.isArray(t.hijos) ? (t.hijos as unknown[]).filter((x): x is string => typeof x === 'string') : []]));
  return us.rows.map((u) => {
    let s = new Set<string>();
    if (u.rol === 'docente' && u.ref_id) s = porDocente.get(u.ref_id) ?? new Set();
    else if (u.rol === 'estudiante' && u.ref_id) s = porEst.get(u.ref_id) ?? new Set();
    else if (u.rol === 'tutor' && u.ref_id) for (const h of hijosDe.get(u.ref_id) ?? []) for (const x of porEst.get(h) ?? []) s.add(x);
    return { usuarioId: u.id, nombre: u.nombre, rol: u.rol, refId: u.ref_id, centroId: u.centro_id, secciones: s, cursos: new Set([...s].map((x) => cursoDe.get(x)).filter((x): x is string => !!x)) };
  });
}
function esDestinatario(c: Registro, x: Destinatario): boolean {
  if (c.estado !== 'publicado') return false;
  const sg = (esObjeto(c.segmento) ? c.segmento : { tipo: 'centro', id: null }) as Registro;
  if (sg.tipo === 'tutor') return x.rol === 'tutor' && x.refId === sg.id;
  const aud = (c.destinatarios as string | undefined) ?? 'todos';
  if (aud !== 'todos' && AUD[x.rol] !== aud) return false;
  if (sg.tipo === 'curso') return x.cursos.has(String(sg.id));
  if (sg.tipo === 'seccion') return x.secciones.has(String(sg.id));
  return true;
}
const leyo = (c: Registro, uid: string): boolean => Array.isArray(c.lecturas) && (c.lecturas as Registro[]).some((l) => l?.usuarioId === uid);

/**
 * GET /comunicados: el servidor resuelve la visibilidad (alcance SQL): gestores ven todo su alcance incluidos borradores;
 * docente, tutor y estudiante solo los PUBLICADOS dirigidos a ellos. Añade `leido` (propio) y, a gestores, los contadores
 * `totalDestinatarios` y `totalLeidos` calculados aquí (el cliente no los fija).
 */
export async function listarComunicados(p: Peticion, query: unknown): Promise<{ datos: Registro[]; total: number; siguiente: number | null }> {
  const r = await listar(p, meta('comunicados'), parsearConsulta(query));
  const gestor = GESTORES.includes(p.ses.rol);
  let dest: Destinatario[] = [];
  if (gestor) dest = await destinatarios(p, [...new Set(r.datos.map((c) => String(c.centroId)))]);
  const datos = r.datos.map((c) => {
    const base: Registro = { ...c, leido: leyo(c, p.ses.usuarioId) };
    if (!gestor) return base;
    const ds = c.estado === 'publicado' ? dest.filter((x) => x.centroId === c.centroId && esDestinatario(c, x)) : [];
    return { ...base, totalDestinatarios: ds.length, totalLeidos: ds.filter((x) => leyo(c, x.usuarioId)).length };
  });
  return { ...r, datos };
}

/** GET /comunicados/:id/confirmaciones (solo gestores): quién debe leerlo y quién lo confirmó. */
export async function confirmacionesComunicado(p: Peticion, id: string): Promise<{ datos: { usuarioId: string; nombre: string; rol: string; leido: boolean; fecha: string | null }[] }> {
  if (!GESTORES.includes(p.ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Solo quien gestiona los comunicados ve las confirmaciones.');
  const c = await obtener(p, meta('comunicados'), id);
  if (!c) throw new ErrorHttp(404, 'no_encontrado', 'Comunicado no encontrado.');
  const dest = (await destinatarios(p, [String(c.centroId)])).filter((x) => esDestinatario(c, x));
  const lecturas = (Array.isArray(c.lecturas) ? c.lecturas : []) as Registro[];
  return {
    datos: dest.map((x) => {
      const l = lecturas.find((y) => y?.usuarioId === x.usuarioId);
      return { usuarioId: x.usuarioId, nombre: x.nombre, rol: x.rol, leido: !!l, fecha: typeof l?.fecha === 'string' ? l.fecha : null };
    }),
  };
}
