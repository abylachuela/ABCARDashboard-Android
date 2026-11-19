// Reglas de negocio de las notas en el servidor: periodo cerrado por rol, motivo del director, rangos, campos calculados,
// propiedad/centro, lotes por fila y UNIQUE bajo concurrencia.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conContexto } from '../src/db/contexto.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, montarMundo, pedir, poolApp, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
const MOTIVO = { 'x-edu-motivo': encodeURIComponent('Corrección por error de digitación') };
type Err = { error: { codigo: string; mensaje: string; campos?: string[]; rechazadas?: { indice: number; codigo: string }[] } };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
const cuerpoCal = (extra: Record<string, unknown> = {}) => ({ actividadId: 'actC', estudianteId: 'e1', puntos: 15, ...extra });

async function admin<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  return conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'prueba' }, (tx) => fn(async (sql, p) => (await tx.query(sql, p)).rows));
}
async function auditoria(filtro = ''): Promise<{ accion: string; usuarioId: string; rol: string; registroId: string; motivo?: string }[]> {
  const r = await pedir(app, S('dirA'), 'GET', `/auditoria?limite=500${filtro}`);
  return (r.json() as { datos: never[] }).datos;
}

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await admin(async (q) => {
    await q(`UPDATE cargas SET datos = datos || '{"anioId":"an1"}'::jsonb WHERE id IN ('cg1','cg2')`);
  });
  await sembrar('anios', 'an1', A, { nombre: '2026' });
  await sembrar('periodos', 'pr1', A, { anioId: 'an1', orden: 1, nombre: 'Periodo 1', peso: 50, cerrado: true });
  await sembrar('periodos', 'pr2', A, { anioId: 'an1', orden: 2, nombre: 'Periodo 2', peso: 50, cerrado: false });
  await sembrar('actividades', 'actC', A, { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr1', nombre: 'Examen P1', puntosMax: 20 });
  await sembrar('actividades', 'actO', A, { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr2', nombre: 'Tarea P2', puntosMax: 10 });
  await sembrar('calificaciones', 'calC', A, { actividadId: 'actC', estudianteId: 'e1', puntos: 12 });
  await sembrar('calificaciones', 'calO', A, { actividadId: 'actO', estudianteId: 'e1', puntos: 6 });
  await sembrar('escalas', 'esc_A', A, { min: 0, max: 100, notaMinAprobar: 70, decimales: 1, activa: true, modelo: 'competencias' });
  await sembrar('notas_competencia', 'nc1', A, { cargaId: 'cg1', estudianteId: 'e1', c: [{ p: [80, 85, null, null], rp: [null, null, null, null] }], cec: null, cex: null, esp: null });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('periodo cerrado: calificaciones', () => {
  it('el docente es rechazado (409 periodo_cerrado) al editar, crear y borrar en un periodo cerrado', async () => {
    const d = S('docA1');
    const e = await pedir(app, d, 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 18 }));
    expect(e.statusCode).toBe(409);
    expect(err(e)).toMatchObject({ codigo: 'periodo_cerrado' });
    expect(err(e).mensaje).toMatch(/cerrado.*Pide al director/);
    expect((await pedir(app, d, 'POST', '/c/calificaciones', cuerpoCal({ estudianteId: 'e9' }))).statusCode).toBe(409);
    expect((await pedir(app, d, 'DELETE', '/c/calificaciones/calC')).statusCode).toBe(409);
    expect((await pedir(app, d, 'GET', '/c/calificaciones/calC')).json()).toMatchObject({ puntos: 12 }); // intacta
  });

  it('el docente sí escribe en el periodo abierto; el cierre no se confía al cliente (periodoId en el cuerpo no sirve)', async () => {
    const d = S('docA1');
    expect((await pedir(app, d, 'PUT', '/c/calificaciones/calO', { actividadId: 'actO', estudianteId: 'e1', puntos: 9 })).statusCode).toBe(200);
    // intentar colar la nota en el periodo abierto cambiando el campo `periodoId` de la calificación o `cerrado` no sirve
    const trampa = await pedir(app, d, 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 20, periodoId: 'pr2', cerrado: false }));
    expect(trampa.statusCode).toBe(409);
    // y mover la actividad cerrada a un periodo abierto también se rechaza (el periodo anterior sigue cerrado)
    expect((await pedir(app, d, 'PUT', '/c/actividades/actC', { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr2', nombre: 'Examen P1', puntosMax: 20 })).statusCode).toBe(409);
  });

  it('otro docente: la propiedad se evalúa antes (403) y no revela el estado del periodo', async () => {
    expect((await pedir(app, S('docA2'), 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 1 }))).statusCode).toBe(404);
    expect((await pedir(app, S('docA2'), 'POST', '/c/calificaciones', cuerpoCal({ estudianteId: 'e7' }))).statusCode).toBe(403);
  });

  it('director sin motivo → 422 motivo_requerido; con motivo → 200 y queda auditado con el motivo', async () => {
    const dir = S('dirA');
    const sin = await pedir(app, dir, 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 19 }));
    expect(sin.statusCode).toBe(422);
    expect(err(sin)).toMatchObject({ codigo: 'motivo_requerido', campos: ['X-EDU-Motivo'] });
    const ok = await pedir(app, dir, 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 19 }), MOTIVO);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ puntos: 19 });
    const a = (await auditoria('&registroId=calC&accion=editar'))[0]!;
    expect(a).toMatchObject({ usuarioId: dir.id, rol: 'director', motivo: 'Corrección por error de digitación', periodoId: 'pr1', periodoCerrado: true });
  });

  it('motivo inválido: muy corto, muy largo, mal codificado o repetido → 422 motivo_invalido (aunque el periodo esté abierto)', async () => {
    const dir = S('dirA');
    for (const h of [encodeURIComponent('abc'), encodeURIComponent('x'.repeat(301)), '%E0%A4%A', encodeURIComponent('     ')]) {
      const r = await pedir(app, dir, 'PUT', '/c/calificaciones/calC', cuerpoCal(), { 'x-edu-motivo': h });
      expect(r.statusCode, h).toBe(422);
      expect(err(r).codigo).toBe('motivo_invalido');
    }
    const largoOk = await pedir(app, dir, 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 19 }), { 'x-edu-motivo': encodeURIComponent('y'.repeat(300)) });
    expect(largoOk.statusCode).toBe(200);
  });

  it('admin_red edita con motivo (y sin él, no); el motivo de un docente no abre el periodo', async () => {
    expect((await pedir(app, S('admin'), 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 17 }))).statusCode).toBe(422);
    expect((await pedir(app, S('admin'), 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 17 }), MOTIVO)).statusCode).toBe(200);
    const d = await pedir(app, S('docA1'), 'PUT', '/c/calificaciones/calC', cuerpoCal({ puntos: 20 }), MOTIVO);
    expect(d.statusCode).toBe(409);
    expect(err(d).codigo).toBe('periodo_cerrado');
  });

  it('secretaría, tutor y estudiante no escriben calificaciones (403), con o sin motivo', async () => {
    for (const k of ['secA', 'tutA', 'estA1']) {
      for (const h of [{}, MOTIVO]) {
        expect((await pedir(app, S(k), 'PUT', '/c/calificaciones/calC', cuerpoCal(), h)).statusCode, k).toBe(403);
        expect((await pedir(app, S(k), 'POST', '/c/calificaciones', cuerpoCal({ estudianteId: 'e5' }), h)).statusCode, k).toBe(403);
        expect((await pedir(app, S(k), 'DELETE', '/c/calificaciones/calC', undefined, h)).statusCode, k).toBe(403);
      }
    }
    expect((await pedir(app, S('estA1'), 'PUT', '/notas/calificaciones/lote', { registros: [cuerpoCal()] })).statusCode).toBe(403);
  });

  it('el director edita notas de un periodo abierto sin motivo', async () => {
    expect((await pedir(app, S('dirA'), 'PUT', '/c/calificaciones/calO', { actividadId: 'actO', estudianteId: 'e1', puntos: 8 })).statusCode).toBe(200);
  });
});

