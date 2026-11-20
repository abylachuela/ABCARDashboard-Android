// Cierre y reapertura de periodos, pesos (categorías y periodos = 100 %) y reemplazo atómico de categorías.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';
import { conContexto } from '../src/db/contexto.js';
import { poolApp } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
const MOTIVO = { 'x-edu-motivo': encodeURIComponent('El director autoriza la corrección') };
type Err = { error: { codigo: string; mensaje: string; campos?: string[]; suma?: number; diferencia?: number; informe?: Informe } };
type Informe = { periodoId: string; modelo: string; pendientes: number; cargasSinActividades: number; requiereConfirmacion: boolean; cerrado: boolean; pesosPeriodos: { suma: number; ok: boolean }; bloqueos: { codigo: string; cargaId?: string }[]; cargas: { cargaId: string; pendientes: number; sinActividades: boolean; pesosCategorias: { suma: number; ok: boolean } }[] };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
const periodo = async (id: string) => {
  const p = (await pedir(app, S('dirA'), 'GET', `/c/periodos/${id}`)).json() as { cerrado?: boolean };
  return { cerrado: !!p.cerrado };
};
const auditoria = async (q: string) => ((await pedir(app, S('dirA'), 'GET', `/auditoria?limite=500${q}`)).json() as { datos: Record<string, unknown>[] }).datos;

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'prueba' }, (tx) => tx.query(`UPDATE cargas SET datos = datos || '{"anioId":"an1"}'::jsonb WHERE id IN ('cg1','cg2')`));
  await sembrar('periodos', 'pr1', A, { anioId: 'an1', orden: 1, nombre: 'Periodo 1', peso: 50 });
  await sembrar('periodos', 'pr2', A, { anioId: 'an1', orden: 2, nombre: 'Periodo 2', peso: 50 });
  await sembrar('actividades', 'aA', A, { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr1', nombre: 'Examen', puntosMax: 10 });
  await sembrar('calificaciones', 'cA1', A, { actividadId: 'aA', estudianteId: 'e1', puntos: 8 });
  await sembrar('estudiantes', 'e3', A, { nombres: 'Est Tres' });
  await sembrar('matriculas', 'm3', A, { estudianteId: 'e3', seccionId: 's1', estado: 'activa' });
  // Centro B: todo en orden y sin pendientes
  await sembrar('anios', 'anB', B, { nombre: '2026' });
  await sembrar('cargas', 'cgB2', B, { docenteId: 'dB', seccionId: 'sB', anioId: 'anB' });
  await sembrar('periodos', 'prB1', B, { anioId: 'anB', orden: 1, nombre: 'P1', peso: 50 });
  await sembrar('periodos', 'prB2', B, { anioId: 'anB', orden: 2, nombre: 'P2', peso: 50 });
  await sembrar('categorias', 'catB', B, { cargaId: 'cgB2', nombre: 'Todo', peso: 100 });
  await sembrar('actividades', 'aB', B, { cargaId: 'cgB2', categoriaId: 'catB', periodoId: 'prB1', nombre: 'Act', puntosMax: 10 });
  await sembrar('calificaciones', 'cB1', B, { actividadId: 'aB', estudianteId: 'eB', puntos: 9 });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('permisos del cierre', () => {
  it('solo director y admin_red cierran, reabren y ven el informe; docente, secretaría, tutor y estudiante 403', async () => {
    for (const k of ['docA1', 'secA', 'tutA', 'estA1']) {
      expect((await pedir(app, S(k), 'POST', '/periodos/pr1/cerrar', {})).statusCode, k).toBe(403);
      expect((await pedir(app, S(k), 'POST', '/periodos/pr1/reabrir', { motivo: 'no puedo hacerlo' })).statusCode, k).toBe(403);
      expect((await pedir(app, S(k), 'GET', '/periodos/pr1/informe-cierre')).statusCode, k).toBe(403);
    }
    expect((await pedir(app, null, 'GET', '/periodos/pr1/informe-cierre')).statusCode).toBe(401);
  });

  it('otro centro → 404 (no revela el periodo); periodo inexistente → 404; id raro → 404', async () => {
    expect((await pedir(app, S('dirB'), 'POST', '/periodos/pr1/cerrar', {})).statusCode).toBe(404);
    expect((await pedir(app, S('dirB'), 'GET', '/periodos/pr1/informe-cierre')).statusCode).toBe(404);
    expect((await pedir(app, S('dirA'), 'POST', '/periodos/nada/cerrar', {})).statusCode).toBe(404);
    expect((await pedir(app, S('dirA'), 'POST', '/periodos/a%20b;c/cerrar', {})).statusCode).toBe(404);
  });
});

describe('informe de pendientes y confirmación', () => {
  it('el informe cuenta notas pendientes, asignaturas sin actividades y pesos', async () => {
    const i = (await pedir(app, S('dirA'), 'GET', '/periodos/pr1/informe-cierre')).json() as Informe;
    expect(i).toMatchObject({ periodoId: 'pr1', modelo: 'ponderado', cerrado: false, pendientes: 1, cargasSinActividades: 1, requiereConfirmacion: true, pesosPeriodos: { suma: 100, ok: true }, bloqueos: [] });
    const cg1 = i.cargas.find((c) => c.cargaId === 'cg1')!;
    expect(cg1).toMatchObject({ pendientes: 1, sinActividades: false, pesosCategorias: { suma: 100, ok: true } }); // e3 sin nota en «Examen»
    expect(i.cargas.find((c) => c.cargaId === 'cg2')).toMatchObject({ sinActividades: true });
  });

  it('con pendientes, cerrar sin confirmar → 409 confirmacion_requerida con el informe; no se cierra', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', {});
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('confirmacion_requerida');
    expect(err(r).informe).toMatchObject({ pendientes: 1 });
    expect((await periodo('pr1')).cerrado).toBe(false);
    expect((await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { confirmar: 'si' })).statusCode).toBe(422); // tipo estricto
    expect((await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { otra: 1 })).statusCode).toBe(422);
  });

  it('pesos de categorías ≠ 100 (estado transitorio permitido por /c) → el periodo NO se puede cerrar, ni con confirmar', async () => {
    expect((await pedir(app, S('docA2'), 'PUT', '/c/categorias/cat2', { cargaId: 'cg2', nombre: 'Tareas', peso: 60 })).statusCode).toBe(200);
    const r = await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { confirmar: true });
    expect(r.statusCode).toBe(422);
    expect(err(r).codigo).toBe('pesos_invalidos');
    expect(err(r).informe?.bloqueos).toEqual([expect.objectContaining({ codigo: 'pesos_categorias', cargaId: 'cg2' })]);
    expect((await periodo('pr1')).cerrado).toBe(false);
    expect((await pedir(app, S('docA2'), 'PUT', '/c/categorias/cat2', { cargaId: 'cg2', nombre: 'Tareas', peso: 100 })).statusCode).toBe(200);
  });

  it('pesos de periodos del año ≠ 100 → bloquea el cierre', async () => {
    expect((await pedir(app, S('dirA'), 'PUT', '/c/periodos/pr2', { anioId: 'an1', orden: 2, nombre: 'Periodo 2', peso: 40 })).statusCode).toBe(200);
    const r = await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { confirmar: true });
    expect(r.statusCode).toBe(422);
    expect(err(r).informe?.bloqueos[0]).toMatchObject({ codigo: 'pesos_periodos' });
    expect(err(r).informe?.pesosPeriodos).toEqual({ suma: 90, ok: false });
    expect((await pedir(app, S('dirA'), 'PUT', '/c/periodos/pr2', { anioId: 'an1', orden: 2, nombre: 'Periodo 2', peso: 50 })).statusCode).toBe(200);
  });
});

