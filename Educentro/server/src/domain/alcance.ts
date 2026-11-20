// Alcance de lectura por registro (port de EDU.permisos.alcance + filtrar*): docente → sus cargas/secciones/estudiantes;
// tutor → sus hijos; estudiante → él mismo. admin_red, director y secretaría ven todo su centro.
// Se resuelve con consultas SQL dentro de la transacción con contexto (la RLS ya limita al centro).
import type { Tx } from '../db/contexto.js';
import { COLUMNAS_CALIENTES } from './colecciones.js';
import type { Rol } from './permisos.js';

export interface SesionApi {
  usuarioId: string;
  rol: Rol;
  centroId: string | null;
  /** id de docente / tutor / estudiante según el rol. */
  refId: string | null;
}

export interface Alcance {
  cargaIds: string[];
  seccionIds: string[];
  estudianteIds: string[];
  /** Docentes de las cargas del alcance (para que tutor y estudiante vean a sus docentes). */
  docenteIds: string[];
}

export const ROLES_CON_ALCANCE: readonly Rol[] = ['docente', 'tutor', 'estudiante'];
export const tieneAlcance = (rol: Rol): boolean => ROLES_CON_ALCANCE.includes(rol);

const unicos = (a: (string | null | undefined)[]): string[] => [...new Set(a.filter((x): x is string => typeof x === 'string' && x !== ''))];

const VACIO = (): Alcance => ({ cargaIds: [], seccionIds: [], estudianteIds: [], docenteIds: [] });

