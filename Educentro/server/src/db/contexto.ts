// Capa de acceso transaccional con contexto de seguridad.
//
// REGLA: toda consulta de datos de la API se ejecuta dentro de `conContexto`, que abre una transacción y fija
// `SET LOCAL app.centro_id / app.rol / app.usuario_id`. Las políticas RLS de PostgreSQL leen esos valores.
// Falla cerrado: sin contexto válido no se obtiene un `Tx`, y un `Tx` no expone el cliente ni permite COMMIT/SET
// manuales; además, sin contexto la propia BD devuelve 0 filas.
import type { Pool, Cliente } from './pool.js';
import { esRol, type Rol } from '../domain/permisos.js';

export interface ContextoSeguridad {
  rol: Rol;
  /** null solo para admin_red. */
  centroId: string | null;
  usuarioId: string;
}

export class ErrorContexto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorContexto';
  }
}

const TEXTO_SEGURO = /^[\w.:@-]{1,100}$/;

/** Valida el contexto; lanza si falta o es incoherente (nunca se «adivina» un centro). */
export function validarContexto(ctx: ContextoSeguridad): void {
  if (!ctx || !esRol(ctx.rol)) throw new ErrorContexto('Contexto de seguridad sin rol válido');
  if (typeof ctx.usuarioId !== 'string' || !TEXTO_SEGURO.test(ctx.usuarioId)) throw new ErrorContexto('Contexto sin usuario');
  if (ctx.rol === 'admin_red') {
    if (ctx.centroId !== null) throw new ErrorContexto('admin_red no lleva centro en el contexto');
  } else if (typeof ctx.centroId !== 'string' || !TEXTO_SEGURO.test(ctx.centroId)) {
    throw new ErrorContexto('Contexto sin centro: se rechaza la consulta');
  }
}

/** Ejecutor de consultas dentro de la transacción con contexto. Es lo único que ven los repositorios. */
export class Tx {
  readonly #c: Cliente;
  readonly contexto: Readonly<ContextoSeguridad>;
  constructor(c: Cliente, contexto: ContextoSeguridad) {
    this.#c = c;
    this.contexto = Object.freeze({ ...contexto });
  }
  async query<R extends Record<string, unknown> = Record<string, unknown>>(texto: string, valores: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
    if (/^\s*(begin|commit|rollback|start\s+transaction|set\s|reset\s|select\s+set_config|savepoint|release)/i.test(texto)) {
      throw new ErrorContexto('Sentencia de control de transacción no permitida en la capa de datos');
    }
    const r = await this.#c.query<R>(texto, valores);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  }
}

export async function conContexto<T>(pool: Pool, ctx: ContextoSeguridad, fn: (tx: Tx) => Promise<T>): Promise<T> {
  validarContexto(ctx);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // set_config(..., true) = SET LOCAL: desaparece al terminar la transacción (no se filtra a otra petición del pool).
    await c.query("SELECT set_config('app.centro_id', $1, true), set_config('app.rol', $2, true), set_config('app.usuario_id', $3, true)", [
      ctx.centroId ?? '',
      ctx.rol,
      ctx.usuarioId,
    ]);
    const r = await fn(new Tx(c, ctx));
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* conexión rota: se descarta al liberar */
    }
    throw e;
  } finally {
    c.release();
  }
}
