// Carga los scripts del CLIENTE (js/core, js/data/consultas.js) en un contexto `vm` propio, tal como los carga el navegador
// (global `window`), SIN pasar por el shim del servidor. Sirve de «lado cliente» en las pruebas de paridad.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const RAIZ_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EduCliente = Record<string, any>;

export function cargarEduCliente(archivos: string[] = ['core/formato.js', 'core/escala.js', 'core/calculo.js', 'data/consultas.js']): EduCliente {
  const ctx: Record<string, unknown> = { addEventListener: () => undefined };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of archivos) vm.runInContext(readFileSync(path.join(RAIZ_JS, f), 'utf8'), ctx, { filename: f, timeout: 10_000 });
  return ctx.EDU as EduCliente;
}

/** PRNG determinista (mulberry32) para casos «aleatorios» reproducibles. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
