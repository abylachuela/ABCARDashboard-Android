// Carga la semilla demo del FRONTEND (js/data/semilla.js) en Node sin modificarla: se ejecuta en un contexto `vm`
// con un `window` mínimo. Solo desarrollo. Los datos son ficticios (los de la demo pública del repo).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../js');
const ARCHIVOS = ['core/escala.js', 'core/calculo.js', 'data/repo-local.js', 'data/curriculo-semilla.js', 'data/cursos-semilla.js', 'data/semilla.js'];

export type SemillaDemo = Record<string, Record<string, unknown>[]>;

export function generarSemillaDemo(): SemillaDemo {
  const ctx: Record<string, unknown> = { addEventListener: () => undefined };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ARCHIVOS) vm.runInContext(readFileSync(path.join(RAIZ_JS, f), 'utf8'), ctx, { filename: f, timeout: 10_000 });
  const edu = ctx.EDU as { semilla: { generar(): SemillaDemo } };
  // Copia estructurada: los objetos del contexto vm no comparten prototipos con los de este contexto.
  return JSON.parse(JSON.stringify(edu.semilla.generar())) as SemillaDemo;
}
