import type { FastifyError } from 'fastify';

export class ErrorHttp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly campos?: string[],
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}

export interface CuerpoError {
  error: { codigo: string; mensaje: string; campos?: string[] };
}

export function aRespuesta(err: unknown): { status: number; cuerpo: CuerpoError } {
  if (err instanceof ErrorHttp) {
    return {
      status: err.status,
      cuerpo: { error: { codigo: err.codigo, mensaje: err.message, ...(err.campos ? { campos: err.campos } : {}) } },
    };
  }
  const e = err as Partial<FastifyError> & { codigo?: string; mensaje?: string };
  // Errores de PostgreSQL (SQLSTATE de 5 caracteres): mensajes propios, sin detalles internos.
  const pg = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && !e.code.startsWith('FST') ? e.code : null;
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
