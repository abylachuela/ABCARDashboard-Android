// Horarios: POST /horarios/guardar (lote diff atómico), conflictos que BLOQUEAN, avisos, franjas por tanda, PUT/POST genérico,
// concurrencia y PARIDAD servidor↔cliente (casos generados con semilla fija).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargarEduCliente, prng } from './helpers/cliente-edu.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, cerrarPoolApp, consultaAdmin, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
type Conf = { tipo: string; msg: string; claves: string[] };
type Err = { error: { codigo: string; mensaje: string; conflictos?: Conf[]; avisos?: { tipo: string; msg: string }[]; errores?: string[] } };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
type Ok = { creados: Record<string, unknown>[]; actualizados: Record<string, unknown>[]; borrados: string[]; avisos: { tipo: string; msg: string }[]; conflictosPrevios: Conf[] };
const guardar = (ses: string, cuerpo: unknown) => pedir(app, S(ses), 'POST', '/horarios/guardar', cuerpo);
const nHorarios = async () => (await consultaAdmin<{ n: number }>(`SELECT count(*)::int AS n FROM horarios WHERE centro_id = $1 AND borrado_en IS NULL`, [A]))[0]!.n;
const limpiar = () => consultaAdmin(`UPDATE horarios SET borrado_en = now() WHERE centro_id = $1 AND borrado_en IS NULL`, [A]);
const b = (cargaId: string, dia: number, franjaId: string, aula = '') => ({ cargaId, dia, franjaId, aula });

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  const fr: [string, string, string, string][] = [['f1', '07:30', '08:15', 'clase'], ['f2', '08:15', '09:00', 'clase'], ['f3', '09:00', '09:20', 'recreo'], ['f4', '09:20', '10:05', 'clase']];
  for (const [i, [id, ini, fin, tipo]] of fr.entries()) await sembrar('franjas', id, A, { tanda: 'matutina', orden: i + 1, inicio: ini, fin, tipo });
  await sembrar('franjas', 'cfg_ctr_a', A, { tipo: 'config', topeHoras: 25 });
  await sembrar('asignaturas', 'as1', A, { nombre: 'Lengua' });
  await sembrar('asignaturas', 'as2', A, { nombre: 'Matemática' });
  await sembrar('cursos', 'cu1', A, { nombre: '1.º', grado: 1 });
  // mundo: cg1 (d1·s1), cg2 (d2·s2). Cargas adicionales
  await sembrar('cargas', 'cgX', A, { docenteId: 'd1', seccionId: 's2', asignaturaId: 'as2', horasSemana: 3 }); // d1 también da clase en s2
  await sembrar('cargas', 'cgY', A, { docenteId: 'd2', seccionId: 's1', asignaturaId: 'as2', horasSemana: 2 });
  await sembrar('disponibilidad', 'dis1', A, { docenteId: 'd2', dia: 3, franjaId: 'f4', disponible: false });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('POST /horarios/guardar', () => {
  it('crea bloques válidos (200) con hora y duración derivadas de la franja; devuelve avisos sin bloquear', async () => {
    const r = await guardar('dirA', { crear: [b('cg1', 1, 'f1', 'Aula 1'), b('cg2', 1, 'f1', 'Aula 2')] });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Ok;
    expect(j.creados).toHaveLength(2);
    expect(j.creados[0]).toMatchObject({ cargaId: 'cg1', dia: 1, franjaId: 'f1', hora: '07:30', duracion: 45, centroId: A });
    expect(j.avisos.some((a) => a.tipo === 'incompleta')).toBe(true); // las cargas piden más horas semanales
    await limpiar();
  });
  it('conflicto de DOCENTE → 409 horario_conflictos con la lista; nada se guarda', async () => {
    const r = await guardar('dirA', { crear: [b('cg1', 2, 'f1'), b('cgX', 2, 'f1')] }); // d1 en s1 y s2 a la vez
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('horario_conflictos');
    expect(err(r).conflictos!.map((c) => c.tipo)).toEqual(['docente']);
    expect(err(r).mensaje).toMatch(/dos secciones a la vez/);
    expect(await nHorarios()).toBe(0);
  });
  it('conflicto de SECCIÓN, AULA (sin distinguir mayúsculas/acentos) y DISPONIBILIDAD', async () => {
    expect(err(await guardar('dirA', { crear: [b('cg1', 2, 'f1'), b('cgY', 2, 'f1')] })).conflictos!.map((c) => c.tipo)).toEqual(['seccion']);
    expect(err(await guardar('dirA', { crear: [b('cg1', 2, 'f1', 'Laboratório'), b('cg2', 2, 'f1', ' laboratorio ')] })).conflictos!.map((c) => c.tipo)).toEqual(['aula']);
    expect(err(await guardar('dirA', { crear: [b('cgY', 3, 'f4')] })).conflictos!.map((c) => c.tipo)).toEqual(['disponibilidad']); // d2 no disponible el miércoles f4
    expect((await guardar('dirA', { crear: [b('cgY', 4, 'f4')] })).statusCode).toBe(200); // otro día sí
    await limpiar();
  });
  it('franja inexistente, franja que no es de clase (recreo), día fuera de 1–5 y carga de otro centro', async () => {
    expect(err(await guardar('dirA', { crear: [b('cg1', 1, 'fNo')] })).conflictos![0]).toMatchObject({ tipo: 'franja' });
    expect(err(await guardar('dirA', { crear: [b('cg1', 1, 'f3')] })).conflictos![0]!.msg).toMatch(/recreo/);
    const dia = await guardar('dirA', { crear: [b('cg1', 6, 'f1'), b('cg2', 0, 'f3')] });
    expect(dia.statusCode).toBe(409);
    expect(err(dia).conflictos!.every((c) => c.tipo === 'franja')).toBe(true);
    expect(err(dia).conflictos!.length).toBe(2);
    expect((await guardar('dirA', { crear: [{ ...b('cg1', 1, 'f1'), dia: 'lunes' }] })).statusCode).toBe(422);
    expect((await guardar('dirA', { crear: [b('cgB', 1, 'f1')] })).statusCode).toBe(422);
    expect(await nHorarios()).toBe(0);
  });
  it('atómico: un bloque bueno y uno malo → no se guarda ninguno; actualizar y borrar en el mismo lote', async () => {
    expect((await guardar('dirA', { crear: [b('cg1', 5, 'f1'), b('cg1', 5, 'f1x')] })).statusCode).toBe(409);
    expect(await nHorarios()).toBe(0);
    const ok = (await guardar('dirA', { crear: [b('cg1', 1, 'f1'), b('cg2', 1, 'f2'), b('cgX', 1, 'f4')] })).json() as Ok;
    const [a, c2, x] = ok.creados.map((h) => h.id as string);
    // mueve cg2 al choque con cg1 (misma sección no; mismo docente no) → mueve cgX a f1: d1 ya está en f1 con cg1 → conflicto
    const mal = await guardar('dirA', { actualizar: [{ id: x, ...b('cgX', 1, 'f1') }], borrar: [c2] });
    expect(mal.statusCode).toBe(409);
    expect((await consultaAdmin(`SELECT id FROM horarios WHERE id = $1 AND borrado_en IS NULL`, [c2]))).toHaveLength(1); // el borrado también se deshizo
    const bien = (await guardar('dirA', { actualizar: [{ id: x, ...b('cgX', 2, 'f1', 'Aula 9') }], borrar: [c2], crear: [b('cg2', 3, 'f1')] })).json() as Ok;
    expect(bien.actualizados[0]).toMatchObject({ id: x, dia: 2, aula: 'Aula 9' });
    expect(bien.borrados).toEqual([c2]);
    expect(await nHorarios()).toBe(3);
    // un bloque propio no choca consigo mismo al reenviarse igual
    expect((await guardar('dirA', { actualizar: [{ id: a, ...b('cg1', 1, 'f1') }] })).statusCode).toBe(200);
    expect(err(await guardar('dirA', { actualizar: [{ id: 'noExiste', ...b('cg1', 1, 'f1') }] })).codigo).toBe('no_encontrado');
    expect((await guardar('dirA', { crear: [], actualizar: [], borrar: [] })).statusCode).toBe(422);
    await limpiar();
  });
  it('los conflictos de datos anteriores (no tocados) no bloquean un guardado ajeno: se informan como previos', async () => {
    await sembrar('horarios', 'hp1', A, { cargaId: 'cg1', dia: 4, franjaId: 'f1' });
    await sembrar('horarios', 'hp2', A, { cargaId: 'cgX', dia: 4, franjaId: 'f1' }); // docente d1 duplicado (heredado)
    const r = await guardar('dirA', { crear: [b('cg2', 5, 'f2')] });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as Ok).conflictosPrevios.map((c) => c.tipo)).toEqual(['docente']);
    // pero tocar uno de los dos sí exige resolverlo
    expect((await guardar('dirA', { actualizar: [{ id: 'hp2', ...b('cgX', 4, 'f1', 'Aula') }] })).statusCode).toBe(409);
    expect((await guardar('dirA', { actualizar: [{ id: 'hp2', ...b('cgX', 4, 'f2') }] })).statusCode).toBe(200);
    await limpiar();
  });
  it('aviso de sobrecarga (tope por docente) sin bloquear', async () => {
    await consultaAdmin(`UPDATE franjas SET datos = datos || '{"topeHoras":1}'::jsonb WHERE id = 'cfg_ctr_a'`);
    const r = await guardar('dirA', { crear: [b('cg1', 1, 'f1'), b('cg1', 2, 'f1')] });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Ok).avisos.map((a) => a.tipo)).toContain('sobrecarga');
    await consultaAdmin(`UPDATE franjas SET datos = datos || '{"topeHoras":25}'::jsonb WHERE id = 'cfg_ctr_a'`);
    await limpiar();
  });
  it('permisos: docente solo toca bloques de SUS cargas; tutor/estudiante 403; otro centro no ve las cargas', async () => {
    expect((await guardar('docA1', { crear: [b('cg1', 1, 'f1')] })).statusCode).toBe(200);
    expect((await guardar('docA1', { crear: [b('cg2', 1, 'f2')] })).statusCode).toBe(403);
    for (const k of ['tutA', 'estA1']) expect((await guardar(k, { crear: [b('cg1', 2, 'f1')] })).statusCode, k).toBe(403);
    expect((await guardar('dirB', { crear: [b('cg1', 2, 'f1')] })).statusCode).toBe(422);
    expect((await pedir(app, null, 'POST', '/horarios/guardar', {})).statusCode).toBe(401);
    expect((await guardar('admin', { crear: [b('cg1', 2, 'f1')] })).statusCode).toBe(422); // admin_red debe indicar centroId
    expect((await guardar('admin', { centroId: A, crear: [b('cg1', 2, 'f1')] })).statusCode).toBe(200);
    await limpiar();
  });
  it('CONCURRENCIA: 10 guardados simultáneos del mismo docente en la misma franja → exactamente 1 gana', async () => {
    const cargas = ['cg1', 'cgX'];
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => guardar('dirA', { crear: [b(cargas[i % 2]!, 5, 'f4')] })));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    for (const r of rs.filter((x) => x.statusCode !== 200)) expect(r.statusCode).toBe(409);
    expect(await nHorarios()).toBe(1);
    await limpiar();
  });
});

