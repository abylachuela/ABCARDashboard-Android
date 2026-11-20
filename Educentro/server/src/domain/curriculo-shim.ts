// Esquema, aplanado y hash del currículo COMPARTIDOS con el cliente: js/core/formato.js + js/data/curriculo-semilla.js bajo
// `vm` (EDU.curriculoSemilla.{validarDoc, aplanar, hashItems, registros, versionDe}). Falla cerrado si cambian de forma.
import { aPlano, cargarCliente, type Edu } from './cliente-vm.js';

type Json = Record<string, unknown>;
export interface CurriculoCompartido {
  validarDoc(doc: unknown): string[];
  aplanar(doc: unknown): Json[];
  hashItems(items: Json[]): string;
  registros(doc: unknown, centroId: string, versionId: string | null): Json[];
  versionDe(doc: unknown, items: Json[], extra: Json): Json;
}
const ARCHIVOS = ['core/formato.js', 'data/curriculo-semilla.js'] as const;
let instancia: CurriculoCompartido | null = null;

function cargar(): CurriculoCompartido {
  const { edu } = cargarCliente(ARCHIVOS);
  const c = (edu as Edu).curriculoSemilla as Record<string, (...a: unknown[]) => unknown> | undefined;
  const falta = ['validarDoc', 'aplanar', 'hashItems', 'registros', 'versionDe'].filter((n) => typeof c?.[n] !== 'function');
  if (falta.length || !c) throw new Error(`Currículo compartido: EDU.curriculoSemilla cambió de forma (faltan: ${falta.join(', ')}).`);
  const j = (x: unknown): unknown => JSON.parse(JSON.stringify(x));
  return {
    validarDoc: (doc) => aPlano<string[]>((c.validarDoc as (d: unknown) => unknown)(j(doc))),
    aplanar: (doc) => aPlano<Json[]>((c.aplanar as (d: unknown) => unknown)(j(doc))),
    hashItems: (items) => String((c.hashItems as (i: unknown) => unknown)(j(items))),
    registros: (doc, centroId, versionId) => aPlano<Json[]>((c.registros as (...a: unknown[]) => unknown)(j(doc), centroId, versionId)),
    versionDe: (doc, items, extra) => aPlano<Json>((c.versionDe as (...a: unknown[]) => unknown)(j(doc), j(items), j(extra))),
  };
}
export function curriculoCompartido(): CurriculoCompartido {
  instancia ??= cargar();
  return instancia;
}