/** null = sin restricción dentro del centro. */
export async function calcularAlcance(tx: Tx, ses: SesionApi): Promise<Alcance | null> {
  if (!tieneAlcance(ses.rol)) return null;
  if (!ses.refId) return VACIO(); // docente/tutor/estudiante sin ficha enlazada: no ve nada (falla cerrado)

  if (ses.rol === 'docente') {
    const c = await tx.query<{ id: string; seccion: string | null }>(
      `SELECT id, datos->>'seccionId' AS seccion FROM cargas WHERE borrado_en IS NULL AND datos->>'docenteId' = $1`,
      [ses.refId],
    );
    const seccionIds = unicos(c.rows.map((r) => r.seccion));
    const m = await tx.query<{ est: string | null }>(
      `SELECT datos->>'estudianteId' AS est FROM matriculas
        WHERE borrado_en IS NULL AND datos->>'estado' = 'activa' AND datos->>'seccionId' = ANY($1::text[])`,
      [seccionIds],
    );
    return { cargaIds: c.rows.map((r) => r.id), seccionIds, estudianteIds: unicos(m.rows.map((r) => r.est)), docenteIds: [ses.refId] };
  }

  // tutor / estudiante: parten de una lista de estudiantes.
  let estudianteIds: string[];
  if (ses.rol === 'estudiante') {
    estudianteIds = [ses.refId];
  } else {
    const t = await tx.query<{ hijos: unknown }>(`SELECT datos->'estudianteIds' AS hijos FROM tutores WHERE id = $1 AND borrado_en IS NULL`, [ses.refId]);
    const h = t.rows[0]?.hijos;
    estudianteIds = Array.isArray(h) ? unicos(h as string[]) : [];
  }
  const m = await tx.query<{ seccion: string | null }>(
    `SELECT datos->>'seccionId' AS seccion FROM matriculas
      WHERE borrado_en IS NULL AND datos->>'estado' = 'activa' AND datos->>'estudianteId' = ANY($1::text[])`,
    [estudianteIds],
  );
  const seccionIds = unicos(m.rows.map((r) => r.seccion));
  const c = await tx.query<{ id: string; doc: string | null }>(
    `SELECT id, datos->>'docenteId' AS doc FROM cargas WHERE borrado_en IS NULL AND datos->>'seccionId' = ANY($1::text[])`,
    [seccionIds],
  );
  return { cargaIds: c.rows.map((r) => r.id), seccionIds, estudianteIds, docenteIds: unicos(c.rows.map((r) => r.doc)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Reglas de lectura por colección y rol (SQL). Cada regla devuelve un fragmento WHERE que usa `p(valor)` para
// añadir parámetros. Los nombres de campo son constantes de este archivo (nunca del cliente).
// ---------------------------------------------------------------------------------------------------------------
export interface CtxRegla {
  /** Colección que se lee (para elegir la columna caliente de cada campo). */
  col: string;
  ses: SesionApi;
  alc: Alcance;
  p: (valor: unknown) => string;
}
type Regla = (c: CtxRegla) => string;
type Conjunto = 'cargaIds' | 'seccionIds' | 'estudianteIds' | 'docenteIds';
type RolRestringido = 'docente' | 'tutor' | 'estudiante';

/** Columna SQL de un campo: la generada (indexada) si existe; si no, `datos->>'campo'`. */
const campoSql = (col: string, campo: string): string => COLUMNAS_CALIENTES[col]?.[campo] ?? `datos->>'${campo}'`;
const dato = (campo: string, conj: Conjunto): Regla => (c) => `${campoSql(c.col, campo)} = ANY(${c.p(c.alc[conj])}::text[])`;
const porId = (conj: Conjunto): Regla => (c) => `id = ANY(${c.p(c.alc[conj])}::text[])`;
const idPropio: Regla = (c) => `id = ${c.p(c.ses.refId)}`;
const datoPropio = (campo: string, de: 'refId' | 'usuarioId'): Regla => (c) => `datos->>'${campo}' = ${c.p(de === 'refId' ? c.ses.refId : c.ses.usuarioId)}`;
const o = (...rs: Regla[]): Regla => (c) => '(' + rs.map((r) => r(c)).join(' OR ') + ')';
const NADA: Regla = () => 'FALSE';

const hijosDelTutor: Regla = (c) => `datos->'estudianteIds' ?| ${c.p(c.alc.estudianteIds)}::text[]`;

/** Calificaciones de un docente: las de actividades de sus cargas. */
const calificacionesDeMisCargas: Regla = (c) =>
  `actividad_id IN (SELECT id FROM actividades WHERE borrado_en IS NULL AND carga_id = ANY(${c.p(c.alc.cargaIds)}::text[]))`;

/**
 * Comunicados: solo publicados y dirigidos al rol (o a todos). Segmento: «tutor» solo lo ve ese tutor; «curso»/«sección» solo
 * quien tiene una sección del alcance en ese curso/sección (docente: sus cargas; tutor: sus hijos; estudiante: la suya).
 * La visibilidad se resuelve en el SERVIDOR (GET /c/comunicados y GET /comunicados): nadie lee borradores ni comunicados ajenos.
 */
const comunicadosVisibles: Regla = (c) => {
  const aud: Record<string, string> = { docente: 'docentes', tutor: 'tutores', estudiante: 'estudiantes' };
  const seccionesAlc = c.p(c.alc.seccionIds);
  const porTipoTutor =
    c.ses.rol === 'tutor'
      ? `(datos->'segmento'->>'tipo' IS DISTINCT FROM 'tutor' OR datos->'segmento'->>'id' = ${c.p(c.ses.refId)})`
      : `(datos->'segmento'->>'tipo' IS DISTINCT FROM 'tutor')`;
  const alcanceGeo = `(coalesce(datos->'segmento'->>'tipo', 'centro') NOT IN ('curso', 'seccion')
      OR (datos->'segmento'->>'tipo' = 'seccion' AND datos->'segmento'->>'id' = ANY(${seccionesAlc}::text[]))
      OR (datos->'segmento'->>'tipo' = 'curso' AND datos->'segmento'->>'id' IN (SELECT curso_id FROM secciones WHERE id = ANY(${seccionesAlc}::text[]) AND borrado_en IS NULL)))`;
  return `(datos->>'estado' = 'publicado' AND coalesce(datos->>'destinatarios', 'todos') IN ('todos', ${c.p(aud[c.ses.rol])}) AND ${porTipoTutor} AND ${alcanceGeo})`;
};

const todos = (r: Regla): Record<RolRestringido, Regla> => ({ docente: r, tutor: r, estudiante: r });
const porCargaDeTodos = todos(dato('cargaId', 'cargaIds'));

/** Colecciones SIN entrada aquí: todo el centro para todos los roles. */
const REGLAS: Record<string, Partial<Record<RolRestringido, Regla>>> = {
  secciones: todos(porId('seccionIds')),
  cargas: todos(porId('cargaIds')),
  // El docente ve a sus colegas (el horario y las cargas los muestran); tutor y estudiante, solo a los docentes de sus cargas.
  docentes: { tutor: porId('docenteIds'), estudiante: porId('docenteIds') },
  estudiantes: todos(porId('estudianteIds')),
  tutores: { docente: hijosDelTutor, tutor: idPropio, estudiante: hijosDelTutor },
  matriculas: todos(dato('estudianteId', 'estudianteIds')),
  categorias: porCargaDeTodos,
  actividades: porCargaDeTodos,
  calificaciones: { docente: calificacionesDeMisCargas, tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
  notasCompetencia: { docente: dato('cargaId', 'cargaIds'), tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
  asistencia: { docente: dato('seccionId', 'seccionIds'), tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
  comunicados: todos(comunicadosVisibles),
  planes: { docente: o(dato('cargaId', 'cargaIds'), datoPropio('docenteId', 'refId')), tutor: NADA, estudiante: NADA },
  // El docente necesita ver todo el horario del centro para detectar choques; tutor y estudiante, el de sus cargas.
  horarios: { tutor: dato('cargaId', 'cargaIds'), estudiante: dato('cargaId', 'cargaIds') },
  agenteConfig: { docente: datoPropio('docenteId', 'refId'), tutor: NADA, estudiante: NADA },
  agenteLog: { docente: datoPropio('usuarioId', 'usuarioId'), tutor: NADA, estudiante: NADA },
  inscripciones: { tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
  aulaContenidos: porCargaDeTodos,
  tareas: porCargaDeTodos,
  cuestionarios: porCargaDeTodos,
  foros: porCargaDeTodos,
  foroMensajes: porCargaDeTodos,
  anuncios: porCargaDeTodos,
  entregas: { docente: dato('cargaId', 'cargaIds'), tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
  intentos: { docente: dato('cargaId', 'cargaIds'), tutor: dato('estudianteId', 'estudianteIds'), estudiante: dato('estudianteId', 'estudianteIds') },
};

/**
 * Condición SQL de alcance para leer `col` (null = sin restricción por alcance dentro del centro).
 * `agenteLog` de secretaría: solo lo propio (la escribe únicamente para registrar proponer_horario).
 */
export function condicionAlcance(col: string, ses: SesionApi, alc: Alcance | null, params: unknown[]): string | null {
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (col === 'agenteLog' && ses.rol === 'secretaria') return datoPropio('usuarioId', 'usuarioId')({ col, ses, alc: alc ?? VACIO(), p });
  if (!alc) return null;
  const regla = REGLAS[col]?.[ses.rol as RolRestringido];
  return regla ? regla({ col, ses, alc, p }) : null;
}