describe('PUT/POST genérico de horarios no puede introducir conflictos', () => {
  it('POST con choque → 409; sin choque → 201 con hora derivada; PUT que mueve a un choque → 409', async () => {
    const ok = await pedir(app, S('dirA'), 'POST', '/c/horarios', b('cg1', 1, 'f1'));
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ hora: '07:30', duracion: 45 });
    const mal = await pedir(app, S('dirA'), 'POST', '/c/horarios', b('cgX', 1, 'f1'));
    expect(mal.statusCode).toBe(409);
    expect(err(mal).codigo).toBe('horario_conflictos');
    const otro = (await pedir(app, S('dirA'), 'POST', '/c/horarios', b('cgX', 2, 'f1'))).json() as Record<string, unknown>;
    const r = await pedir(app, S('dirA'), 'PUT', `/c/horarios/${otro.id}`, { ...otro, dia: 1 });
    expect(r.statusCode).toBe(409);
    expect((await pedir(app, S('dirA'), 'PUT', `/c/horarios/${otro.id}`, { ...otro, aula: 'B' })).statusCode).toBe(200);
    const lote = await pedir(app, S('dirA'), 'POST', '/c/horarios/lote', { registros: [{ id: 'hl1', ...b('cgY', 1, 'f1') }] }); // s1 ya tiene cg1 a esa hora
    expect(lote.statusCode).toBe(409);
    expect((await pedir(app, S('dirA'), 'POST', '/c/horarios', { cargaId: 'cg1', dia: 1, hora: '08:00', duracion: 45 })).statusCode).toBe(201); // heredado sin franja
    await limpiar();
  });
});

