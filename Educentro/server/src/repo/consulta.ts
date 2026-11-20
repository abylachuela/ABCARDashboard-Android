// Parámetros de listado: filtros simples `f.campo=valor`, `orden`, `desc`, `limite` (máx 500), `offset`.
// Los NOMBRES de campo se validan con una expresión estricta y TODOS los valores viajan como parámetros SQL.
import { z } from 'zod';
import { ErrorHttp } from '../errores.js';

export const LIMITE_MAX = 500;
export const LIMITE_DEFECTO = 100;
const CAMPO = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_FILTROS = 10;
const MAX_VALORES = 50;

export interface Consulta {
  filtros: { campo: string; valores: string[] }[];
  orden: string | null;
  desc: boolean;
  limite: number;
  offset: number;
  centroId: string | null;
}

const esquema = z.object({
  orden: z.string().regex(CAMPO, 'orden no permitido').optional(),
  desc: z.enum(['true', 'false', '1', '0']).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAX).default(LIMITE_DEFECTO),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  centroId: z.string().min(1).max(100).optional(),
});

export function parsearConsulta(query: unknown): Consulta {
  const q = (query ?? {}) as Record<string, unknown>;
  const base = esquema.parse(q); // ZodError → 422 con los campos inválidos
  const filtros: Consulta['filtros'] = [];
  for (const [clave, bruto] of Object.entries(q)) {
    if (!clave.startsWith('f.')) continue;
    const campo = clave.slice(2);
    if (!CAMPO.test(campo)) throw new ErrorHttp(422, 'filtro_no_permitido', 'Campo de filtro no permitido.', [clave]);
    const valores = (Array.isArray(bruto) ? bruto : [bruto]).map((v) => (typeof v === 'string' ? v : null));
    if (valores.some((v) => v === null || v.length > 200) || valores.length > MAX_VALORES) {
      throw new ErrorHttp(422, 'filtro_no_permitido', 'Valor de filtro no permitido.', [clave]);
    }
    filtros.push({ campo, valores: valores as string[] });
  }
  if (filtros.length > MAX_FILTROS) throw new ErrorHttp(422, 'filtro_no_permitido', `Máximo ${MAX_FILTROS} filtros.`, ['f.*']);
  return {
    filtros,
    orden: base.orden ?? null,
    desc: base.desc === 'true' || base.desc === '1',
    limite: base.limite,
    offset: base.offset,
    centroId: base.centroId ?? null,
  };
}

/** `campoApi → columna SQL` de las columnas tipadas; el resto de campos vive en `datos`. */
export type Columnas = Record<string, string>;

/**
 * Añade a `where`/`params` los filtros. Cada filtro admite varios valores (OR). Para campos de `datos` se compara
 * el texto (`datos->>campo`): `f.activa=true`, `f.orden=3`, `f.estado=activa&f.estado=retirada`.
 */
export function aplicarFiltros(c: Consulta, columnas: Columnas, params: unknown[], where: string[]): void {
  for (const f of c.filtros) {
    params.push(f.valores);
    const n = `$${params.length}`;
    const col = Object.hasOwn(columnas, f.campo) ? columnas[f.campo] : undefined;
    if (col) {
      where.push(`${col}::text = ANY(${n}::text[])`);
    } else {
      params.push(f.campo);
      where.push(`datos->>$${params.length}::text = ANY(${n}::text[])`);
    }
  }
}

/** ORDER BY seguro: numérico si el valor parece un número, después texto; desempate por id. */
export function sqlOrden(c: Consulta, columnas: Columnas, params: unknown[]): string {
  const dir = c.desc ? 'DESC' : 'ASC';
  if (!c.orden) return 'ORDER BY id';
  const col = Object.hasOwn(columnas, c.orden) ? columnas[c.orden] : undefined;
  if (col) return `ORDER BY ${col} ${dir} NULLS LAST, id`;
  params.push(c.orden);
  const n = `$${params.length}::text`;
  return (
    `ORDER BY (CASE WHEN datos->>${n} ~ '^-?[0-9]{1,30}([.][0-9]{1,30})?$' THEN (datos->>${n})::numeric END) ${dir} NULLS LAST, ` +
    `datos->>${n} ${dir} NULLS LAST, id`
  );
}

export const paginacion = (c: Consulta, total: number, devueltos: number): { total: number; siguiente: number | null } => ({
  total,
  siguiente: c.offset + devueltos < total ? c.offset + devueltos : null,
});
