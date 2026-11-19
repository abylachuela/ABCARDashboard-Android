// Paridad del cálculo: el servidor usa js/core/calculo.js y escala.js SIN copiarlos (calculo-shim). Aquí se
//  (1) portan los 28 casos de tests/calculo.test.html y se ejecutan contra el shim y contra el cliente cargado aparte;
//  (2) comparan miles de casos generados con semilla fija: servidor == cliente, y ambos == un oráculo independiente
//      escrito en esta prueba (no comparte código con calculo.js) para ambos modelos y las dos escalas;
//  (3) comprueba que el shim falla cerrado si el cliente cambia de forma.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { calculo, normalizar } from '../src/domain/calculo-shim.js';
import { cargarEduCliente, prng, RAIZ_JS, type EduCliente } from './helpers/cliente-edu.js';

const shim = calculo();
const cliente = cargarEduCliente();

const eq = (a: unknown, b: unknown): void => expect(a).toEqual(b);
const cerca = (a: number | null, b: number): void => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(1e-9);
};

/** Los 26 casos que solo dependen de calculo.js/escala.js; se ejecutan contra el `EDU` del shim y contra el del cliente. */
function casosCalculo(nombre: string, EDU: EduCliente): void {
  const C = EDU.calculo;
  const E100 = EDU.escala.crear({ min: 0, max: 100, notaMinAprobar: 70 });
  const E10 = EDU.escala.crear({ min: 0, max: 10, notaMinAprobar: 7 });
  const EC = EDU.escala.crear({ min: 0, max: 100, notaMinAprobar: 70, modelo: 'competencias' });
  const comp = (p: (number | null)[], rp: (number | null)[] = [null, null, null, null]) => ({ p, rp });
  const cuatro = (p: (number | null)[], rp?: (number | null)[]) => [comp(p, rp), comp(p, rp), comp(p, rp), comp(p, rp)];
  const cats = [{ id: 'T', peso: 20 }, { id: 'P', peso: 30 }, { id: 'X', peso: 50 }];
  const acts = [
    { id: 'a1', categoriaId: 'T', periodoId: 'p1', puntosMax: 20 }, { id: 'a2', categoriaId: 'P', periodoId: 'p1', puntosMax: 100 },
    { id: 'a3', categoriaId: 'X', periodoId: 'p1', puntosMax: 100 }, { id: 'b1', categoriaId: 'T', periodoId: 'p2', puntosMax: 10 },
  ];

  describe(`tests/calculo.test.html portados · ${nombre}`, () => {
    it('redondeo half-up', () => { eq(C.redondear(2.5, 0), 3); eq(C.redondear(1.005, 2), 1.01); eq(C.redondear(72.25, 1), 72.3); eq(C.redondear(69.95, 1), 70); eq(C.redondear(null), null); });
    it('nota de actividad 0-100 y 0-10', () => { cerca(C.notaActividad(15, 20, E100), 75); cerca(C.notaActividad(15, 20, E10), 7.5); eq(C.notaActividad(null, 20, E100), null); eq(C.notaActividad('', 20, E100), null); eq(C.notaActividad(5, 0, E100), null); cerca(C.notaActividad('7,5', 10, E100), 75); });
    it('categoria = suma puntos / suma puntosMax', () => { cerca(C.notaCategoria([{ puntos: 10, puntosMax: 20 }, { puntos: 20, puntosMax: 20 }], E100), 75); });
    it('categoria excluye actividades sin nota', () => { cerca(C.notaCategoria([{ puntos: 10, puntosMax: 20 }, { puntos: null, puntosMax: 20 }], E100), 50); eq(C.notaCategoria([{ puntos: null, puntosMax: 20 }], E100), null); eq(C.notaCategoria([], E100), null); });
    it('categoria pondera por puntosMax (no promedio de notas)', () => { cerca(C.notaCategoria([{ puntos: 5, puntosMax: 10 }, { puntos: 90, puntosMax: 100 }], E100), (95 / 110) * 100); });
    it('asignatura/periodo ponderada', () => { cerca(C.notaAsignaturaPeriodo([{ nota: 80, peso: 50 }, { nota: 60, peso: 50 }]), 70); cerca(C.notaAsignaturaPeriodo([{ nota: 100, peso: 30 }, { nota: 50, peso: 70 }]), 65); });
    it('categorias sin nota no cuentan en el denominador', () => { cerca(C.notaAsignaturaPeriodo([{ nota: 80, peso: 20 }, { nota: null, peso: 80 }]), 80); eq(C.notaAsignaturaPeriodo([{ nota: null, peso: 100 }]), null); });
    it('final ponderado por periodos con nota', () => { cerca(C.notaFinal([{ nota: 90, peso: 30 }, { nota: 70, peso: 30 }, { nota: null, peso: 40 }]), 80); });
    it('borde de aprobacion exacto', () => { eq(C.aprobado(70, E100), true); eq(C.aprobado(69.999, E100), false); eq(C.aprobado(7, E10), true); eq(C.aprobado(6.99, E10), false); eq(C.aprobado(null, E100), false); eq(C.aprobado(0.7 * 100, E100), true); });
    it('aprobado compara sin redondear', () => { eq(C.aprobado(69.96, E100), false); eq(C.redondear(69.96, 1), 70); });
    it('promedio general ignora null', () => { cerca(C.promedioGeneral([80, null, 60]), 70); eq(C.promedioGeneral([null]), null); cerca(C.promedioGeneral([{ nota: 90 }, { nota: 70 }]), 80); });
    it('validarPesos suma 100', () => { eq(C.validarPesos([20, 30, 20, 30]).ok, true); const r = C.validarPesos([{ peso: 20 }, { peso: 30 }]); eq(r.ok, false); eq(r.suma, 50); eq(r.diferencia, 50); eq(C.validarPesos([33.33, 33.33, 33.34]).ok, true); });
    it('calcularPeriodo con notas faltantes', () => {
      const r = C.calcularPeriodo({ categorias: cats, actividades: acts, periodoId: 'p1', escala: E100, calificaciones: { a1: 20, a2: 50 } });
      cerca(r.nota, (100 * 20 + 50 * 30) / 50); eq(r.categorias[2].nota, null);
    });
    it('calcularPeriodo filtra por estudiante en lista', () => {
      const cal = [{ actividadId: 'a1', estudianteId: 'e1', puntos: 20 }, { actividadId: 'a1', estudianteId: 'e2', puntos: 0 }];
      cerca(C.calcularPeriodo({ categorias: cats, actividades: acts, periodoId: 'p1', escala: E100, calificaciones: cal, estudianteId: 'e1' }).nota, 100);
      cerca(C.calcularPeriodo({ categorias: cats, actividades: acts, periodoId: 'p1', escala: E100, calificaciones: cal, estudianteId: 'e2' }).nota, 0);
    });
    it('calcularPeriodo sin notas -> null', () => { eq(C.calcularPeriodo({ categorias: cats, actividades: acts, periodoId: 'p1', escala: E100, calificaciones: {} }).nota, null); });
    it('calcularFinal ponderado por periodos y aprobado', () => {
      const per = [{ id: 'p1', peso: 60 }, { id: 'p2', peso: 40 }];
      const r = C.calcularFinal({ categorias: cats, actividades: acts, escala: E100, periodos: per, calificaciones: { a1: 20, a2: 100, a3: 100, b1: 5 } });
      cerca(r.periodos[0].nota, 100); cerca(r.periodos[1].nota, 50); cerca(r.final, 80); eq(r.aprobado, true);
      const s = C.calcularFinal({ categorias: cats, actividades: acts, escala: E100, periodos: per, calificaciones: { a1: 20, a2: 100, a3: 100 } });
      cerca(s.final, 100);
    });
    it('misma logica en escala 0-10', () => {
      const o = { categorias: [{ id: 'T', peso: 100 }], actividades: [{ id: 'x', categoriaId: 'T', periodoId: 'p1', puntosMax: 20 }], escala: E10, periodos: [{ id: 'p1', peso: 100 }] };
      const r = C.calcularFinal({ ...o, calificaciones: { x: 14 } }); cerca(r.final, 7); eq(r.aprobado, true);
      eq(C.calcularFinal({ ...o, calificaciones: { x: 13.9 } }).aprobado, false);
    });
    it('escala: porcentaje, convertir y tramo', () => {
      cerca(EDU.escala.porcentaje(7.5, E10), 75); cerca(EDU.escala.convertir(7.5, E10, E100), 75); eq(EDU.escala.tramo(95, E100).letra, 'A'); eq(EDU.escala.tramo(69, E100).letra, 'D'); eq(EDU.escala.tramo(null, E100), null);
      eq(EDU.escala.validar({ min: 0, max: 100, notaMinAprobar: 120 }).ok, false);
    });
    it('competencias: modelo() y configuracion por defecto', () => {
      eq(C.modelo(EC), 'competencias'); eq(C.modelo(E100), 'ponderado'); eq(C.modelo(null), 'ponderado');
      const c = C.configCompetencias(EC); eq(c.competencias, 4); eq(c.periodos, 4); eq(c.regla, 'reemplaza'); eq(c.completiva.cf, 50); eq(c.extraordinaria.cex, 70);
    });
    it('competencias: efectivo del periodo (RP reemplaza / maximo)', () => {
      eq(C.efectivoPeriodo(80, 90, EC, 'reemplaza'), 80); eq(C.efectivoPeriodo(60, 75, EC, 'reemplaza'), 75); eq(C.efectivoPeriodo(60, 55, EC, 'reemplaza'), 55);
      eq(C.efectivoPeriodo(60, 55, EC, 'maximo'), 60); eq(C.efectivoPeriodo(60, 75, EC, 'maximo'), 75); eq(C.efectivoPeriodo(60, null, EC), 60);
      eq(C.efectivoPeriodo(70, 90, EC), 70); eq(C.efectivoPeriodo(null, null, EC), null); eq(C.efectivoPeriodo(null, 72, EC), 72);
    });
    it('competencias: promedio y CF (media de 4 competencias)', () => {
      const r = C.calcularCompetencias({ escala: EC, competencias: [comp([80, 90, 70, 100]), comp([60, 70, 80, 90], [75, null, null, null]), comp([100, 100, 100, 100]), comp([50, 60, 70, 80], [70, 70, null, null])] });
      cerca(r.competencias[0].promedio, 85); cerca(r.competencias[1].promedio, (75 + 70 + 80 + 90) / 4); cerca(r.competencias[3].promedio, (70 + 70 + 70 + 80) / 4);
      cerca(r.cf, (85 + 78.75 + 100 + 72.5) / 4); eq(r.completo, true); eq(r.estado, 'Aprobado'); eq(r.via, 'cf'); cerca(r.final, r.cf);
    });
    it('competencias: misma regla en todas las filas (no mezcla RP si P >= minimo)', () => {
      cerca(C.calcularCompetencias({ escala: EC, competencias: cuatro([72, 90, 85, 95], [99, 99, 99, 99]) }).cf, (72 + 90 + 85 + 95) / 4);
    });
    it('competencias: ano incompleto = Pendiente con CF provisional', () => {
      const r = C.calcularCompetencias({ escala: EC, competencias: cuatro([50, 60, null, null]) });
      eq(r.completo, false); eq(r.estado, 'Pendiente'); eq(r.aprobado, null); cerca(r.cf, 55);
      eq(C.calcularCompetencias({ escala: EC, competencias: cuatro([null, null, null, null]) }).cf, null);
    });
    it('competencias: completiva 50/50, extraordinaria 30/70 y especial', () => {
      const base = cuatro([60, 60, 60, 60]);
      let r = C.calcularCompetencias({ escala: EC, competencias: base }); eq(r.estado, 'Completiva'); eq(r.aprobado, false);
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 90 }); cerca(r.cfc, 75); eq(r.estado, 'Aprobado'); eq(r.via, 'completiva'); cerca(r.final, 75);
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 70 }); cerca(r.cfc, 65); eq(r.estado, 'Extraordinaria');
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 70, cex: 85 }); cerca(r.cexf, 0.3 * 60 + 0.7 * 85); eq(r.estado, 'Aprobado'); eq(r.via, 'extraordinaria');
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 70, cex: 60 }); cerca(r.cexf, 60); eq(r.estado, 'Reprobado');
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 70, cex: 60, esp: 75 }); eq(r.estado, 'Aprobado'); eq(r.via, 'especial'); cerca(r.final, 75);
      r = C.calcularCompetencias({ escala: EC, competencias: base, cec: 70, cex: 60, esp: 50 }); eq(r.estado, 'Reprobado');
    });
    it('competencias: borde 70 exacto y pesos configurables por centro', () => {
      eq(C.calcularCompetencias({ escala: EC, competencias: cuatro([70, 70, 70, 70]) }).estado, 'Aprobado');
      eq(C.calcularCompetencias({ escala: EC, competencias: cuatro([69.99, 70, 70, 70]) }).estado, 'Completiva');
      const E2 = EDU.escala.crear({ min: 0, max: 100, notaMinAprobar: 70, modelo: 'competencias', competencias: { regla: 'maximo', completiva: { cf: 40, cec: 60 } } });
      const r = C.calcularCompetencias({ escala: E2, competencias: cuatro([60, 60, 60, 60], [55, 55, 55, 55]), cec: 90 }); cerca(r.cf, 60); cerca(r.cfc, 0.4 * 60 + 0.6 * 90);
    });
    it('competencias: media por periodo para el boletin', () => {
      const r = C.calcularCompetencias({ escala: EC, competencias: cuatro([80, 90, null, null]) }); cerca(r.periodos[0], 80); cerca(r.periodos[1], 90); eq(r.periodos[2], null);
    });
  });
}

