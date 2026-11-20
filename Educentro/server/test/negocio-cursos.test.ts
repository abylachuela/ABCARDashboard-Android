// Cursos y talleres: inscripción, cupo, lista de espera con turno del servidor, grado, choques, retiro con promoción, cierre,
// notas, mass-assignment y concurrencia real.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, consultaAdmin, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
type Err = { error: { codigo: string; mensaje: string; [k: string]: unknown } };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
type Res = { resultados: { estudianteId: string; ok: boolean; estado?: string; codigo?: string; mensaje?: string; inscripcion?: Record<string, unknown> }[] };
const ins = (curso: string, ids: string[], ses = 'dirA') => pedir(app, S(ses), 'POST', `/cursos/${curso}/inscripciones`, ids.length === 1 ? { estudianteId: ids[0] } : { estudianteIds: ids });
const estados = async (curso: string) =>
  Object.fromEntries((await consultaAdmin<{ estudiante_id: string; estado: string }>(`SELECT estudiante_id, estado FROM inscripciones WHERE curso_id = $1 AND borrado_en IS NULL`, [curso])).map((r) => [r.estudiante_id, r.estado]));
const horario = [{ dia: 1, franjaId: null, desde: '15:00', hasta: '16:30', texto: '' }];

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await sembrar('cursos', 'cu2', A, { nombre: '2.º', nivel: 'Secundario', grado: 2 });
  await sembrar('cursos', 'cu5', A, { nombre: '5.º', nivel: 'Secundario', grado: 5 });
  await sembrar('secciones', 'sc2', A, { cursoId: 'cu2', anioId: 'an1', nombre: 'A', capacidad: 60 });
  await sembrar('secciones', 'sc5', A, { cursoId: 'cu5', anioId: 'an1', nombre: 'A', capacidad: 60 });
  for (let i = 100; i < 140; i++) {
    await sembrar('estudiantes', `ec${i}`, A, { nombres: `Est ${i}` });
    await sembrar('matriculas', `mc${i}`, A, { estudianteId: `ec${i}`, seccionId: i === 139 ? 'sc5' : 'sc2', anioId: 'an1', estado: 'activa' });
  }
  await sembrar('estudiantes', 'ecSinMat', A, { nombres: 'Sin matrícula' });
  await sembrar('estudiantes', 'ecBaja', A, { nombres: 'Baja', estado: 'inactivo' });
  const base = { tipo: 'taller', estado: 'abierto', inicio: '2026-10-01', fin: '2026-12-01', horario };
  await sembrar('cursos_extra', 'cx1', A, { ...base, nombre: 'Robótica', cupo: 2, grados: ['Secundario:2'] });
  await sembrar('cursos_extra', 'cxChoque', A, { ...base, nombre: 'Ajedrez', cupo: 5, horario: [{ dia: 1, desde: '16:00', hasta: '17:00' }] });
  await sembrar('cursos_extra', 'cxLibreHora', A, { ...base, nombre: 'Coro', cupo: 5, horario: [{ dia: 2, desde: '15:00', hasta: '16:00' }] });
  await sembrar('cursos_extra', 'cxFuera', A, { ...base, nombre: 'Danza', cupo: 5, inicio: '2027-01-10', fin: '2027-02-10' }); // mismo horario pero otras fechas
  await sembrar('cursos_extra', 'cxCerrado', A, { ...base, nombre: 'Viejo', estado: 'cerrado', cupo: 5 });
  await sembrar('cursos_extra', 'cxB', B, { ...base, nombre: 'De B', cupo: 5 });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('inscripciones', () => {
  it('cupo y lista de espera: el turno lo pone el servidor (secuencia creciente, el cliente no lo decide)', async () => {
    const a = (await (ins('cx1', ['ec100']))).json() as Res;
    expect(a.resultados[0]).toMatchObject({ ok: true, estado: 'inscrito' });
    expect((await ins('cx1', ['ec101'])).json() as Res).toMatchObject({ resultados: [{ estado: 'inscrito' }] });
    const e1 = ((await ins('cx1', ['ec102'])).json() as Res).resultados[0]!;
    const e2 = ((await pedir(app, S('dirA'), 'POST', '/cursos/cx1/inscripciones', { estudianteId: 'ec103', turno: 1, estado: 'inscrito', fecha: '2026-01-01' })).json() as Res).resultados[0]!;
    expect(e1.estado).toBe('en_lista_espera');
    expect(e2.estado).toBe('en_lista_espera'); // estado y turno del cliente se ignoran
    expect(Number(e2.inscripcion!.turno)).toBeGreaterThan(Number(e1.inscripcion!.turno));
    expect(Number(e1.inscripcion!.turno)).toBeGreaterThan(0);
  });
  it('duplicado: individual → 409; en lote cada estudiante se evalúa por separado', async () => {
    const r = await ins('cx1', ['ec100']);
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('inscripcion_duplicada');
    const lote = (await ins('cxLibreHora', ['ec100', 'ec100', 'ecBaja', 'ecSinMat'])).json() as Res;
    expect(lote.resultados.map((x) => x.ok ? 'ok' : x.codigo)).toEqual(['ok', 'estudiante_repetido', 'estudiante_inactivo', 'ok']);
  });
  it('grado permitido: sin matrícula activa y grado distinto → 409', async () => {
    await sembrar('cursos_extra', 'cxGrado', A, { tipo: 'taller', estado: 'abierto', nombre: 'G2', cupo: 9, grados: ['Secundario:2'], horario: [{ dia: 4, desde: '10:00', hasta: '11:00' }] });
    expect(err(await ins('cxGrado', ['ecSinMat'])).codigo).toBe('sin_matricula_activa');
    expect(err(await ins('cxGrado', ['ec139'])).codigo).toBe('grado_no_permitido');
    expect((await ins('cxGrado', ['ec110'])).statusCode).toBe(201);
  });
  it('choque de horario solo si coinciden día/hora Y las fechas se solapan', async () => {
    expect(err(await ins('cxChoque', ['ec100'])).codigo).toBe('choque_horario'); // lunes 15:00–16:30 vs 16:00–17:00
    expect((await ins('cxFuera', ['ec100'])).statusCode).toBe(201); // mismo horario pero otras fechas
    expect((await ins('cxChoque', ['ec102'])).statusCode).toBe(409); // ec102 está en lista de espera de cx1: cuenta como activa
  });
  it('curso cerrado y de otro centro; permisos', async () => {
    expect(err(await ins('cxCerrado', ['ec120'])).codigo).toBe('curso_cerrado');
    expect((await ins('cxB', ['ec120'])).statusCode).toBe(404);
    expect((await ins('cx1', ['ec120'], 'tutA')).statusCode).toBe(403);
    expect((await ins('cx1', ['ec120'], 'estA1')).statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'POST', '/cursos/cx1/inscripciones', {})).statusCode).toBe(422);
  });
  it('mass-assignment: el POST genérico de inscripciones se rechaza; el PUT no cambia estado, turno ni fechas; sí asistencia y nota', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/inscripciones', { cursoId: 'cx1', estudianteId: 'ec125', estado: 'inscrito' })).codigo).toBe('usar_endpoint');
    const lista = ((await pedir(app, S('dirA'), 'GET', '/c/inscripciones?f.cursoId=cx1&f.estudianteId=ec102')).json() as { datos: Record<string, unknown>[] }).datos[0]!;
    for (const cambio of [{ estado: 'inscrito' }, { turno: 999 }, { fecha: '2020-01-01' }, { cursoId: 'cxLibreHora' }, { promovidoEn: '2026-01-01' }]) {
      const r = await pedir(app, S('dirA'), 'PUT', `/c/inscripciones/${lista.id}`, { ...lista, ...cambio });
      expect(r.statusCode, JSON.stringify(cambio)).toBe(422);
      expect(err(r).codigo).toBe('campo_protegido');
    }
    const ok = await pedir(app, S('dirA'), 'PUT', `/c/inscripciones/${lista.id}`, { ...lista, observacion: 'ok', asistencia: [{ fecha: '2026-11-02', estado: 'P' }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(err(await pedir(app, S('dirA'), 'PUT', `/c/inscripciones/${lista.id}`, { ...lista, asistencia: [{ fecha: 'x', estado: 'Z' }] })).codigo).toBe('datos_invalidos');
    expect((await pedir(app, S('dirA'), 'DELETE', `/c/inscripciones/${lista.id}`)).statusCode).toBe(409); // activa: primero se retira
  });
});

