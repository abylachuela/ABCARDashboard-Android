// Permisos por rol. FUENTE ÚNICA: permisos.json (generado desde js/core/permisos.js y validado en CI con
// `npm run paridad`). Aquí solo se tipa y se ofrecen ayudas de consulta.
import datos from './permisos.json' with { type: 'json' };

export const ROLES = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'] as const;
export type Rol = (typeof ROLES)[number];

export const MATRIZ = datos.MATRIZ as unknown as Record<Rol, Record<string, string[]>>;
export const ESCRIBE = datos.ESCRIBE as unknown as Record<Rol, string[]>;
export const NAV = datos.NAV as string[];

export const esRol = (x: unknown): x is Rol => typeof x === 'string' && (ROLES as readonly string[]).includes(x);

export const puedeModulo = (rol: Rol, modulo: string, accion = 'ver'): boolean =>
  !!MATRIZ[rol]?.[modulo]?.includes(accion);

export const puedeEscribirColeccion = (rol: Rol, col: string): boolean => !!ESCRIBE[rol]?.includes(col);
