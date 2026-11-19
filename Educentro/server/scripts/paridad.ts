// Paridad de permisos entre el cliente (js/core/permisos.js) y el servidor (src/domain/permisos.json).
// FUENTE: js/core/permisos.js. El JSON se GENERA desde él (`npm run paridad -- --generar`) y esta comprobación
// FALLA si ambos difieren. Se ejecuta en CI y como prueba de vitest (test/paridad.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_FRONTEND = path.resolve(AQUI, '../..');
export const RUTA_JSON = path.resolve(AQUI, '../src/domain/permisos.json');

export interface PermisosJson {
  ROLES: string[];
  NAV: string[];
  MATRIZ: Record<string, Record<string, string[]>>;
  ESCRIBE: Record<string, string[]>;
  COLECCIONES: string[];
}

/** Carga un script del cliente (IIFE sobre window.EDU) en un contexto aislado de `vm`, sin tocar el frontend. */
function cargarEnVm(archivos: string[]): { EDU: Record<string, any> } {
  const ctx: Record<string, unknown> = { addEventListener: () => undefined };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of archivos) {
    vm.runInContext(readFileSync(path.join(RAIZ_FRONTEND, f), 'utf8'), ctx, { filename: f, timeout: 5_000 });
  }
  return ctx as { EDU: Record<string, any> };
}

const ordenado = (a: string[]): string[] => [...a].sort();

/** Lee permisos.js y repo-local.js y devuelve la estructura que debe tener el JSON. */
export function cargarPermisosDelCliente(): PermisosJson {
  const { EDU } = cargarEnVm(['js/core/permisos.js', 'js/data/repo-local.js']);
  const P = EDU.permisos;
  const COLECCIONES: string[] = [...EDU.repoLocal.COLECCIONES];
  const ROLES = Object.keys(P.ROLES);
  const MATRIZ: PermisosJson['MATRIZ'] = {};
  for (const r of ROLES) {
    MATRIZ[r] = {};
    for (const m of Object.keys(P.MATRIZ[r]).sort()) MATRIZ[r][m] = ordenado(P.MATRIZ[r][m] as string[]);
  }
  // ESCRIBE es privado en permisos.js: se obtiene sondeando puedeEscribirColeccion para cada rol y colección.
  const ESCRIBE: PermisosJson['ESCRIBE'] = {};
  for (const r of ROLES) ESCRIBE[r] = COLECCIONES.filter((c) => P.puedeEscribirColeccion(r, c)).sort();
  return { ROLES, NAV: (P.NAV as { ruta: string }[]).map((n) => n.ruta), MATRIZ, ESCRIBE, COLECCIONES };
}

const norm = (j: PermisosJson): PermisosJson => ({
  ROLES: j.ROLES,
  NAV: j.NAV,
  COLECCIONES: j.COLECCIONES,
  MATRIZ: Object.fromEntries(
    Object.keys(j.MATRIZ).sort().map((r) => [r, Object.fromEntries(Object.keys(j.MATRIZ[r]!).sort().map((m) => [m, ordenado(j.MATRIZ[r]![m]!)]))]),
  ),
  ESCRIBE: Object.fromEntries(Object.keys(j.ESCRIBE).sort().map((r) => [r, ordenado(j.ESCRIBE[r]!)])),
});

/** Devuelve la lista de diferencias (vacía = paridad). */
export function compararPermisos(cliente: PermisosJson, servidor: PermisosJson): string[] {
  const dif: string[] = [];
  const a = norm(cliente);
  const b = norm(servidor);
  const igual = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!igual(a.ROLES, b.ROLES)) dif.push(`ROLES difiere: cliente=${a.ROLES.join(',')} servidor=${b.ROLES.join(',')}`);
  if (!igual(a.NAV, b.NAV)) dif.push('NAV (rutas de módulos) difiere');
  if (!igual(ordenado(a.COLECCIONES), ordenado(b.COLECCIONES))) dif.push('COLECCIONES difiere de repo-local.js');
  for (const r of new Set([...Object.keys(a.MATRIZ), ...Object.keys(b.MATRIZ)])) {
    for (const m of new Set([...Object.keys(a.MATRIZ[r] ?? {}), ...Object.keys(b.MATRIZ[r] ?? {})])) {
      if (!igual(a.MATRIZ[r]?.[m], b.MATRIZ[r]?.[m])) {
        dif.push(`MATRIZ[${r}][${m}] difiere: cliente=${JSON.stringify(a.MATRIZ[r]?.[m])} servidor=${JSON.stringify(b.MATRIZ[r]?.[m])}`);
      }
    }
  }
  for (const r of new Set([...Object.keys(a.ESCRIBE), ...Object.keys(b.ESCRIBE)])) {
    if (!igual(a.ESCRIBE[r], b.ESCRIBE[r])) dif.push(`ESCRIBE[${r}] difiere: cliente=${JSON.stringify(a.ESCRIBE[r])} servidor=${JSON.stringify(b.ESCRIBE[r])}`);
  }
  return dif;
}

export function leerJsonServidor(): PermisosJson {
  return JSON.parse(readFileSync(RUTA_JSON, 'utf8')) as PermisosJson;
}

function main(): void {
  const cliente = cargarPermisosDelCliente();
  if (process.argv.includes('--generar')) {
    writeFileSync(RUTA_JSON, JSON.stringify(norm(cliente), null, 2) + '\n');
    console.log(`permisos.json regenerado desde js/core/permisos.js`);
    return;
  }
  const dif = compararPermisos(cliente, leerJsonServidor());
  if (dif.length) {
    console.error('PARIDAD ROTA entre js/core/permisos.js y server/src/domain/permisos.json:\n - ' + dif.join('\n - '));
    console.error('\nSi el cambio en permisos.js es correcto: npm run paridad -- --generar y revisa el diff.');
    process.exit(1);
  }
  console.log('Paridad OK: MATRIZ, ESCRIBE, ROLES, NAV y COLECCIONES coinciden con js/core/permisos.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