describe('retiro, promoción, reinscripción y cierre', () => {
  it('retirar un inscrito promueve al primero de la lista de espera EN LA MISMA transacción', async () => {
    const est = await estados('cx1');
    expect(est).toMatchObject({ ec100: 'inscrito', ec101: 'inscrito', ec102: 'en_lista_espera', ec103: 'en_lista_espera' });
    const id = 'ins_cx1_ec100';
    const r = await pedir(app, S('secA'), 'POST', `/inscripciones/${id}/retirar`, { motivo: 'Cambio de horario' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as { inscripcion: Record<string, unknown>; promovidos: { estudianteId: string; inscripcion: Record<string, unknown> }[] };
    expect(j.inscripcion).toMatchObject({ estado: 'retirado', motivoRetiro: 'Cambio de horario', turno: null });
    expect(j.promovidos.map((x) => x.estudianteId)).toEqual(['ec102']);
    expect(j.promovidos[0]!.inscripcion).toMatchObject({ estado: 'inscrito', turno: null });
    expect(await estados('cx1')).toMatchObject({ ec100: 'retirado', ec102: 'inscrito', ec103: 'en_lista_espera' });
    expect(err(await pedir(app, S('secA'), 'POST', `/inscripciones/${id}/retirar`, {})).codigo).toBe('inscripcion_no_activa');
  });
  it('retirar a alguien en lista de espera no promueve a nadie', async () => {
    const r = (await pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cx1_ec103/retirar', {})).json() as { promovidos: unknown[] };
    expect(r.promovidos).toHaveLength(0);
  });
  it('un candidato de la cola que ya no cumple las reglas (choque) se salta y promueve al siguiente', async () => {
    await sembrar('cursos_extra', 'cxCola', A, { tipo: 'taller', estado: 'abierto', nombre: 'Cola', cupo: 1, horario: [{ dia: 3, desde: '08:00', hasta: '09:00' }] });
    await ins('cxCola', ['ec111']);
    expect(((await ins('cxCola', ['ec112'])).json() as Res).resultados[0]!.estado).toBe('en_lista_espera');
    expect(((await ins('cxCola', ['ec113'])).json() as Res).resultados[0]!.estado).toBe('en_lista_espera');
    // ec112 se inscribe después en otro curso que choca (mismo horario) → al liberarse la plaza se salta
    await sembrar('cursos_extra', 'cxMismaHora', A, { tipo: 'taller', estado: 'abierto', nombre: 'Misma hora', cupo: 9, horario: [{ dia: 3, desde: '08:30', hasta: '09:30' }] });
    expect((await ins('cxMismaHora', ['ec112'])).statusCode).toBe(409); // ya lo impide el choque con su lista de espera
    await sembrar('inscripciones', 'insForzada', A, { cursoId: 'cxMismaHora', estudianteId: 'ec112', estado: 'inscrito', asistencia: [] }); // forzado por SQL (dato heredado)
    const r = (await pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cxCola_ec111/retirar', {})).json() as { promovidos: { estudianteId: string }[] };
    expect(r.promovidos.map((x) => x.estudianteId)).toEqual(['ec113']);
    expect((await estados('cxCola')).ec112).toBe('en_lista_espera');
  });
  it('reinscribir: pasa por las validaciones y el cupo; solo quien está retirado', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cx1_ec102/reinscribir')).codigo).toBe('inscripcion_no_retirada');
    const r = await pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cx1_ec100/reinscribir');
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { inscripcion: { estado: string } }).inscripcion.estado).toBe('en_lista_espera'); // cx1 está lleno (ec101, ec102): la reinscripción respeta el cupo
  });
  it('notas: estado «completado» solo por el endpoint; rango 0–100; solo inscritos del curso', async () => {
    const id = 'ins_cx1_ec101';
    const r = await pedir(app, S('dirA'), 'POST', '/cursos/cx1/notas', { registros: [{ inscripcionId: id, nota: 88.5, completado: true }] });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { datos: Record<string, unknown>[] }).datos[0]).toMatchObject({ estado: 'completado', nota: 88.5 });
    expect(err(await pedir(app, S('dirA'), 'POST', '/cursos/cx1/notas', { registros: [{ inscripcionId: id, nota: 101 }] })).codigo).toBe('fuera_de_rango');
    expect((await pedir(app, S('dirA'), 'POST', '/cursos/cxCola/notas', { registros: [{ inscripcionId: id, nota: 1 }] })).statusCode).toBe(404);
    expect(err(await ins('cx1', ['ec101'])).codigo).toBe('ya_completado');
  });
  it('cierre: la lista de espera pasa a retirado; cerrado es terminal; el PUT genérico no cambia el estado del curso', async () => {
    await sembrar('cursos_extra', 'cxCierre', A, { tipo: 'taller', estado: 'abierto', nombre: 'Cierre', cupo: 1, horario: [{ dia: 5, desde: '08:00', hasta: '09:00' }] });
    await ins('cxCierre', ['ec114']);
    await ins('cxCierre', ['ec115']);
    await ins('cxCierre', ['ec116']);
    const curso = (await pedir(app, S('dirA'), 'GET', '/c/cursosExtra/cxCierre')).json() as Record<string, unknown>;
    expect(err(await pedir(app, S('dirA'), 'PUT', '/c/cursosExtra/cxCierre', { ...curso, estado: 'cerrado' })).codigo).toBe('campo_protegido');
    expect(err(await pedir(app, S('dirA'), 'POST', '/cursos/cxCierre/estado', { estado: 'raro' })).codigo).toBe('datos_invalidos');
    const r = await pedir(app, S('secA'), 'POST', '/cursos/cxCierre/estado', { estado: 'cerrado' });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { retirados: number }).retirados).toBe(2);
    expect(await estados('cxCierre')).toMatchObject({ ec114: 'inscrito', ec115: 'retirado', ec116: 'retirado' });
    expect(err(await pedir(app, S('dirA'), 'POST', '/cursos/cxCierre/estado', { estado: 'abierto' })).codigo).toBe('transicion_invalida');
    expect(err(await ins('cxCierre', ['ec117'])).codigo).toBe('curso_cerrado');
    expect((await pedir(app, S('dirA'), 'POST', '/cursos/cx1/estado', { estado: 'en_curso' })).statusCode).toBe(200);
  });
  it('validadores de cursosExtra: estado inicial, cupo 1–500 y no menor que los inscritos, grados, borrado con inscripciones', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/cursosExtra', { nombre: 'N', estado: 'cerrado' })).codigo).toBe('campo_protegido');
    const ok = await pedir(app, S('dirA'), 'POST', '/c/cursosExtra', { nombre: 'Nuevo', tipo: 'taller', cupo: 3, grados: ['Secundario:2'] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ estado: 'abierto' });
    for (const cupo of [0, 501, 1.5, 'x']) expect((await pedir(app, S('dirA'), 'POST', '/c/cursosExtra', { nombre: 'N', cupo })).statusCode, String(cupo)).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/c/cursosExtra', { nombre: 'N', grados: ['mal'] })).statusCode).toBe(422);
    const cx1 = (await pedir(app, S('dirA'), 'GET', '/c/cursosExtra/cx1')).json() as Record<string, unknown>;
    expect(err(await pedir(app, S('dirA'), 'PUT', '/c/cursosExtra/cx1', { ...cx1, cupo: 1 })).codigo).toBe('cupo_menor_inscritos'); // 2 ocupados (ec101 completó, ec102 inscrito)
    expect(err(await pedir(app, S('dirA'), 'DELETE', '/c/cursosExtra/cx1')).codigo).toBe('tiene_dependencias');
  });
});