casosCalculo('servidor (shim)', shim.edu as EduCliente);
casosCalculo('cliente (vm propio)', cliente);

describe('tests/calculo.test.html portados · presentación (solo cliente)', () => {
  it('formato nota redondea solo al presentar', () => {
    const E100 = cliente.escala.crear({ min: 0, max: 100, notaMinAprobar: 70 });
    eq(cliente.fmt.nota(72.25, E100), '72.3'); eq(cliente.fmt.nota(null, E100), '—');
  });
  it('EDU.esc escapa HTML', () => { eq(cliente.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;'); });
});

// ------------------------------------------------------------------------------------------- oráculo independiente
const EPS = 1e-9;
const media = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
function oraculoPonderado(o: { cats: { id: string; peso: number }[]; acts: { id: string; cat: string; per: string; max: number }[]; pts: Record<string, number | null>; pers: { id: string; peso: number }[]; esc: { min: number; max: number; minA: number } }): { final: number | null; aprobado: boolean | null; periodos: (number | null)[] } {
  const periodos = o.pers.map((p) => {
    let s = 0;
    let w = 0;
    for (const c of o.cats) {
      let sp = 0;
      let sm = 0;
      for (const a of o.acts) {
        if (a.cat !== c.id || a.per !== p.id) continue;
        const v = o.pts[a.id];
        if (v === null || v === undefined || a.max <= 0) continue;
        sp += Math.max(0, v);
        sm += a.max;
      }
      if (sm > 0 && c.peso > 0) {
        s += (o.esc.min + (sp / sm) * (o.esc.max - o.esc.min)) * c.peso;
        w += c.peso;
      }
    }
    return w > 0 ? s / w : null;
  });
  let s = 0;
  let w = 0;
  o.pers.forEach((p, i) => {
    const n = periodos[i] as number | null;
    if (n !== null && p.peso > 0) { s += n * p.peso; w += p.peso; }
  });
  const final = w > 0 ? s / w : null;
  return { final, aprobado: final === null ? null : final >= o.esc.minA - EPS, periodos };
}

function oraculoCompetencias(o: { comps: { p: (number | null)[]; rp: (number | null)[] }[]; cec: number | null; cex: number | null; esp: number | null; minA: number; regla: 'reemplaza' | 'maximo'; cfg: { cf1: number; cec: number; cf2: number; cex: number; ce: number } }) {
  const ef = (p: number | null, r: number | null): number | null => {
    if (p === null) return r;
    if (p >= o.minA - EPS || r === null) return p;
    return o.regla === 'maximo' ? Math.max(p, r) : r;
  };
  const efect = o.comps.map((c) => [0, 1, 2, 3].map((i) => ef(c.p[i] ?? null, c.rp[i] ?? null)));
  const proms = efect.map((e) => media(e));
  const completo = efect.every((e) => e.every((v) => v !== null));
  const cf = media(proms);
  const mix = (a: number, wa: number, b: number, wb: number) => ((a * wa + b * wb) / (wa + wb));
  let estado = 'Pendiente';
  let final = cf;
  let aprobado: boolean | null = null;
  if (cf === null) return { cf, final, estado, aprobado, completo, cfc: null as number | null, cexf: null as number | null };
  let cfc: number | null = null;
  let cexf: number | null = null;
  if (!completo) return { cf, final, estado, aprobado, completo, cfc, cexf };
  if (cf >= o.minA - EPS) return { cf, final, estado: 'Aprobado', aprobado: true, completo, cfc, cexf };
  aprobado = false; estado = 'Completiva';
  if (o.cec === null) return { cf, final, estado, aprobado, completo, cfc, cexf };
  cfc = mix(cf, o.cfg.cf1, o.cec, o.cfg.cec); final = cfc;
  if (cfc >= o.minA - EPS) return { cf, final, estado: 'Aprobado', aprobado: true, completo, cfc, cexf };
  estado = 'Extraordinaria';
  if (o.cex === null) return { cf, final, estado, aprobado, completo, cfc, cexf };
  cexf = mix(cf, o.cfg.cf2, o.cex, o.cfg.cex); final = cexf;
  if (cexf >= o.minA - EPS) return { cf, final, estado: 'Aprobado', aprobado: true, completo, cfc, cexf };
  if (o.esp !== null) {
    final = (o.esp * o.cfg.ce) / 100;
    if (final >= o.minA - EPS) return { cf, final, estado: 'Aprobado', aprobado: true, completo, cfc, cexf };
  }
  return { cf, final, estado: 'Reprobado', aprobado, completo, cfc, cexf };
}

describe('equivalencia sobre casos generados (semilla fija): servidor == cliente == oráculo', () => {
  const ESCALAS = [{ min: 0, max: 100, notaMinAprobar: 70 }, { min: 0, max: 10, notaMinAprobar: 7 }, { min: 0, max: 100, notaMinAprobar: 60 }];
  // valores de borde frecuentes: justo en el mínimo, justo debajo, extremos y decimales sin redondear
  const bordes = (e: { min: number; max: number; notaMinAprobar: number }): number[] => [e.min, e.max, e.notaMinAprobar, e.notaMinAprobar - 0.0001, e.notaMinAprobar + 0.0001, e.notaMinAprobar - 1e-10, (e.max - e.min) / 3 + e.min];

  it('ponderado: 3000 casos (notas faltantes, escalas 0-10/0-100, bordes de nota mínima)', () => {
    const r = prng(20260101);
    const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    let aprobados = 0;
    let nulos = 0;
    for (let k = 0; k < 3000; k++) {
      const esc = { ...(ESCALAS[entre(0, ESCALAS.length - 1)] as (typeof ESCALAS)[number]), decimales: 1 };
      const nCat = entre(1, 5);
      const pesosC = Array.from({ length: nCat }, () => entre(1, 40));
      const cats = pesosC.map((peso, i) => ({ id: `c${i}`, peso }));
      const nPer = entre(1, 4);
      const pers = Array.from({ length: nPer }, (_, i) => ({ id: `p${i}`, peso: entre(10, 40) }));
      const acts: { id: string; cat: string; per: string; max: number }[] = [];
      const nAct = entre(0, 12);
      for (let i = 0; i < nAct; i++) acts.push({ id: `a${i}`, cat: `c${entre(0, nCat - 1)}`, per: `p${entre(0, nPer - 1)}`, max: [5, 10, 20, 25, 50, 100, 0, 33.3][entre(0, 7)] as number });
      const pts: Record<string, number | null> = {};
      for (const a of acts) {
        const dado = r();
        pts[a.id] = dado < 0.2 ? null : dado < 0.3 ? a.max : dado < 0.4 ? 0 : dado < 0.5 ? (bordes(esc)[entre(0, 6)] as number) / (esc.max - esc.min) * a.max : Math.round(r() * a.max * 100) / 100;
      }
      const entrada = {
        categorias: cats, escala: esc, periodos: pers,
        actividades: acts.map((a) => ({ id: a.id, categoriaId: a.cat, periodoId: a.per, puntosMax: a.max })),
        calificaciones: pts,
      };
      const srv = normalizar<{ final: number | null; aprobado: boolean | null; periodos: { nota: number | null }[] }>(shim.calcularFinal(entrada));
      const cli = normalizar<typeof srv>(cliente.calculo.calcularFinal(entrada));
      expect(srv).toEqual(cli); // idénticos bit a bit (mismo código)
      const o = oraculoPonderado({ cats, acts, pts, pers, esc: { min: esc.min, max: esc.max, minA: esc.notaMinAprobar } });
      if (o.final === null) { expect(srv.final).toBeNull(); nulos++; } else { expect(Math.abs((srv.final as number) - o.final)).toBeLessThan(1e-9); aprobados += o.aprobado ? 1 : 0; }
      expect(srv.aprobado).toBe(o.aprobado);
      srv.periodos.forEach((p, i) => { const e = o.periodos[i] as number | null; if (e === null) expect(p.nota).toBeNull(); else expect(Math.abs((p.nota as number) - e)).toBeLessThan(1e-9); });
    }
    expect(aprobados).toBeGreaterThan(300); // el generador toca ambos lados del borde
    expect(nulos).toBeGreaterThan(20);
  });

  it('competencias: 3000 casos (RP, CF, completiva 50/50, extraordinaria 30/70, especial, estado)', () => {
    const r = prng(777);
    const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const estados = new Map<string, number>();
    for (let k = 0; k < 3000; k++) {
      const e0 = ESCALAS[entre(0, ESCALAS.length - 1)] as (typeof ESCALAS)[number];
      const regla = r() < 0.5 ? 'reemplaza' : 'maximo';
      const cfgPesos = r() < 0.3 ? { completiva: { cf: 40, cec: 60 }, extraordinaria: { cf: 20, cex: 80 }, especial: { ce: 100 } } : undefined;
      const esc = { ...e0, decimales: 1, modelo: 'competencias', competencias: { regla, ...(cfgPesos ?? {}) } };
      const nota = (): number | null => {
        const d = r();
        if (d < 0.08) return null;
        if (d < 0.25) return bordes(e0)[entre(0, 6)] as number;
        return Math.round((e0.min + r() * (e0.max - e0.min)) * 100) / 100;
      };
      const base = r() < 0.5 ? 0 : 1; // la mitad de los casos con el año completo (todas las notas)
      const comps = Array.from({ length: 4 }, () => ({
        p: [0, 1, 2, 3].map(() => (base ? nota() ?? e0.min : nota())),
        rp: [0, 1, 2, 3].map(() => (r() < 0.4 ? nota() : null)),
      }));
      const cec = r() < 0.5 ? nota() : null;
      const cex = r() < 0.4 ? nota() : null;
      const esp = r() < 0.3 ? nota() : null;
      const entrada = { competencias: comps, cec, cex, esp, escala: esc };
      const srv = normalizar<Record<string, unknown>>(shim.calcularCompetencias(entrada));
      const cli = normalizar<Record<string, unknown>>(cliente.calculo.calcularCompetencias(entrada));
      expect(srv).toEqual(cli);
      const pc = (cfgPesos ?? { completiva: { cf: 50, cec: 50 }, extraordinaria: { cf: 30, cex: 70 }, especial: { ce: 100 } });
      const o = oraculoCompetencias({ comps, cec, cex, esp, minA: e0.notaMinAprobar, regla, cfg: { cf1: pc.completiva.cf, cec: pc.completiva.cec, cf2: pc.extraordinaria.cf, cex: pc.extraordinaria.cex, ce: pc.especial.ce } });
      const num = (x: unknown) => (x === null ? null : (x as number));
      for (const [k2, v] of [['cf', o.cf], ['final', o.final], ['cfc', o.cfc], ['cexf', o.cexf]] as const) {
        const got = num(srv[k2]);
        if (v === null) expect(got, k2).toBeNull(); else expect(Math.abs((got as number) - v), k2).toBeLessThan(1e-9);
      }
      expect(srv.estado).toBe(o.estado);
      expect(srv.aprobado).toBe(o.aprobado);
      expect(srv.completo).toBe(o.completo);
      estados.set(o.estado, (estados.get(o.estado) ?? 0) + 1);
    }
    for (const est of ['Aprobado', 'Reprobado', 'Completiva', 'Extraordinaria', 'Pendiente']) expect(estados.get(est) ?? 0, est).toBeGreaterThan(10);
  });

  it('resumenNotas del shim == resumenNotas del cliente (ambos modelos, sin redondear al guardar)', () => {
    const r = prng(99);
    const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    for (let k = 0; k < 200; k++) {
      const modelo = r() < 0.5 ? 'competencias' : 'ponderado';
      const e0 = ESCALAS[entre(0, 1)] as (typeof ESCALAS)[number];
      const escalas = [{ id: 'e', centroId: 'c', activa: true, ...e0, decimales: 1, modelo }];
      const periodos = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, centroId: 'c', anioId: 'an', orden: i, peso: 25 }));
      const cargas = [{ id: 'cg1', centroId: 'c', seccionId: 's', asignaturaId: 'as', docenteId: 'd', anioId: 'an' }];
      const matriculas = Array.from({ length: entre(1, 6) }, (_, i) => ({ id: `m${i}`, centroId: 'c', seccionId: 's', estudianteId: `e${i}`, estado: r() < 0.9 ? 'activa' : 'retirada' }));
      const categorias = [{ id: 'k1', centroId: 'c', cargaId: 'cg1', peso: 40 }, { id: 'k2', centroId: 'c', cargaId: 'cg1', peso: 60 }];
      const actividades = Array.from({ length: entre(1, 8) }, (_, i) => ({ id: `a${i}`, centroId: 'c', cargaId: 'cg1', categoriaId: `k${entre(1, 2)}`, periodoId: `p${entre(1, 4)}`, puntosMax: entre(5, 50) }));
      const calificaciones = matriculas.flatMap((m) => actividades.map((a) => ({ id: `${a.id}${m.id}`, actividadId: a.id, estudianteId: m.estudianteId, puntos: r() < 0.2 ? null : Math.round(r() * a.puntosMax * 10) / 10 })));
      const notasCompetencia = matriculas.map((m) => ({ id: `nc${m.id}`, cargaId: 'cg1', estudianteId: m.estudianteId, c: Array.from({ length: 4 }, () => ({ p: [0, 1, 2, 3].map(() => (r() < 0.2 ? null : entre(40, 100))), rp: [null, null, null, null] })), cec: r() < 0.3 ? entre(40, 100) : null, cex: null, esp: null }));
      const d = { matriculas, cargas, categorias, actividades, calificaciones, notasCompetencia, periodos, escalas };
      expect(normalizar(shim.resumenNotas(d))).toEqual(normalizar(cliente.consultas.resumenNotas(d)));
    }
  });
});

