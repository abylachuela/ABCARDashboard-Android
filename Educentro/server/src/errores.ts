import type { FastifyError } from 'fastify';

export class ErrorHttp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos?: string[],
    /** Datos adicionales y no sensibles que se devuelven dentro de `error` (p. ej. filas rechazadas de un lote). */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}

export interface CuerpoError {
  error: { codigo: string; mensaje: string; campos?: string[]; [k: string]: unknown };
}

/** Índices UNIQUE de negocio (migración 0010) → código y mensaje en español del 409. */
export const UNICOS: Readonly<Record<string, { codigo: string; mensaje: string }>> = {
  estudiantes_documento_uidx: { codigo: 'documento_duplicado', mensaje: 'Ya existe un estudiante con ese documento en el centro.' },
  docentes_documento_uidx: { codigo: 'documento_duplicado', mensaje: 'Ya existe un docente con ese documento en el centro.' },
  tutores_documento_uidx: { codigo: 'documento_duplicado', mensaje: 'Ya existe un tutor con ese documento en el centro.' },
  estudiantes_codigo_uidx: { codigo: 'codigo_matricula_duplicado', mensaje: 'Ya existe un estudiante con ese código de matrícula en el centro.' },
  matriculas_estudiante_anio_uidx: { codigo: 'matricula_duplicada', mensaje: 'El estudiante ya tiene una matrícula en ese año lectivo.' },
  anios_activo_uidx: { codigo: 'anio_activo_duplicado', mensaje: 'Solo puede haber un año lectivo activo por centro. Usa «activar» para cambiarlo.' },
  escalas_activa_uidx: { codigo: 'escala_activa_duplicada', mensaje: 'Solo puede haber una escala de calificación activa por centro.' },
  curriculo_versiones_vigente_uidx: { codigo: 'curriculo_vigente_duplicado', mensaje: 'Solo puede haber una versión vigente del currículo por centro. Usa «marcar vigente».' },
  secciones_curso_anio_nombre_uidx: { codigo: 'seccion_duplicada', mensaje: 'Ya existe una sección con ese nombre para el curso y año lectivo.' },
  cargas_seccion_asignatura_uidx: { codigo: 'carga_duplicada', mensaje: 'Esa asignatura ya está asignada a la sección.' },
  inscripciones_curso_estudiante_uidx: { codigo: 'inscripcion_duplicada', mensaje: 'El estudiante ya tiene una inscripción en ese curso.' },
  periodos_anio_orden_uidx: { codigo: 'periodo_orden_duplicado', mensaje: 'Ya existe un periodo con ese orden en el año lectivo.' },
  calificaciones_act_est_uidx: { codigo: 'calificacion_duplicada', mensaje: 'Ya existe una calificación para esa actividad y estudiante.' },
  asistencia_unica_idx: { codigo: 'asistencia_duplicada', mensaje: 'Ya existe un registro de asistencia para esa sección, estudiante y fecha.' },
};

export function aRespuesta(err: unknown): { status: number; cuerpo: CuerpoError } {
  if (err instanceof ErrorHttp) {
    return {
      status: err.status,
      cuerpo: { error: { codigo: err.codigo, mensaje: err.message, ...(err.campos ? { campos: err.campos } : {}), ...(err.extra ?? {}) } },
    };
  }
  const e = err as Partial<FastifyError> & { codigo?: string; mensaje?: string; constraint?: string };
  // Errores de PostgreSQL (SQLSTATE de 5 caracteres): mensajes propios, sin detalles internos.
  const pg = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && !e.code.startsWith('FST') ? e.code : null;
  if (pg === '23505' && e.constraint && UNICOS[e.constraint]) return { status: 409, cuerpo: { error: UNICOS[e.constraint] as { codigo: string; mensaje: string } } };
  if (pg === '23505') return { status: 409, cuerpo: { error: { codigo: 'conflicto', mensaje: 'Ya existe un registro con esos datos.' } } };
  if (pg === '23503') return { status: 422, cuerpo: { error: { codigo: 'referencia_invalida', mensaje: 'Una referencia (p. ej. el centro) no existe.' } } };
  if (pg === '42501') return { status: 403, cuerpo: { error: { codigo: 'sin_permiso', mensaje: 'Sin permiso para esta operación.' } } };
  if (pg && ['22P05', '22021', '22P02', '22007', '22003', '23514', '23502'].includes(pg)) {
    return { status: 422, cuerpo: { error: { codigo: 'datos_invalidos', mensaje: 'Hay datos inválidos en la solicitud.' } } };
  }
  const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
  // Mensajes propios en español; nunca se devuelve e.message de errores internos.
  if (e.codigo && e.mensaje) return { status, cuerpo: { error: { codigo: e.codigo, mensaje: e.mensaje } } };
  switch (status) {
    case 400:
      return { status, cuerpo: { error: { codigo: 'solicitud_invalida', mensaje: 'La solicitud no es válida.' } } };
    case 413:
      return { status, cuerpo: { error: { codigo: 'cuerpo_demasiado_grande', mensaje: 'La solicitud es demasiado grande.' } } };
    case 415:
      return { status, cuerpo: { error: { codigo: 'tipo_no_soportado', mensaje: 'Formato de contenido no soportado: use application/json.' } } };
    case 429:
      return { status, cuerpo: { error: { codigo: 'demasiadas_solicitudes', mensaje: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' } } };
    default:
      if (status >= 500) {
        return { status: 500, cuerpo: { error: { codigo: 'error_interno', mensaje: 'Ocurrió un error interno. Inténtalo de nuevo más tarde.' } } };
      }
      return { status, cuerpo: { error: { codigo: 'solicitud_invalida', mensaje: 'La solicitud no es válida.' } } };
  }
}
