// Registro de colecciones: las 37 de js/data/repo-local.js. Los nombres de tabla salen SIEMPRE de este registro
// (constantes), nunca de la entrada del cliente.
import type { Rol } from './permisos.js';

export const COLECCIONES = [
  'centros', 'usuarios', 'anios', 'periodos', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes',
  'tutores', 'matriculas', 'escalas', 'categorias', 'actividades', 'calificaciones', 'asistencia', 'comunicados', 'planes',
  'horarios', 'agenteConfig', 'agenteLog', 'auditoria', 'notasCompetencia', 'curriculoVersiones', 'curriculoContenidos',
  'secuencias', 'franjas', 'disponibilidad', 'cursosExtra', 'inscripciones', 'aulaContenidos', 'tareas', 'entregas',
  'cuestionarios', 'intentos', 'foros', 'foroMensajes', 'anuncios',
] as const;
export type NombreColeccion = (typeof COLECCIONES)[number];

/** Colecciones con tabla genérica (id, centro_id, datos…): todas salvo centros, usuarios y auditoria. */
export type TipoColeccion = 'generica' | 'centros' | 'usuarios' | 'auditoria';

export interface MetaColeccion {
  nombre: NombreColeccion;
  tipo: TipoColeccion;
  tabla: string;
  /** Roles que pueden LEER la colección (el alcance por registro se aplica después). Por defecto, todos. */
  lectura: readonly Rol[];
  /** Prefijo de los ids generados por el servidor. */
  prefijo: string;
}

const TODOS: readonly Rol[] = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];
const LECTURA_RESTRINGIDA: Partial<Record<NombreColeccion, readonly Rol[]>> = {
  // Módulo «agente»: admin_red, director y docente; agenteLog también lo escribe (y por tanto lee lo suyo) secretaría.
  agenteConfig: ['admin_red', 'director', 'docente'],
  agenteLog: ['admin_red', 'director', 'docente', 'secretaria'],
  // Módulos «planificacion» y «secuencias»: no son de tutor ni estudiante.
  planes: ['admin_red', 'director', 'docente', 'secretaria'],
  secuencias: ['admin_red', 'director', 'docente', 'secretaria'],
  // La auditoría se lee solo por GET /auditoria (admin_red y director).
  auditoria: ['admin_red', 'director'],
};

const snake = (s: string): string => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());

export const REGISTRO: ReadonlyMap<string, MetaColeccion> = new Map(
  COLECCIONES.map((nombre): [string, MetaColeccion] => [
    nombre,
    {
      nombre,
      tipo: nombre === 'centros' ? 'centros' : nombre === 'usuarios' ? 'usuarios' : nombre === 'auditoria' ? 'auditoria' : 'generica',
      tabla: snake(nombre),
      lectura: LECTURA_RESTRINGIDA[nombre] ?? TODOS,
      prefijo: nombre.slice(0, 3),
    },
  ]),
);

export const metaDe = (nombre: string): MetaColeccion | undefined => REGISTRO.get(nombre);

/** Colecciones cuya escritura audita automáticamente el servidor (regla de repo.js `auditar`). */
export const AUDITADAS: readonly string[] = ['calificaciones', 'notasCompetencia'];