describe('el shim falla cerrado y no copia el código del cliente', () => {
  it('carga los mismos archivos que el cliente (huellas SHA-256 del propio js/)', async () => {
    const { createHash } = await import('node:crypto');
    for (const [f, h] of Object.entries(shim.huellas)) {
      expect(createHash('sha256').update(await readFile(path.join(RAIZ_JS, f), 'utf8')).digest('hex')).toBe(h);
    }
    expect(Object.keys(shim.huellas)).toEqual(['core/escala.js', 'core/calculo.js', 'data/consultas.js']);
  });

  it('si calculo.js cambia de forma (falta una función) o de reglas (canarios), el módulo se niega a cargar', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-js-'));
    await cp(RAIZ_JS, dir, { recursive: true });
    const lanzar = () => execFileSync('node', ['--import', 'tsx', '-e', "import('./src/domain/calculo-shim.ts').then(m => { m.calculo(); console.log('CARGADO'); }).catch(e => { console.log('ERROR:' + e.message); })"], { env: { ...process.env, EDU_JS_DIR: dir }, encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') }).trim();
    expect(lanzar()).toBe('CARGADO'); // copia intacta: carga
    const f = path.join(dir, 'core/calculo.js');
    const original = await readFile(f, 'utf8');
    await writeFile(f, original.replace('promedioGeneral: promedioGeneral,', ''));
    expect(lanzar()).toMatch(/^ERROR:.*cambió de forma.*promedioGeneral/);
    await writeFile(f, original.replace('return n !== null && n >= e.notaMinAprobar - EPS;', 'return n !== null && n > e.notaMinAprobar;'));
    expect(lanzar()).toMatch(/^ERROR:.*canarios/);
    await writeFile(f, original);
    expect(lanzar()).toBe('CARGADO');
  });

  it('el cálculo no se redondea al guardar: 69.96 sigue siendo 69.96 y reprueba', () => {
    const esc = { min: 0, max: 100, notaMinAprobar: 70 };
    expect(shim.aprobado(69.96, esc)).toBe(false);
    expect(shim.redondear(69.96, 1)).toBe(70);
  });
});
