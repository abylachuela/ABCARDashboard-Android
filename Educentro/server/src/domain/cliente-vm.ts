// Carga scripts del CLIENTE (js/…) bajo `vm` con un `window` mínimo, SIN copiarlos: el servidor reutiliza las reglas puras
// del cliente (horarios-motor.js, curriculo-semilla.js) y así no pueden divergir. Falla CERRADO si los archivos faltan o
// cambian de forma. Misma carpeta que calculo-shim (EDU_JS_DIR en la imagen Docker).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export function carpetaJsCliente(): string {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const candidatos = [process.env.EDU_JS_DIR, path.resolve(aqui, '../../../js'), path.resolve(aqui, '../../js')].filter((x): x is string => !!x);
  for (const c of candidatos) {
    try {
      readFileSync(path.join(c, 'core/calculo.js'));
      return c;
    } catch {
      /* siguiente candidato */
    }
  }
  throw new Error('No se encuentra la carpeta js/ del cliente (define EDU_JS_DIR).');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Edu = Record<string, any>;

/** Ejecuta `archivos` (relativos a js/) en un contexto aislado y devuelve su objeto `EDU` y las huellas SHA-256. */
export function cargarCliente(archivos: readonly string[]): { edu: Edu; huellas: Record<string, string> } {
  const raiz = carpetaJsCliente();
  const ctx: Record<string, unknown> = { addEventListener: () => undefined };
  ctx.window = ctx;
  vm.createContext(ctx, { codeGeneration: { strings: false, wasm: false } });
  const huellas: Record<string, string> = {};
  for (const f of archivos) {
    const src = readFileSync(path.join(raiz, f), 'utf8');
    huellas[f] = createHash('sha256').update(src).digest('hex');
    vm.runInContext(src, ctx, { filename: f, timeout: 5_000 });
  }
  return { edu: ctx.EDU as Edu, huellas };
}

/** Copia estructurada: los objetos del contexto `vm` no comparten prototipos con los de este contexto. */
export const aPlano = <T>(x: unknown): T => JSON.parse(JSON.stringify(x)) as T;