describe('periodo cerrado: actividades, categorías y notas por competencia', () => {
  it('actividades: el docente no crea, edita ni borra en periodo cerrado; el director con motivo', async () => {
    const d = S('docA1');
    const nueva = { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr1', nombre: 'Extra', puntosMax: 5 };
    expect(err(await pedir(app, d, 'POST', '/c/actividades', nueva)).codigo).toBe('periodo_cerrado');
    expect((await pedir(app, d, 'PUT', '/c/actividades/actC', { ...nueva, nombre: 'Renombrada', puntosMax: 20 })).statusCode).toBe(409);
    expect((await pedir(app, d, 'DELETE', '/c/actividades/actC')).statusCode).toBe(409);
    expect((await pedir(app, S('dirA'), 'POST', '/c/actividades', nueva)).statusCode).toBe(422);
    const c = await pedir(app, S('dirA'), 'POST', '/c/actividades', { ...nueva, id: 'actExtra' }, MOTIVO);
    expect(c.statusCode).toBe(201);
    expect((await pedir(app, S('dirA'), 'DELETE', '/c/actividades/actExtra', undefined, MOTIVO)).statusCode).toBe(204);
    const abierta = await pedir(app, d, 'POST', '/c/actividades', { ...nueva, periodoId: 'pr2', id: 'actNueva' });
    expect(abierta.statusCode).toBe(201);
  });

  it('categorías: no se cambian pesos si la carga tiene notas en un periodo cerrado (docente 409; director con motivo); renombrar sí', async () => {
    const d = S('docA1');
    expect((await pedir(app, d, 'PUT', '/c/categorias/cat1', { cargaId: 'cg1', nombre: 'Tareas', peso: 90 })).statusCode).toBe(409);
    expect((await pedir(app, d, 'DELETE', '/c/categorias/cat1')).statusCode).toBe(409);
    expect((await pedir(app, d, 'POST', '/c/categorias', { cargaId: 'cg1', nombre: 'Nueva', peso: 10 })).statusCode).toBe(409);
    expect((await pedir(app, d, 'PUT', '/c/categorias/cat1', { cargaId: 'cg1', nombre: 'Tareas y trabajos', peso: 100 })).statusCode).toBe(200);
    expect((await pedir(app, S('dirA'), 'PUT', '/c/categorias/cat1', { cargaId: 'cg1', nombre: 'Tareas y trabajos', peso: 100 }, MOTIVO)).statusCode).toBe(200);
    // una carga sin periodos cerrados puede reajustar libremente (estado transitorio permitido)
    expect((await pedir(app, S('docA2'), 'PUT', '/c/categorias/cat2', { cargaId: 'cg2', nombre: 'Tareas', peso: 60 })).statusCode).toBe(200);
    expect((await pedir(app, S('docA2'), 'PUT', '/c/categorias/cat2', { cargaId: 'cg2', nombre: 'Tareas', peso: 100 })).statusCode).toBe(200);
  });

  it('notasCompetencia: P1 (cerrado) bloqueado para el docente y la secretaría; P2 abierto editable; completiva y fases fuera de periodo', async () => {
    const base = { cargaId: 'cg1', estudianteId: 'e1', cec: null, cex: null, esp: null };
    const celda = (p: (number | null)[]) => ({ ...base, c: [{ p, rp: [null, null, null, null] }] });
    const nc = (k: string, p: (number | null)[], h: Record<string, string> = {}) => pedir(app, S(k), 'PUT', '/c/notasCompetencia/nc1', celda(p), h);
    expect(err(await nc('docA1', [90, 85, null, null])).codigo).toBe('periodo_cerrado'); // P1 cambia
    expect(err(await nc('secA', [90, 85, null, null])).codigo).toBe('periodo_cerrado');
    expect((await nc('docA1', [80, 91, null, null])).statusCode).toBe(200); // solo P2 (abierto)
    expect(err(await nc('dirA', [90, 91, null, null])).codigo).toBe('motivo_requerido');
    expect((await nc('dirA', [90, 91, null, null], MOTIVO)).statusCode).toBe(200);
    expect(err(await nc('docA1', [90, 91, 150, null])).codigo).toBe('fuera_de_rango'); // 150 > 100
    expect(err(await nc('tutA', [90, 91, null, null])).codigo).toBe('sin_permiso');
    const a = (await auditoria('&registroId=nc1&accion=editar')).find((x) => (x as { motivo?: string }).motivo);
    expect(a).toMatchObject({ rol: 'director', periodoId: 'pr1' });
    // borrar con notas en P1 cerrado: el docente no
    expect((await pedir(app, S('docA1'), 'DELETE', '/c/notasCompetencia/nc1')).statusCode).toBe(409);
  });

  it('notasCompetencia: fases solo cuando corresponden (completiva exige el año completo y CF < mínimo)', async () => {
    await sembrar('notas_competencia', 'nc2', A, { cargaId: 'cg1', estudianteId: 'e2x', c: [], cec: null, cex: null, esp: null });
    const todo = (v: number) => [0, 1, 2, 3].map(() => ({ p: [v, v, v, v], rp: [null, null, null, null] }));
    const put = (extra: Record<string, unknown>) => pedir(app, S('dirA'), 'PUT', '/c/notasCompetencia/nc2', { cargaId: 'cg1', estudianteId: 'e2x', cex: null, esp: null, ...extra }, MOTIVO);
    expect(err(await put({ c: todo(85), cec: 80 })).codigo).toBe('fase_no_valida'); // aprobó: no hay completiva
    expect(err(await put({ c: [{ p: [50, null, null, null] }], cec: 80 })).codigo).toBe('fase_no_valida'); // año incompleto
    expect((await put({ c: todo(60), cec: 80 })).statusCode).toBe(200); // 60 < 70 y año completo
    expect(err(await put({ c: todo(60), cec: 90, cex: 50 })).codigo).toBe('fase_no_valida'); // cfc = 75 ≥ 70: no hay extraordinaria
    expect((await put({ c: todo(60), cec: 70, cex: 50 })).statusCode).toBe(200);
    expect(err(await put({ c: todo(60), cec: 70, cex: 50, esp: 101 })).codigo).toBe('fuera_de_rango');
    expect((await put({ c: todo(60), cec: 70, cex: 50, esp: 80 })).statusCode).toBe(200);
    const r = (await pedir(app, S('dirA'), 'GET', '/notas/resumen?cargaId=cg1&estudianteId=e2x')).json() as { datos: unknown[] };
    expect(r.datos).toEqual([]); // e2x no tiene matrícula: el resumen solo cubre matrículas activas
  });
});

describe('rangos, tipos y campos calculados', () => {
  it('puntos entre 0 y puntosMax de la actividad; sin nota (null) permitido; tipos estrictos; sin redondear', async () => {
    const d = S('docA1');
    const nuevo = (extra: Record<string, unknown>) => pedir(app, d, 'POST', '/c/calificaciones', { actividadId: 'actO', estudianteId: 'e_r', ...extra });
    expect(err(await nuevo({ puntos: 10.01 })).codigo).toBe('fuera_de_rango');
    expect(err(await nuevo({ puntos: -0.5 })).codigo).toBe('fuera_de_rango');
    expect(err(await nuevo({ puntos: '8' })).codigo).toBe('datos_invalidos');
    expect(err(await nuevo({ puntos: 1e-12 })).codigo).toBe('datos_invalidos'); // ruido de coma flotante: > 6 decimales
    expect(err(await nuevo({ puntos: null, comentario: 5 })).codigo).toBe('datos_invalidos');
    expect(err(await pedir(app, d, 'POST', '/c/calificaciones', { actividadId: 'no_hay', estudianteId: 'x', puntos: 1 })).codigo).toBe('actividad_no_encontrada');
    const ok = await nuevo({ puntos: 7.333333, id: 'cal_r1' });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { puntos: number }).puntos).toBe(7.333333); // sin redondear
    expect((await nuevo({ puntos: 10, id: 'cal_r2', estudianteId: 'e_r2' })).statusCode).toBe(201); // borde superior exacto
    expect((await nuevo({ puntos: 0, id: 'cal_r3', estudianteId: 'e_r3' })).statusCode).toBe(201); // borde inferior
    expect((await nuevo({ puntos: null, id: 'cal_r4', estudianteId: 'e_r4' })).statusCode).toBe(201);
  });

  it('actividades: puntosMax válido, categoría de la misma carga, periodo del centro/año; no se baja bajo las notas existentes', async () => {
    const d = S('docA1');
    const base = { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr2', nombre: 'V' };
    expect(err(await pedir(app, d, 'POST', '/c/actividades', { ...base, puntosMax: 0 })).codigo).toBe('fuera_de_rango');
    expect(err(await pedir(app, d, 'POST', '/c/actividades', { ...base, puntosMax: 1001 })).codigo).toBe('fuera_de_rango');
    expect(err(await pedir(app, d, 'POST', '/c/actividades', { ...base, puntosMax: 'diez' })).codigo).toBe('fuera_de_rango');
    expect(err(await pedir(app, d, 'POST', '/c/actividades', { ...base, categoriaId: 'cat2', puntosMax: 10 })).codigo).toBe('referencia_invalida'); // categoría de otra carga
    expect(err(await pedir(app, d, 'POST', '/c/actividades', { ...base, periodoId: 'no_hay', puntosMax: 10 })).codigo).toBe('referencia_invalida');
    const r = await pedir(app, d, 'PUT', '/c/actividades/actO', { ...base, nombre: 'Tarea P2', puntosMax: 5 }); // calO tiene 8 puntos
    expect(err(r).codigo).toBe('fuera_de_rango');
    expect((await pedir(app, d, 'PUT', '/c/actividades/actO', { ...base, nombre: 'Tarea P2', puntosMax: 12 })).statusCode).toBe(200);
    expect(err(await pedir(app, d, 'PUT', '/c/actividades/actO', { cargaId: 'cg1', categoriaId: 'cat1', periodoId: 'pr2', puntosMax: 12, nombre: 'x'.repeat(201) })).codigo).toBe('datos_invalidos');
  });

  it('mass-assignment: final, estado, cf, usuarioId, rol… se ignoran; centroId ajeno → 403; el servidor fija la autoría', async () => {
    const d = S('docA1');
    const r = await pedir(app, d, 'POST', '/c/calificaciones', {
      id: 'cal_ma', actividadId: 'actO', estudianteId: 'e_ma', puntos: 5,
      final: 100, estado: 'Aprobado', cf: 99, nota: 100, aprobado: true, usuarioId: 'usr_dirA', rol: 'director', pct: 100, calc: { x: 1 },
    });
    expect(r.statusCode).toBe(201);
    const g = (await pedir(app, d, 'GET', '/c/calificaciones/cal_ma')).json() as Record<string, unknown>;
    for (const k of ['final', 'estado', 'cf', 'nota', 'aprobado', 'usuarioId', 'rol', 'pct', 'calc']) expect(g, k).not.toHaveProperty(k);
    expect(g).toMatchObject({ id: 'cal_ma', centroId: A, puntos: 5 });
    const aj = await pedir(app, d, 'POST', '/c/calificaciones', { id: 'cal_ma2', centroId: B, actividadId: 'actO', estudianteId: 'e_ma2', puntos: 5 });
    expect(aj.statusCode).toBe(403);
    expect(err(aj).codigo).toBe('centro_no_permitido');
    const nc = await pedir(app, d, 'PUT', '/c/notasCompetencia/nc1', { cargaId: 'cg1', estudianteId: 'e1', c: [{ p: [90, 91, null, null] }], final: 100, cf: 100, estado: 'Aprobado', via: 'cf' });
    expect(nc.statusCode).toBe(200);
    for (const k of ['final', 'cf', 'estado', 'via']) expect(nc.json(), k).not.toHaveProperty(k);
    const a = (await auditoria('&registroId=cal_ma'))[0]!;
    expect(a).toMatchObject({ usuarioId: d.id, rol: 'docente' }); // el servidor, no el cuerpo
  });

  it('periodos.cerrado no se cambia por el PUT/POST genérico; los campos de cierre los fija el servidor', async () => {
    const dir = S('dirA');
    expect(err(await pedir(app, dir, 'PUT', '/c/periodos/pr2', { anioId: 'an1', orden: 2, nombre: 'Periodo 2', peso: 50, cerrado: true })).codigo).toBe('campo_protegido');
    expect(err(await pedir(app, dir, 'PUT', '/c/periodos/pr1', { anioId: 'an1', orden: 1, nombre: 'Periodo 1', peso: 50, cerrado: false }, MOTIVO)).codigo).toBe('campo_protegido');
    expect(err(await pedir(app, dir, 'POST', '/c/periodos', { id: 'prX', anioId: 'an1', orden: 3, nombre: 'X', peso: 0, cerrado: true })).codigo).toBe('campo_protegido');
    const ok = await pedir(app, dir, 'PUT', '/c/periodos/pr2', { anioId: 'an1', orden: 2, nombre: 'Periodo 2 (editado)', peso: 50, cerrado: false, cerradoPor: 'usr_x', reabiertoMotivo: 'falso' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ nombre: 'Periodo 2 (editado)', cerrado: false });
    expect(ok.json()).not.toHaveProperty('cerradoPor');
    expect(ok.json()).not.toHaveProperty('reabiertoMotivo');
    expect((await pedir(app, dir, 'POST', '/c/periodos', { id: 'prNuevo', anioId: 'an1', orden: 4, nombre: 'Nuevo', peso: 0 })).statusCode).toBe(201);
    expect(err(await pedir(app, dir, 'PUT', '/c/periodos/prNuevo', { anioId: 'an1', orden: 4, nombre: 'N', peso: 120 })).codigo).toBe('fuera_de_rango');
    expect(err(await pedir(app, dir, 'PUT', '/c/periodos/prNuevo', { anioId: 'an1', orden: 4, nombre: 'N', peso: 0, inicio: '2026-09-01', fin: '2026-01-01' })).codigo).toBe('datos_invalidos');
    // editar un periodo cerrado (nombre, pesos): director con motivo
    expect(err(await pedir(app, dir, 'PUT', '/c/periodos/pr1', { anioId: 'an1', orden: 1, nombre: 'P1', peso: 50 })).codigo).toBe('motivo_requerido');
    expect((await pedir(app, dir, 'PUT', '/c/periodos/pr1', { anioId: 'an1', orden: 1, nombre: 'Periodo 1', peso: 50 }, MOTIVO)).json()).toMatchObject({ cerrado: true });
  });
});

