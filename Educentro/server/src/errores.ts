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