describe('franjas por tanda', () => {
  const tanda = (franjas: unknown[], ses = 'dirA') => pedir(app, S(ses), 'POST', '/franjas/tanda', { tanda: 'vespertina', franjas });
  it('valida formato, inicio<fin y solapes (con la validación del cliente); reemplaza atómicamente', async () => {
    expect(err(await tanda([{ inicio: '13:30', fin: '14:15', tipo: 'clase' }, { inicio: '14:00', fin: '14:45', tipo: 'clase' }])).codigo).toBe('franjas_invalidas');
    expect(err(await tanda([{ inicio: '14:15', fin: '13:30', tipo: 'clase' }])).codigo).toBe('datos_invalidos');
    expect(err(await tanda([{ inicio: '25:00', fin: '26:00', tipo: 'clase' }])).codigo).toBe('datos_invalidos');
    expect(err(await tanda([{ inicio: '13:30', fin: '14:15', tipo: 'baile' }])).codigo).toBe('datos_invalidos');
    expect(err(await pedir(app, S('dirA'), 'POST', '/franjas/tanda', { tanda: 'nocturna', franjas: [] })).codigo).toBe('datos_invalidos');
    const ok = await tanda([{ inicio: '13:30', fin: '14:15', tipo: 'clase' }, { inicio: '14:15', fin: '14:30', tipo: 'recreo' }]);
    expect(ok.statusCode, ok.body).toBe(200);
    const fr = (ok.json() as { franjas: { id: string; orden: number; tanda: string }[] }).franjas;
    expect(fr.map((f) => f.orden)).toEqual([1, 2]);
    // se reordena/modifica conservando ids y quitando una
    const ok2 = await tanda([{ id: fr[0]!.id, inicio: '13:00', fin: '13:45', tipo: 'clase' }]);
    expect((ok2.json() as { quitadas: string[] }).quitadas).toEqual([fr[1]!.id]);
    expect(await consultaAdmin(`SELECT id FROM franjas WHERE centro_id = $1 AND datos->>'tanda' = 'vespertina' AND borrado_en IS NULL`, [A])).toHaveLength(1);
  });
  it('no se quita una franja con clases ni se cambia a recreo; sí se quita sin clases (y su disponibilidad)', async () => {
    const cur = ((await pedir(app, S('dirA'), 'GET', '/c/franjas?f.tanda=vespertina')).json() as { datos: { id: string }[] }).datos[0]!;
    await sembrar('horarios', 'hFr', A, { cargaId: 'cg1', dia: 1, franjaId: cur.id });
    await sembrar('disponibilidad', 'disFr', A, { docenteId: 'd1', dia: 2, franjaId: cur.id, disponible: false });
    expect(err(await tanda([])).codigo).toBe('franja_con_clases');
    expect(err(await tanda([{ id: cur.id, inicio: '13:00', fin: '13:45', tipo: 'recreo' }])).codigo).toBe('franja_con_clases');
    await limpiar();
    expect((await tanda([])).statusCode).toBe(200);
    expect(await consultaAdmin(`SELECT 1 FROM disponibilidad WHERE id = 'disFr' AND borrado_en IS NULL`)).toHaveLength(0);
  });
  it('permisos y centro; el POST/PUT/DELETE genérico de franjas aplica las mismas reglas', async () => {
    expect((await tanda([], 'docA1')).statusCode).toBe(403);
    expect((await tanda([], 'tutA')).statusCode).toBe(403);
    expect((await tanda([{ inicio: '13:30', fin: '14:15', tipo: 'clase' }], 'secA')).statusCode).toBe(200);
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/franjas', { tanda: 'matutina', tipo: 'clase', inicio: '07:40', fin: '08:00' })).codigo).toBe('franjas_invalidas'); // solapa f1
    expect((await pedir(app, S('dirA'), 'POST', '/c/franjas', { tanda: 'matutina', tipo: 'clase', inicio: '10:05', fin: '10:50' })).statusCode).toBe(201);
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/franjas', { tanda: 'matutina', tipo: 'clase', inicio: '11:00', fin: '10:50' })).codigo).toBe('datos_invalidos');
    await sembrar('horarios', 'hFr2', A, { cargaId: 'cg1', dia: 1, franjaId: 'f1' });
    expect(err(await pedir(app, S('dirA'), 'DELETE', '/c/franjas/f1')).codigo).toBe('franja_con_clases');
    const f1 = (await pedir(app, S('dirA'), 'GET', '/c/franjas/f1')).json() as Record<string, unknown>;
    expect(err(await pedir(app, S('dirA'), 'PUT', '/c/franjas/f1', { ...f1, tipo: 'recreo' })).codigo).toBe('franja_con_clases');
    await limpiar();
  });
});