describe('CONCURRENCIA en cursos', () => {
  it('20 inscripciones simultáneas con UNA plaza → exactamente 1 inscrito y 19 en lista de espera con turnos distintos', async () => {
    await sembrar('cursos_extra', 'cxRace', A, { tipo: 'taller', estado: 'abierto', nombre: 'Carrera', cupo: 1, horario: [{ dia: 2, desde: '07:00', hasta: '07:30' }] });
    const ids = Array.from({ length: 20 }, (_, i) => `ec${100 + i}`);
    const rs = await Promise.all(ids.map((e) => ins('cxRace', [e])));
    expect(rs.every((r) => r.statusCode === 201 || r.statusCode === 409), rs.map((r) => r.statusCode).join()).toBe(true);
    const filas = await consultaAdmin<{ estado: string; turno: string | null }>(`SELECT estado, datos->>'turno' AS turno FROM inscripciones WHERE curso_id = 'cxRace' AND borrado_en IS NULL`);
    const insc = filas.filter((f) => f.estado === 'inscrito');
    const espera = filas.filter((f) => f.estado === 'en_lista_espera');
    expect(insc).toHaveLength(1);
    expect(espera.length).toBe(filas.length - 1);
    expect(new Set(espera.map((e) => e.turno)).size).toBe(espera.length);
    // los 409 son choques de horario con otros cursos del propio estudiante (ec100/101… ya tienen clases): nunca error de cupo
    for (const r of rs.filter((x) => x.statusCode === 409)) expect(['choque_horario', 'inscripcion_duplicada']).toContain(err(r).codigo);
  });
  it('20 inscripciones de estudiantes distintos con UNA plaza → 1 gana', async () => {
    await sembrar('cursos_extra', 'cxRace2', A, { tipo: 'taller', estado: 'abierto', nombre: 'Carrera 2', cupo: 1, horario: [{ dia: 5, desde: '12:00', hasta: '12:30' }] });
    const ids = Array.from({ length: 20 }, (_, i) => `ec${120 + i}`.replace('ec139', 'ec138'));
    const rs = await Promise.all([...new Set(ids)].map((e) => ins('cxRace2', [e])));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(rs.length);
    const est = Object.values(await estados('cxRace2'));
    expect(est.filter((e) => e === 'inscrito')).toHaveLength(1);
    expect(est.filter((e) => e === 'en_lista_espera')).toHaveLength(est.length - 1);
  });
  it('promoción bajo carrera: retirar los 2 inscritos a la vez promueve exactamente a los 2 primeros de la cola, sin pasarse del cupo', async () => {
    await sembrar('cursos_extra', 'cxPromo', A, { tipo: 'taller', estado: 'abierto', nombre: 'Promoción', cupo: 2, horario: [{ dia: 4, desde: '19:00', hasta: '19:30' }] });
    for (const e of ['ec100', 'ec101', 'ec102', 'ec103', 'ec104', 'ec105']) await ins('cxPromo', [e]);
    expect(await estados('cxPromo')).toMatchObject({ ec100: 'inscrito', ec101: 'inscrito', ec102: 'en_lista_espera', ec103: 'en_lista_espera', ec104: 'en_lista_espera' });
    const rs = await Promise.all([
      pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cxPromo_ec100/retirar', {}),
      pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cxPromo_ec101/retirar', {}),
      pedir(app, S('dirA'), 'POST', '/inscripciones/ins_cxPromo_ec100/retirar', {}),
    ]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 200, 409]);
    expect(await estados('cxPromo')).toMatchObject({ ec100: 'retirado', ec101: 'retirado', ec102: 'inscrito', ec103: 'inscrito', ec104: 'en_lista_espera', ec105: 'en_lista_espera' });
  });
  it('retirar mientras otros se inscriben: los inscritos nunca superan el cupo', async () => {
    await sembrar('cursos_extra', 'cxMix', A, { tipo: 'taller', estado: 'abierto', nombre: 'Mezcla', cupo: 3, horario: [{ dia: 3, desde: '20:00', hasta: '20:30' }] });
    await ins('cxMix', ['ec130', 'ec131', 'ec132']);
    const acciones = [
      ...['ec130', 'ec131'].map((e) => pedir(app, S('dirA'), 'POST', `/inscripciones/ins_cxMix_${e}/retirar`, {})),
      ...['ec133', 'ec134', 'ec135', 'ec136'].map((e) => ins('cxMix', [e])),
    ];
    await Promise.all(acciones);
    const est = Object.values(await estados('cxMix'));
    expect(est.filter((e) => e === 'inscrito').length).toBeLessThanOrEqual(3);
    const n = est.filter((e) => e === 'inscrito').length;
    expect(n).toBe(3); // la cola cubre todas las plazas libres
  });
});
