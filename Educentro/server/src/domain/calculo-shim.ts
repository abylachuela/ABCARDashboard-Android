// Cálculo de notas COMPARTIDO con el cliente: carga js/core/escala.js, js/core/calculo.js y js/data/consultas.js
// (resumenNotas) SIN copiarlos ni reescribirlos, bajo `vm` con un `window` mínimo. Única fuente de verdad: si el
// cliente cambia una regla, el servidor la hereda. Falla CERRADO: si los archivos no se encuentran, cambian de
// forma (faltan funciones esperadas) o dejan de dar los resultados canarios, el módulo lanza al importarse y el
// servidor no arranca / la prueba de paridad falla.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** Carpeta `js/` del frontend. En el repo: Educentro/js; en la imagen Docker: /app/js (EDU_JS_DIR la sobreescribe). */
function carpetaJs(): string {
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
  throw new Error('Cálculo compartido: no se encuentran js/core/calculo.js (define EDU_JS_DIR).');
}

const ARCHIVOS = ['core/escala.js', 'core/calculo.js', 'data/consultas.js'] as const;

type Json = Record<string, unknown>;
type Fn = (...args: never[]) => unknown;

/** Superficie del cliente que el servidor usa. Si cambia de forma, se falla cerrado. */
const FORMA: Record<string, readonly string[]> = {
  calculo: ['aNumero', 'redondear', 'notaActividad', 'detalleCategoria', 'ponderar', 'calcularPeriodo', 'calcularFinal', 'aprobado', 'promedioGeneral', 'validarPesos', 'modelo', 'configCompetencias', 'efectivoPeriodo', 'promedioCompetencia', 'calcularCompetencias'],
  escala: ['porDefecto', 'crear', 'validar', 'tramo', 'porcentaje', 'desdePorcentaje', 'convertir'],
  consultas: ['agrupar', 'escalaDe', 'periodoAbierto', 'resumenNotas'],
};

export interface CalculoCompartido {
  /** Huellas SHA-256 de los archivos cargados (para diagnóstico y para la prueba que los vigila). */
  huellas: Record<string, string>;
  aNumero(v: unknown): number | null;
  redondear(n: unknown, dec?: number): number | null;
  notaActividad(puntos: unknown, puntosMax: unknown, escala: unknown): number | null;
  calcularPeriodo(o: Json): { nota: number | null; categorias: Json[] };
  calcularFinal(o: Json): { final: number | null; aprobado: boolean | null; periodos: Json[] };
  calcularCompetencias(o: Json): Json & { cf: number | null; final: number | null; estado: string; aprobado: boolean | null; completo: boolean; cfc: number | null; cexf: number | null };
  configCompetencias(escala: unknown): { competencias: number; periodos: number } & Json;
  aprobado(nota: unknown, escala: unknown): boolean;
  promedioGeneral(notas: unknown[]): number | null;
  validarPesos(pesos: unknown[], objetivo?: number): { ok: boolean; suma: number; diferencia: number };
  modelo(escala: unknown): 'ponderado' | 'competencias';
  escalaDe(escalas: Json[], centroId: string): Json;
  escalaPorDefecto(): Json;
  porcentaje(nota: number | null, escala: unknown): number | null;
  /** EDU.consultas.resumenNotas del cliente (datos planos, ver docs/API.md). Devuelve objetos de este contexto JS. */
  resumenNotas(d: Json): Json[];
}

interface Edu {
  calculo: Record<string, Fn>;
  escala: Record<string, Fn>;
  consultas: Record<string, Fn>;
}