describe('propiedad y centro', () => {
  it('el docente solo escribe notas, actividades y categorías de SUS cargas; cargaId de otro centro se rechaza', async () => {
    const d = S('docA1');
    expect((await pedir(app, d, 'POST', '/c/calificaciones', { actividadId: 'act2', estudianteId: 'e2', puntos: 1 })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/actividades', { cargaId: 'cg2', nombre: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/categorias', { cargaId: 'cgB', nombre: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'POST', '/c/actividades', { cargaId: 'cgB', nombre: 'otro centro' })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/c/calificaciones', { actividadId: 'actB', estudianteId: 'eB', puntos: 1 })).statusCode).toBe(422);
    // admin_red crea en el centro A una actividad que apunta a una carga del centro B → 422 (la carga debe ser del centro del registro)
    const x = await pedir(app, S('admin'), 'POST', '/c/actividades', { centroId: A, cargaId: 'cgB', nombre: 'cruzada' });
    expect(x.statusCode).toBe(422);
    expect(err(x).codigo).toBe('referencia_invalida');
    expect((await pedir(app, S('admin'), 'POST', '/c/calificaciones', { centroId: A, actividadId: 'actB', estudianteId: 'eB', puntos: 1 })).statusCode).toBe(422);
    expect((await pedir(app, S('docB'), 'PUT', '/c/calificaciones/calO', { actividadId: 'actO', estudianteId: 'e1', puntos: 1 })).statusCode).toBe(404);
  });

  it('actividadId/estudianteId de una calificación son inmutables al editar', async () => {
    const r = await pedir(app, S('docA1'), 'PUT', '/c/calificaciones/cal_r1', { actividadId: 'actO', estudianteId: 'otro', puntos: 1 });
    expect(r.statusCode).toBe(422);
    expect(err(r).codigo).toBe('campo_inmutable');
  });
});

describe('lote de calificaciones (PUT /notas/calificaciones/lote)', () => {
  const lote = (ses: string, registros: unknown[], extra: Record<string, unknown> = {}, h: Record<string, string> = {}) => pedir(app, S(ses), 'PUT', '/notas/calificaciones/lote', { registros, ...extra }, h);
  type Res = { atomico: boolean; total: number; aplicadas: { indice: number; id: string; registro: { puntos: number } }[]; rechazadas: { indice: number; id: string | null; codigo: string; mensaje: string }[] };

  it('no atómico: resultado por fila; aplica las válidas y rechaza el resto con su código (en español)', async () => {
    const r = await lote('docA1', [
      { actividadId: 'actO', estudianteId: 'lo1', puntos: 4.5 },
      { actividadId: 'actO', estudianteId: 'lo2', puntos: 99 }, // fuera de rango
      { actividadId: 'actC', estudianteId: 'lo3', puntos: 5 }, // periodo cerrado
      { actividadId: 'act2', estudianteId: 'lo4', puntos: 5 }, // carga ajena
      { actividadId: 'actO', estudianteId: 'lo1', puntos: 6 }, // celda repetida
      { actividadId: 'actO', puntos: 1 }, // sin estudiante
      { actividadId: 'actO', estudianteId: 'lo5', puntos: null },
      'no es objeto',
    ]);
    expect(r.statusCode).toBe(200);
    const b = r.json() as Res;
    expect(b.total).toBe(8);
    expect(b.aplicadas.map((x) => x.indice)).toEqual([0, 6]);
    expect(b.aplicadas[0]).toMatchObject({ id: 'cal_actO_lo1', registro: { puntos: 4.5 } }); // id determinista del cliente
    expect(b.rechazadas.map((x) => [x.indice, x.codigo])).toEqual([[1, 'fuera_de_rango'], [2, 'periodo_cerrado'], [3, 'sin_permiso'], [4, 'duplicado_en_lote'], [5, 'datos_invalidos'], [7, 'datos_invalidos']]);
    for (const x of b.rechazadas) expect(x.mensaje).toMatch(/[a-záéíóú]/i);
    expect((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/cal_actO_lo2')).statusCode).toBe(404);
    expect((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/cal_actO_lo1')).statusCode).toBe(200);
  });

  it('actualiza la celda existente aunque el cliente envíe otro id; id distinto sobre celda ocupada → rechazada (conflicto)', async () => {
    const b = (await lote('docA1', [{ actividadId: 'actO', estudianteId: 'e1', puntos: 7 }, { id: 'otro_id', actividadId: 'actO', estudianteId: 'lo1', puntos: 3 }])).json() as Res;
    expect(b.aplicadas[0]).toMatchObject({ id: 'calO', registro: { puntos: 7 } });
    expect(b.rechazadas[0]).toMatchObject({ indice: 1, codigo: 'conflicto' });
  });

  it('atomico:true: una fila inválida deshace TODO el lote (422 lote_invalido con las filas rechazadas)', async () => {
    const antes = ((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/calO')).json() as { puntos: number }).puntos;
    const r = await lote('docA1', [{ actividadId: 'actO', estudianteId: 'e1', puntos: 1 }, { actividadId: 'actO', estudianteId: 'at2', puntos: 500 }], { atomico: true });
    expect(r.statusCode).toBe(422);
    expect(err(r).codigo).toBe('lote_invalido');
    expect(err(r).rechazadas).toHaveLength(1);
    expect(err(r).rechazadas?.[0]).toMatchObject({ indice: 1, codigo: 'fuera_de_rango' });
    expect(((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/calO')).json() as { puntos: number }).puntos).toBe(antes);
    expect((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/cal_actO_at2')).statusCode).toBe(404);
    const ok = await lote('docA1', [{ actividadId: 'actO', estudianteId: 'at1', puntos: 2 }, { actividadId: 'actO', estudianteId: 'at2', puntos: 3 }], { atomico: true });
    expect((ok.json() as Res).aplicadas).toHaveLength(2);
  });

  it('el director edita un periodo cerrado en lote solo con motivo; todas las filas quedan auditadas con él', async () => {
    const reg = [{ actividadId: 'actC', estudianteId: 'e1', puntos: 11 }, { actividadId: 'actC', estudianteId: 'lc2', puntos: 12 }];
    expect(((await lote('dirA', reg)).json() as Res).rechazadas.map((x) => x.codigo)).toEqual(['motivo_requerido', 'motivo_requerido']);
    const ok = (await lote('dirA', reg, {}, MOTIVO)).json() as Res;
    expect(ok.aplicadas).toHaveLength(2);
    const aud = (await auditoria('&coleccion=calificaciones')).filter((a) => a.registroId === 'calC' || a.registroId === 'cal_actC_lc2');
    expect(aud.length).toBeGreaterThanOrEqual(2);
    expect(aud.filter((a) => (a as { motivo?: string }).motivo).length).toBeGreaterThanOrEqual(2);
  });

  it('límites: 500 filas máx., vacío y cuerpo no objeto → 422; centros ajenos no se mezclan', async () => {
    expect((await lote('docA1', [])).statusCode).toBe(422);
    expect((await lote('docA1', Array.from({ length: 501 }, () => ({})))).statusCode).toBe(422);
    const r = await pedir(app, S('docA1'), 'PUT', '/notas/calificaciones/lote', [1, 2]);
    expect(r.statusCode).toBe(422);
    const b = (await lote('docB', [{ actividadId: 'actO', estudianteId: 'x', puntos: 1 }])).json() as Res;
    expect(b.rechazadas[0]?.codigo).toBe('actividad_no_encontrada'); // la actividad de otro centro no existe para él
    const grande = Array.from({ length: 500 }, (_, i) => ({ actividadId: 'actO', estudianteId: `g${i}`, puntos: 1 }));
    const g = (await lote('docA1', grande)).json() as Res;
    expect(g.aplicadas).toHaveLength(500);
  });

  it('lote de notas por competencia: por fila y con las mismas reglas', async () => {
    const r = await pedir(app, S('docA1'), 'PUT', '/notas/competencias/lote', {
      registros: [
        { cargaId: 'cg1', estudianteId: 'nl1', c: [{ p: [null, 70, null, null] }] },
        { cargaId: 'cg1', estudianteId: 'nl2', c: [{ p: [90, null, null, null] }] }, // P1 cerrado
        { cargaId: 'cg2', estudianteId: 'nl3', c: [] }, // carga ajena
        { cargaId: 'cg1', estudianteId: 'nl4', c: [{ p: [null, 170, null, null] }] },
      ],
    });
    const b = r.json() as Res;
    expect(b.aplicadas.map((x) => x.indice)).toEqual([0]);
    expect(b.rechazadas.map((x) => x.codigo)).toEqual(['periodo_cerrado', 'sin_permiso', 'fuera_de_rango']);
  });
});

describe('UNIQUE y concurrencia', () => {
  it('20 POST simultáneos de la misma celda (ids distintos): una gana, el resto 409; una sola fila viva', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => pedir(app, S('docA1'), 'POST', '/c/calificaciones', { id: `cal_conc_${i}`, actividadId: 'actO', estudianteId: 'conc', puntos: i % 10 })));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(19);
    const n = await admin(async (q) => (await q(`SELECT count(*)::int AS n FROM calificaciones WHERE actividad_id = 'actO' AND estudiante_id = 'conc' AND borrado_en IS NULL`))[0]);
    expect(n).toEqual({ n: 1 });
  });

  it('lotes simultáneos sobre las mismas celdas: nunca hay duplicados vivos', async () => {
    const reg = Array.from({ length: 15 }, (_, i) => ({ actividadId: 'actO', estudianteId: `cc${i}`, puntos: i % 10 }));
    const rs = await Promise.all(Array.from({ length: 6 }, (_, k) => pedir(app, k % 2 ? S('docA1') : S('dirA'), 'PUT', '/notas/calificaciones/lote', { registros: reg })));
    for (const r of rs) expect(r.statusCode).toBe(200);
    const filas = await admin((q) => q(`SELECT estudiante_id, count(*)::int AS n FROM calificaciones WHERE actividad_id = 'actO' AND estudiante_id LIKE 'cc%' AND borrado_en IS NULL GROUP BY 1`));
    expect(filas).toHaveLength(15);
    for (const f of filas as { n: number }[]) expect(f.n).toBe(1);
  });

  it('dos ediciones con If-Match de la misma versión: una gana, la otra 409 conflicto_version', async () => {
    const c = (await pedir(app, S('docA1'), 'GET', '/c/calificaciones/calO')).json() as { actualizadoEn: string };
    const rs = await Promise.all([1, 2, 3].map((i) => pedir(app, S('docA1'), 'PUT', '/c/calificaciones/calO', { actividadId: 'actO', estudianteId: 'e1', puntos: i }, { 'if-match': c.actualizadoEn })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });

  it('el UNIQUE y los CHECK están en la BD (no solo en la API)', async () => {
    await expect(admin((q) => q(`INSERT INTO calificaciones (id, centro_id, datos) VALUES ('dup_bd', '${A}', '{"actividadId":"actO","estudianteId":"e1","puntos":1}')`))).rejects.toThrow(/calificaciones_act_est_uidx/);
    await expect(admin((q) => q(`INSERT INTO calificaciones (id, centro_id, datos) VALUES ('neg_bd', '${A}', '{"actividadId":"actO","estudianteId":"e_neg","puntos":-1}')`))).rejects.toThrow(/calificaciones_puntos_chk/);
    await expect(admin((q) => q(`INSERT INTO categorias (id, centro_id, datos) VALUES ('c_bd', '${A}', '{"cargaId":"cg1","peso":101}')`))).rejects.toThrow(/categorias_peso_chk/);
    await expect(admin((q) => q(`INSERT INTO periodos (id, centro_id, datos) VALUES ('p_bd', '${A}', '{"peso":-1}')`))).rejects.toThrow(/periodos_peso_chk/);
    await expect(admin((q) => q(`INSERT INTO actividades (id, centro_id, datos) VALUES ('a_bd', '${A}', '{"cargaId":"cg1","puntosMax":0}')`))).rejects.toThrow(/actividades_puntos_max_chk/);
    await expect(admin((q) => q(`INSERT INTO notas_competencia (id, centro_id, datos) VALUES ('n_bd', '${A}', '{"cargaId":"cg1","estudianteId":"e1"}')`))).rejects.toThrow(/notas_competencia_carga_est_uidx/);
  });
});