describe('PARIDAD servidor ↔ cliente (casos generados, semilla fija)', () => {
  const cliente = cargarEduCliente(['core/formato.js', 'vistas/horarios-motor.js']) as { horarios: { motor: { armar(d: unknown): unknown; validar(c: unknown, e: unknown): { conflictos: Conf[]; avisos: { tipo: string; msg: string }[] } } } };
  const motor = cliente.horarios.motor;

  it('motor compartido: 400 casos aleatorios (franjas, disponibilidad, aulas, tandas) dan el MISMO resultado que la función del cliente', async () => {
    const { motorHorarios } = await import('../src/domain/horarios-shim.js');
    const rnd = prng(20260101);
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    let conConflictos = 0;
    for (let caso = 0; caso < 400; caso++) {
      const franjas = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => ({ id: `f${i}`, tanda: pick(['matutina', 'vespertina', 'extendida']), orden: i + 1, inicio: `${String(7 + Math.floor(i * 0.7 + rnd())).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`, fin: `${String(8 + Math.floor(i * 0.7 + rnd())).padStart(2, '0')}:${pick(['10', '25', '40', '55'])}`, tipo: pick(['clase', 'clase', 'clase', 'recreo', 'almuerzo']) }));
      const secciones = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, cursoId: 'c0', nombre: String.fromCharCode(65 + i), tanda: pick(['Matutina', 'Vespertina', 'Jornada Extendida']) }));
      const cargas = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, docenteId: pick(['d0', 'd1', 'd2', '']), seccionId: pick(secciones).id, asignaturaId: pick(['a0', 'a1']), horasSemana: Math.floor(rnd() * 5) }));
      const datos = {
        franjas: [...franjas, ...(rnd() < 0.3 ? [{ id: 'cfg', tipo: 'config', topeHoras: Math.floor(rnd() * 6), topes: { d0: 1 } }] : [])],
        horarios: [], cursos: [{ id: 'c0', nombre: '1.º' }], asignaturas: [{ id: 'a0', nombre: 'Lengua' }, { id: 'a1', nombre: 'Matemática' }],
        docentes: [{ id: 'd0', nombres: 'Ana' }, { id: 'd1', nombres: 'Beto' }, { id: 'd2', nombres: 'Carla' }],
        disponibilidad: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ docenteId: pick(['d0', 'd1']), dia: 1 + Math.floor(rnd() * 5), franjaId: pick(franjas).id, disponible: false })),
        cargas, secciones,
      };
      const entradas = Array.from({ length: Math.floor(rnd() * 9) }, (_, i) => ({ id: `h${i}`, cargaId: pick([...cargas.map((c) => c.id), 'gNo']), dia: pick([1, 2, 3, 4, 5, 5]), franjaId: pick([...franjas.map((f) => f.id), 'fNo']), aula: pick(['', 'A1', ' a1 ', 'Lab', 'LAB']) }));
      const esperado = JSON.parse(JSON.stringify(motor.validar(motor.armar(JSON.parse(JSON.stringify(datos))), JSON.parse(JSON.stringify(entradas)))));
      const real = motorHorarios().validar(datos as never, entradas);
      expect(real, `caso ${caso}`).toEqual(esperado);
      if (esperado.conflictos.length) conConflictos++;
    }
    expect(conConflictos).toBeGreaterThan(40); // la generación sí produce conflictos de todo tipo
  });

  it('extremo a extremo: lo que el cliente marca como conflicto es lo que el servidor rechaza (mismos mensajes); sin conflicto, guarda', async () => {
    const data = async () => {
      const g = async (t: string): Promise<unknown[]> => (await consultaAdmin<{ id: string; datos: Record<string, unknown> }>(`SELECT id, datos FROM ${t} WHERE centro_id = $1 AND borrado_en IS NULL`, [A])).map((r) => ({ ...r.datos, id: r.id, centroId: A }));
      return { franjas: await g('franjas'), horarios: [], disponibilidad: await g('disponibilidad'), cargas: await g('cargas'), secciones: await g('secciones'), cursos: await g('cursos'), asignaturas: await g('asignaturas'), docentes: await g('docentes') };
    };
    const d = await data();
    const rnd = prng(777);
    const cargas = ['cg1', 'cg2', 'cgX', 'cgY'];
    const franjas = ['f1', 'f2', 'f3', 'f4', 'fNo'];
    let rechazados = 0, aceptados = 0;
    for (let caso = 0; caso < 60; caso++) {
      const entradas = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => ({ _k: `nuevo_${i}`, cargaId: cargas[Math.floor(rnd() * cargas.length)]!, dia: 1 + Math.floor(rnd() * 3), franjaId: franjas[Math.floor(rnd() * franjas.length)]!, aula: ['', 'A', 'a'][Math.floor(rnd() * 3)]! }));
      const esperado = motor.validar(motor.armar(JSON.parse(JSON.stringify(d))), JSON.parse(JSON.stringify(entradas)));
      const r = await guardar('dirA', { crear: entradas.map(({ cargaId, dia, franjaId, aula }) => ({ cargaId, dia, franjaId, aula })) });
      if (esperado.conflictos.length) {
        expect(r.statusCode, `caso ${caso}: ${r.body}`).toBe(409);
        expect(err(r).conflictos!.map((c) => c.msg).sort()).toEqual(esperado.conflictos.map((c) => c.msg).sort());
        rechazados++;
      } else {
        expect(r.statusCode, `caso ${caso}: ${r.body}`).toBe(200);
        expect((r.json() as Ok).avisos.map((a) => a.msg).sort()).toEqual(esperado.avisos.map((a) => a.msg).sort());
        aceptados++;
        await limpiar();
      }
    }
    expect(rechazados).toBeGreaterThan(10);
    expect(aceptados).toBeGreaterThan(3);
  });
});