function cargar(): CalculoCompartido {
  const raiz = carpetaJs();
  const ctx: Record<string, unknown> = {};
  ctx.window = ctx;
  vm.createContext(ctx, { codeGeneration: { strings: false, wasm: false } });
  const huellas: Record<string, string> = {};
  for (const f of ARCHIVOS) {
    const src = readFileSync(path.join(raiz, f), 'utf8');
    huellas[f] = createHash('sha256').update(src).digest('hex');
    vm.runInContext(src, ctx, { filename: f, timeout: 5_000 });
  }
  const edu = ctx.EDU as Edu | undefined;
  for (const [modulo, nombres] of Object.entries(FORMA)) {
    const m = edu?.[modulo as keyof Edu];
    const falta = nombres.filter((n) => typeof m?.[n] !== 'function');
    if (falta.length) throw new Error(`Cálculo compartido: EDU.${modulo} cambió de forma (faltan: ${falta.join(', ')}). Revisa js/core y el servidor.`);
  }
  const E = edu as Edu;
  const c = E.calculo as unknown as Record<string, (...a: unknown[]) => unknown>;
  const e = E.escala as unknown as Record<string, (...a: unknown[]) => unknown>;
  const q = E.consultas as unknown as Record<string, (...a: unknown[]) => unknown>;
  const aplicar = <T>(f: (...a: unknown[]) => unknown) => (...a: unknown[]): T => f(...a) as T;
  const calc: CalculoCompartido = {
    huellas,
    aNumero: aplicar(c.aNumero as never),
    redondear: aplicar(c.redondear as never),
    notaActividad: aplicar(c.notaActividad as never),
    calcularPeriodo: aplicar(c.calcularPeriodo as never),
    calcularFinal: aplicar(c.calcularFinal as never),
    calcularCompetencias: aplicar(c.calcularCompetencias as never),
    configCompetencias: aplicar(c.configCompetencias as never),
    aprobado: aplicar(c.aprobado as never),
    promedioGeneral: aplicar(c.promedioGeneral as never),
    validarPesos: aplicar(c.validarPesos as never),
    modelo: aplicar(c.modelo as never),
    escalaDe: aplicar(q.escalaDe as never),
    escalaPorDefecto: aplicar(e.porDefecto as never),
    porcentaje: aplicar(e.porcentaje as never),
    resumenNotas: aplicar(q.resumenNotas as never),
  };
  verificarCanarios(calc);
  return calc;
}

/** Resultados conocidos: si el cliente cambia una regla de cálculo, el servidor se niega a arrancar hasta revisarlo. */
function verificarCanarios(c: CalculoCompartido): void {
  const e100 = { min: 0, max: 100, notaMinAprobar: 70 };
  const ok: boolean[] = [];
  const cerca = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-9;
  ok.push(cerca(c.notaActividad(15, 20, e100), 75));
  ok.push(c.aprobado(70, e100) === true && c.aprobado(69.999, e100) === false);
  ok.push(c.validarPesos([20, 30, 50]).ok === true && c.validarPesos([20, 30]).ok === false);
  const f = c.calcularFinal({
    categorias: [{ id: 'T', peso: 100 }],
    actividades: [{ id: 'x', categoriaId: 'T', periodoId: 'p1', puntosMax: 20 }],
    escala: e100,
    periodos: [{ id: 'p1', peso: 100 }],
    calificaciones: { x: 14 },
  });
  ok.push(cerca(f.final, 70) && f.aprobado === true);
  const cuatro = [0, 1, 2, 3].map(() => ({ p: [60, 60, 60, 60], rp: [null, null, null, null] }));
  const esc = { ...e100, modelo: 'competencias' };
  const r = c.calcularCompetencias({ competencias: cuatro, cec: 90, escala: esc });
  ok.push(cerca(r.cfc, 75) && r.estado === 'Aprobado');
  const r2 = c.calcularCompetencias({ competencias: cuatro, cec: 70, cex: 85, escala: esc });
  ok.push(cerca(r2.cexf, 0.3 * 60 + 0.7 * 85) && r2.estado === 'Aprobado');
  ok.push(c.modelo(esc) === 'competencias' && c.modelo(e100) === 'ponderado');
  if (ok.some((x) => !x)) throw new Error('Cálculo compartido: los resultados canarios no coinciden; las reglas de js/core cambiaron. Revisa el servidor.');
}

let instancia: CalculoCompartido | null = null;
/** Instancia única (carga perezosa; lanza si el cálculo compartido no es utilizable). */
export function calculo(): CalculoCompartido {
  instancia ??= cargar();
  return instancia;
}

/** Copia estructurada: los objetos del contexto `vm` no comparten prototipos con los de este contexto. */
export const normalizar = <T>(x: unknown): T => JSON.parse(JSON.stringify(x)) as T;