describe('cierre y reapertura', () => {
  it('cerrar con confirmación: queda cerrado, el docente es rechazado y se audita (usuario, rol, pendientes)', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { confirmar: true });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { periodo: { cerrado: boolean; cerradoPor: string; cerradoEn: string; cerradoPendientes: number }; informe: Informe };
    expect(b.periodo).toMatchObject({ cerrado: true, cerradoPor: S('dirA').id, cerradoPendientes: 1 });
    expect(Number.isNaN(Date.parse(b.periodo.cerradoEn))).toBe(false);
    expect(b.informe.pendientes).toBe(1);
    expect(err(await pedir(app, S('dirA'), 'POST', '/periodos/pr1/cerrar', { confirmar: true })).codigo).toBe('periodo_ya_cerrado');
    expect(err(await pedir(app, S('docA1'), 'PUT', '/c/calificaciones/cA1', { actividadId: 'aA', estudianteId: 'e1', puntos: 9 })).codigo).toBe('periodo_cerrado');
    const a = (await auditoria('&accion=cerrar_periodo'))[0]!;
    expect(a).toMatchObject({ coleccion: 'periodos', registroId: 'pr1', usuarioId: S('dirA').id, rol: 'director', antes: { cerrado: false }, despues: { cerrado: true }, pendientes: 1, confirmado: true });
  });

  it('con el periodo cerrado, cambiar los pesos de categorías por lote tampoco pasa (docente 409; no se aplica nada)', async () => {
    const r = await pedir(app, S('docA1'), 'POST', '/notas/categorias/lote', { cargaId: 'cg1', categorias: [{ id: 'cat1', nombre: 'Tareas', peso: 60 }, { nombre: 'Otra', peso: 40 }] });
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('periodo_cerrado');
    const cats = ((await pedir(app, S('docA1'), 'GET', '/c/categorias?f.cargaId=cg1')).json() as { datos: { peso: number }[] }).datos;
    expect(cats).toHaveLength(1);
    expect(cats[0]?.peso).toBe(100);
    const dir = await pedir(app, S('dirA'), 'POST', '/notas/categorias/lote', { cargaId: 'cg1', categorias: [{ id: 'cat1', nombre: 'Tareas', peso: 60 }, { nombre: 'Otra', peso: 40 }] }, MOTIVO);
    expect(dir.statusCode).toBe(200);
    const ok = await pedir(app, S('dirA'), 'POST', '/notas/categorias/lote', { cargaId: 'cg1', categorias: [{ id: 'cat1', nombre: 'Tareas', peso: 100 }] }, MOTIVO);
    expect(ok.statusCode).toBe(200);
  });

  it('reabrir exige motivo (5–300, en el cuerpo o en la cabecera) y solo un periodo cerrado', async () => {
    const d = S('dirA');
    expect(err(await pedir(app, d, 'POST', '/periodos/pr1/reabrir', {})).codigo).toBe('motivo_invalido');
    expect(err(await pedir(app, d, 'POST', '/periodos/pr1/reabrir', { motivo: 'abc' })).codigo).toBe('motivo_invalido');
    expect(err(await pedir(app, d, 'POST', '/periodos/pr1/reabrir', { motivo: 'x'.repeat(301) })).codigo).toBe('motivo_invalido');
    expect((await periodo('pr1')).cerrado).toBe(true);
    const r = await pedir(app, d, 'POST', '/periodos/pr1/reabrir', { motivo: 'Faltaba registrar un examen' });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { periodo: Record<string, unknown> }).periodo).toMatchObject({ cerrado: false, reabiertoPor: d.id, reabiertoMotivo: 'Faltaba registrar un examen' });
    expect((await periodo('pr1')).cerrado).toBe(false);
    expect((r.json() as { periodo: Record<string, unknown> }).periodo).not.toHaveProperty('cerradoPor');
    expect(err(await pedir(app, d, 'POST', '/periodos/pr1/reabrir', { motivo: 'Otra vez, por favor' })).codigo).toBe('periodo_no_cerrado');
    // el docente vuelve a escribir
    expect((await pedir(app, S('docA1'), 'PUT', '/c/calificaciones/cA1', { actividadId: 'aA', estudianteId: 'e1', puntos: 9 })).statusCode).toBe(200);
    const a = (await auditoria('&accion=reabrir_periodo'))[0]!;
    expect(a).toMatchObject({ registroId: 'pr1', usuarioId: d.id, rol: 'director', motivo: 'Faltaba registrar un examen', antes: { cerrado: true }, despues: { cerrado: false } });
  });

  it('motivo por cabecera X-EDU-Motivo también vale para reabrir; admin_red cierra y reabre cualquier centro', async () => {
    expect((await pedir(app, S('admin'), 'POST', '/periodos/pr2/cerrar', { confirmar: true })).statusCode).toBe(200);
    const r = await pedir(app, S('admin'), 'POST', '/periodos/pr2/reabrir', {}, MOTIVO);
    expect(r.statusCode).toBe(200);
    expect((await auditoria('&accion=reabrir_periodo&registroId=pr2'))[0]).toMatchObject({ rol: 'admin_red', motivo: 'El director autoriza la corrección' });
  });

  it('sin pendientes y con pesos válidos se cierra sin confirmar (centro B)', async () => {
    const r = await pedir(app, S('dirB'), 'POST', '/periodos/prB1/cerrar', {});
    expect(r.statusCode).toBe(200);
    expect((r.json() as { informe: Informe }).informe).toMatchObject({ pendientes: 0, requiereConfirmacion: false });
  });

  it('modelo por competencias: el informe cuenta las celdas P_i sin nota y se cierra al completarlas', async () => {
    await sembrar('escalas', 'escB', B, { min: 0, max: 100, notaMinAprobar: 70, decimales: 1, activa: true, modelo: 'competencias' });
    const i = (await pedir(app, S('dirB'), 'GET', '/periodos/prB2/informe-cierre')).json() as Informe;
    expect(i).toMatchObject({ modelo: 'competencias', pendientes: 4, requiereConfirmacion: true }); // 4 competencias × 1 estudiante, P2
    expect(i.bloqueos).toEqual([]); // los pesos de categorías no aplican al modelo por competencias
    expect(err(await pedir(app, S('dirB'), 'POST', '/periodos/prB2/cerrar', {})).codigo).toBe('confirmacion_requerida');
    const comp = { p: [null, 80, null, null] };
    expect((await pedir(app, S('docB'), 'POST', '/c/notasCompetencia', { id: 'ncB', cargaId: 'cgB2', estudianteId: 'eB', c: [comp, comp, comp, comp] })).statusCode).toBe(201);
    expect((await pedir(app, S('dirB'), 'POST', '/periodos/prB2/cerrar', {})).statusCode).toBe(200);
    // P2 cerrado: el docente ya no cambia la celda P2, sí P3
    const mod = (p: (number | null)[]) => pedir(app, S('docB'), 'PUT', '/c/notasCompetencia/ncB', { cargaId: 'cgB2', estudianteId: 'eB', c: [{ p }, comp, comp, comp] });
    expect(err(await mod([null, 99, null, null])).codigo).toBe('periodo_cerrado');
    // (prB1 también está cerrado: P1 tampoco)
    expect(err(await mod([70, 80, null, null])).codigo).toBe('periodo_cerrado');
    expect((await mod([null, 80, 75, null])).statusCode).toBe(200);
  });
});

