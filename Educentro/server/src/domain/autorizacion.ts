// Autorización en el servidor: `puede(sesion, coleccion, accion, registro)`.
// Orden (igual que EDU.repo / EDU.permisos del cliente, que es solo comodidad de uso):
//   1) rol → colección (ESCRIBE para escribir; `lectura` por colección para leer);
//   2) centro (admin_red cualquiera; el resto, el suyo);
//   3) alcance (docente: sus cargas/secciones/estudiantes; tutor: sus hijos; estudiante: él mismo): en lecturas
//      se aplica como condición SQL (ver alcance.ts); en escrituras, aquí, con el alcance ya calculado;
//   4) propiedad (reglas de `propiedad()` de repo.js + las ampliaciones de la Fase 1).
import { metaDe } from './colecciones.js';
import { puedeEscribirColeccion, type Rol } from './permisos.js';
import type { Alcance, SesionApi } from './alcance.js';

export type Accion = 'listar' | 'obtener' | 'crear' | 'editar' | 'borrar';
export type Registro = Record<string, unknown>;

export type Decision = { ok: true } | { ok: false; status: 403 | 404 | 422; codigo: string; mensaje: string };
const OK: Decision = { ok: true };
const no = (mensaje: string, codigo = 'sin_permiso', status: 403 | 404 | 422 = 403): Decision => ({ ok: false, status, codigo, mensaje });

export interface OpcionesPuede {
  /** Estado anterior del registro (editar / borrar). */
  antes?: Registro | null;
  /** Alcance ya calculado (null o ausente = sin restricción). */
  alcance?: Alcance | null;
  /** Resuelve la carga docente de una actividad (para propiedad de calificaciones). */
  cargaDeActividad?: (actividadId: string) => Promise<string | null>;
}

const ESCRITURAS: readonly Accion[] = ['crear', 'editar', 'borrar'];
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);

// Jerarquía para impedir la escalada: nadie administra usuarios de un rol superior al suyo.
const RANGO: Record<Rol, number> = { admin_red: 3, director: 2, secretaria: 1, docente: 1, tutor: 1, estudiante: 1 };

/** Reglas de `repo.js propiedad()` para `usuarios` + jerarquía de roles + no tocarse a uno mismo. */
export function puedeAdministrarUsuario(ses: SesionApi, antes: Registro | null | undefined, nuevo: Registro | null | undefined): Decision {
  if (ses.rol === 'admin_red') return OK;
  if (ses.rol !== 'director') return no('Sin permiso para administrar usuarios');
  const rolNuevo = str(nuevo?.rol);
  const rolAntes = str(antes?.rol);
  if (rolNuevo === 'admin_red' || rolAntes === 'admin_red') return no('Sin permiso para administrar usuarios admin_red');
  if ((rolNuevo && !(rolNuevo in RANGO)) || (rolAntes && !(rolAntes in RANGO))) return no('Rol no válido', 'datos_invalidos', 422);
  if ((rolNuevo && RANGO[rolNuevo as Rol] > RANGO[ses.rol]) || (rolAntes && RANGO[rolAntes as Rol] > RANGO[ses.rol])) {
    return no('No puedes asignar ni modificar un rol superior al tuyo');
  }
  if (antes && antes.id === ses.usuarioId && nuevo) {
    if (nuevo.rol !== antes.rol || (nuevo.refId ?? null) !== (antes.refId ?? null) || (nuevo.centroId ?? null) !== (antes.centroId ?? null)) {
      return no('No puedes cambiar tu propio rol o centro');
    }
  }
  return OK;
}

/**
 * Colecciones del aula/horarios con `cargaId`: el docente solo escribe sobre SUS cargas (la ficha del registro
 * debe traer la carga; sin ella se deniega, como hace `propiedad()` con actividades/categorías).
 */
const POR_CARGA_DOCENTE = new Set([
  'notasCompetencia', 'actividades', 'categorias', 'horarios', 'aulaContenidos', 'tareas', 'cuestionarios', 'foros', 'anuncios',
  'entregas', 'intentos', 'foroMensajes',
]);

async function propiedad(ses: SesionApi, col: string, rec: Registro, antes: Registro | null | undefined, o: OpcionesPuede): Promise<Decision> {
  const al = o.alcance;
  const versiones = antes ? [rec, antes] : [rec];

  if (ses.rol === 'docente') {
    const cargas = new Set(al?.cargaIds ?? []);
    const secciones = new Set(al?.seccionIds ?? []);
    for (const r of versiones) {
      if (col === 'calificaciones') {
        const act = str(r.actividadId);
        const carga = act && o.cargaDeActividad ? await o.cargaDeActividad(act) : null;
        if (!act || carga === null) return no('Actividad no encontrada', 'actividad_no_encontrada', 422);
        if (!cargas.has(carga)) return no('Sin permiso: la carga docente no es tuya');
      } else if (POR_CARGA_DOCENTE.has(col)) {
        const c = str(r.cargaId);
        if (!c || !cargas.has(c)) return no('Sin permiso: la carga docente no es tuya');
      } else if (col === 'planes') {
        const c = str(r.cargaId);
        if (c) {
          if (!cargas.has(c)) return no('Sin permiso: la carga docente no es tuya');
        } else if (r.docenteId !== ses.refId) {
          return no('Sin permiso: el plan no es tuyo');
        }
      } else if (col === 'asistencia') {
        const s = str(r.seccionId);
        if (!s || !secciones.has(s)) return no('Sin permiso: la sección no es tuya');
      } else if (col === 'agenteConfig') {
        if (r.docenteId !== undefined && r.docenteId !== ses.refId) return no('Sin permiso: la configuración no es tuya');
      } else if (col === 'agenteLog') {
        if (r.usuarioId !== undefined && r.usuarioId !== ses.usuarioId) return no('Sin permiso: el registro no es tuyo');
      }
    }
  }

  if (ses.rol === 'estudiante') {
    const cargas = new Set(al?.cargaIds ?? []);
    for (const r of versiones) {
      if (col === 'entregas' || col === 'intentos') {
        if (r.estudianteId !== ses.refId || !ses.refId) return no('Sin permiso: solo tus propios registros');
        const c = str(r.cargaId);
        if (c !== null && !cargas.has(c)) return no('Sin permiso: la carga no corresponde a tus secciones');
      }
      if (col === 'foroMensajes') {
        if (r.autorId !== ses.usuarioId) return no('Sin permiso: solo tus propios mensajes');
        const c = str(r.cargaId);
        if (c !== null && !cargas.has(c)) return no('Sin permiso: la carga no corresponde a tus secciones');
      }
    }
  }

  if (col === 'usuarios') return puedeAdministrarUsuario(ses, antes, rec);
  return OK;
}

/**
 * ¿Puede `ses` ejecutar `accion` sobre `col`? `registro` son los valores NUEVOS (crear/editar) o el registro
 * afectado; `opciones.antes` el estado previo. Para listar/obtener solo se evalúa rol y centro: el filtrado por
 * alcance de cada registro lo hace la consulta SQL (alcance.ts), de modo que un registro fuera de alcance
 * simplemente no existe para quien pregunta (404).
 */
export async function puede(ses: SesionApi, col: string, accion: Accion, registro?: Registro | null, opciones: OpcionesPuede = {}): Promise<Decision> {
  const meta = metaDe(col);
  if (!meta) return no('Colección desconocida', 'coleccion_desconocida', 404);

  // 1) rol → colección
  if (ESCRITURAS.includes(accion)) {
    if (meta.tipo === 'auditoria') return no('La auditoría es de solo anexado: usa POST /auditoria', 'auditoria_inmutable');
    if (!puedeEscribirColeccion(ses.rol, col)) return no(`Sin permiso para ${accion} en ${col}`);
  } else if (!meta.lectura.includes(ses.rol)) {
    return no(`Sin permiso para leer ${col}`);
  }

  // 2) centro
  if (registro) {
    const cid = meta.tipo === 'centros' ? str(registro.id) : str(registro.centroId);
    if (cid !== null && ses.rol !== 'admin_red' && cid !== ses.centroId) return no('Centro no permitido', 'centro_no_permitido');
  }

  // 3-4) alcance + propiedad (solo escrituras; ver arriba)
  if (ESCRITURAS.includes(accion)) {
    const rec = registro ?? opciones.antes ?? {};
    return propiedad(ses, col, rec, opciones.antes, opciones);
  }
  return OK;
}