describe('POST /notas/categorias/lote: reemplazo atómico con pesos = 100', () => {
  const lote = (ses: string, cuerpo: unknown, h: Record<string, string> = {}) => pedir(app, S(ses), 'POST', '/notas/categorias/lote', cuerpo, h);
  const cats = async (carga: string) => ((await pedir(app, S('dirA'), 'GET', `/c/categorias?f.cargaId=${carga}&orden=nombre`)).json() as { datos: { id: string; nombre: string; peso: number; centroId: string }[] }).datos;

  it('suma ≠ 100 → 422 pesos_invalidos (con suma y diferencia) y no se toca nada', async () => {
    const r = await lote('docA2', { cargaId: 'cg2', categorias: [{ nombre: 'Tareas', peso: 60 }, { nombre: 'Exámenes', peso: 30 }] });
    expect(r.statusCode).toBe(422);
    expect(err(r)).toMatchObject({ codigo: 'pesos_invalidos', suma: 90, diferencia: 10 });
    expect(err(r).mensaje).toMatch(/90 %.*100 %/);
    expect(await cats('cg2')).toHaveLength(1);
  });

  it('suma = 100: crea, renombra y quita en una transacción; el centro lo fija el servidor', async () => {
    const r = await lote('docA2', { cargaId: 'cg2', categorias: [{ id: 'cat2', nombre: 'Tareas', peso: 70 }, { nombre: 'Exámenes', peso: 30 }] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ suma: 100 });
    const l = await cats('cg2');
    expect(l.map((c) => [c.nombre, c.peso, c.centroId])).toEqual([['Exámenes', 30, A], ['Tareas', 70, A]]);
    // decimales que suman 100 con tolerancia (como el cliente): 33.33 + 33.33 + 33.34
    const t = await lote('docA2', { cargaId: 'cg2', categorias: [{ id: 'cat2', nombre: 'A', peso: 33.33 }, { id: l[0]!.id, nombre: 'B', peso: 33.33 }, { nombre: 'C', peso: 33.34 }] });
    expect(t.statusCode).toBe(200);
    const q = await lote('docA2', { cargaId: 'cg2', categorias: [{ id: 'cat2', nombre: 'Tareas', peso: 100 }] }); // quita las demás
    expect(q.statusCode).toBe(200);
    expect((await cats('cg2')).map((c) => c.nombre)).toEqual(['Tareas']);
    // quedó auditado
    expect((await auditoria('&coleccion=categorias&registroId=cat2')).length).toBeGreaterThanOrEqual(3);
  });

  it('validaciones: nombre vacío/repetido, peso inválido, más de 30, ids ajenos y categoría con actividades', async () => {
    const c = (categorias: unknown[]) => lote('docA2', { cargaId: 'cg2', categorias });
    expect(err(await c([{ nombre: ' ', peso: 100 }])).codigo).toBe('datos_invalidos');
    expect(err(await c([{ nombre: 'A', peso: 50 }, { nombre: 'a', peso: 50 }])).codigo).toBe('datos_invalidos');
    expect(err(await c([{ nombre: 'A', peso: -10 }, { nombre: 'B', peso: 110 }])).codigo).toBe('datos_invalidos');
    expect(err(await c([{ nombre: 'A', peso: '100' }])).codigo).toBe('datos_invalidos');
    expect((await c(Array.from({ length: 31 }, (_, i) => ({ nombre: `n${i}`, peso: 1 })))).statusCode).toBe(422);
    expect((await c([])).statusCode).toBe(422);
    expect(err(await c([{ id: 'catB', nombre: 'Ajena', peso: 100 }])).codigo).toBe('referencia_invalida');
    await sembrar('actividades', 'aCat', A, { cargaId: 'cg2', categoriaId: 'cat2', periodoId: 'pr2', nombre: 'Con cat', puntosMax: 5 });
    expect(err(await c([{ nombre: 'Otra', peso: 100 }])).codigo).toBe('categoria_con_actividades'); // quitaría cat2
    expect(await cats('cg2')).toHaveLength(1);
  });

  it('autorización: el docente solo su carga; secretaría/tutor/estudiante no; carga inexistente 404; otro centro 404', async () => {
    const cuerpo = { cargaId: 'cg2', categorias: [{ id: 'cat2', nombre: 'Tareas', peso: 100 }] };
    expect((await lote('docA1', cuerpo)).statusCode).toBe(403);
    for (const k of ['secA', 'tutA', 'estA1']) expect((await lote(k, cuerpo)).statusCode, k).toBe(403);
    expect((await lote('dirA', { cargaId: 'nada', categorias: [{ nombre: 'x', peso: 100 }] })).statusCode).toBe(404);
    expect((await lote('dirA', { cargaId: 'cgB', categorias: [{ nombre: 'x', peso: 100 }] })).statusCode).toBe(404); // centro ajeno: no existe para él
    expect((await lote('dirA', cuerpo)).statusCode).toBe(200);
  });
});
