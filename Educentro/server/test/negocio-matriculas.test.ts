// Matrícula, bajas, vincular tutor y año activo: endpoints transaccionales, reglas, mass-assignment y concurrencia real.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { hoyServidor } from '../src/repo/util-negocio.js';
import { A, B, cerrarPoolApp, consultaAdmin, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
type Err = { error: { codigo: string; mensaje: string; campos?: string[]; [k: string]: unknown } };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
const mat = (est: string, sec: string, extra: Record<string, unknown> = {}) => ({ anioId: 'an1', seccionId: sec, estudianteId: est, ...extra });
const hoy = hoyServidor();

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await sembrar('anios', 'an1', A, { nombre: '2026', inicio: '2026-01-01', fin: '2026-12-31', activo: true });
  await sembrar('anios', 'an2', A, { nombre: '2027', inicio: '2027-01-01', fin: '2027-12-31', activo: false });
  await sembrar('anios', 'anB', B, { nombre: 'B', activo: true });
  await sembrar('cursos', 'cu1', A, { nombre: '2.º', nivel: 'Secundario', grado: 2 });
  await sembrar('secciones', 'sx1', A, { cursoId: 'cu1', anioId: 'an1', nombre: 'X1', capacidad: 2 });
  await sembrar('secciones', 'sx2', A, { cursoId: 'cu1', anioId: 'an1', nombre: 'X2', capacidad: 1 });
  await sembrar('secciones', 'sxLibre', A, { cursoId: 'cu1', anioId: 'an1', nombre: 'XL', capacidad: 30 });
  await sembrar('secciones', 'sy', A, { cursoId: 'cu1', anioId: 'an2', nombre: 'Y' });
  for (let i = 10; i < 60; i++) await sembrar('estudiantes', `e${i}`, A, { nombres: `Est ${i}`, apellidos: 'Prueba' });
  await sembrar('estudiantes', 'eInactivo', A, { nombres: 'Baja', estado: 'inactivo' });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('POST /matriculas', () => {
  it('individual: crea activa con la fecha del servidor y centro de la sesión; el cliente no decide estado ni centro', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e10', 'sx1', { estado: 'retirada', centroId: B }));
    expect(r.statusCode, r.body).toBe(201);
    const d = (r.json() as { datos: Record<string, unknown>[] }).datos[0]!;
    expect(d).toMatchObject({ estudianteId: 'e10', seccionId: 'sx1', anioId: 'an1', estado: 'activa', centroId: A });
    expect(d.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('duplicado en el mismo año → 409 matricula_duplicada; en otro año sí', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e10', 'sxLibre'));
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('matricula_duplicada');
    expect((await pedir(app, S('dirA'), 'POST', '/matriculas', { anioId: 'an2', seccionId: 'sy', estudianteId: 'e10' })).statusCode).toBe(201);
  });
  it('lote: todo o nada; cupo insuficiente → 409 seccion_completa y no se escribe ninguna', async () => {
    const r = await pedir(app, S('secA'), 'POST', '/matriculas', { anioId: 'an1', seccionId: 'sx1', estudianteIds: ['e11', 'e12'] }); // sx1 tiene 2 plazas y 1 ocupada
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('seccion_completa');
    const l = (await pedir(app, S('dirA'), 'GET', '/c/matriculas?f.estudianteId=e11')).json() as { datos: unknown[] };
    expect(l.datos).toHaveLength(0);
    const ok = await pedir(app, S('secA'), 'POST', '/matriculas', { anioId: 'an1', seccionId: 'sx1', estudianteIds: ['e11'] });
    expect(ok.statusCode).toBe(201);
    expect((await pedir(app, S('secA'), 'POST', '/matriculas', { anioId: 'an1', seccionId: 'sx1', estudianteIds: ['e12'] })).statusCode).toBe(409);
  });
  it('lote con un duplicado: 409 con la lista y nada se aplica', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/matriculas', { anioId: 'an1', seccionId: 'sxLibre', estudianteIds: ['e20', 'e10'] });
    expect(r.statusCode).toBe(409);
    expect((err(r).rechazadas as { estudianteId: string }[])[0]!.estudianteId).toBe('e10');
    expect(((await pedir(app, S('dirA'), 'GET', '/c/matriculas?f.estudianteId=e20')).json() as { datos: unknown[] }).datos).toHaveLength(0);
  });
  it('año incoherente con la sección → 409; sección de otro centro → 422; estudiante inactivo/inexistente → 409', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas', { anioId: 'an2', seccionId: 'sxLibre', estudianteId: 'e21' })).codigo).toBe('anio_incoherente');
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e21', 'sB'))).codigo).toBe('referencia_invalida');
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas', mat('eInactivo', 'sxLibre'))).codigo).toBe('estudiante_inactivo');
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas', mat('eB', 'sxLibre'))).codigo).toBe('estudiante_no_encontrado'); // de otro centro
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas', { anioId: 'anB', seccionId: 'sxLibre', estudianteId: 'e21' })).codigo).toBe('referencia_invalida'); // año de otro centro
  });
  it('validación del cuerpo y permisos por rol', async () => {
    expect((await pedir(app, S('dirA'), 'POST', '/matriculas', { seccionId: 'sxLibre', estudianteId: 'e21' })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e21', 'sxLibre', { fecha: '2026-02-31' }))).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/matriculas', { anioId: 'an1', seccionId: 'sxLibre', estudianteIds: ['e21', 'e21'] })).statusCode).toBe(422);
    for (const k of ['docA1', 'tutA', 'estA1']) expect((await pedir(app, S(k), 'POST', '/matriculas', mat('e21', 'sxLibre'))).statusCode, k).toBe(403);
    expect((await pedir(app, null, 'POST', '/matriculas', mat('e21', 'sxLibre'))).statusCode).toBe(401);
    // admin_red: el centro sale de la sección
    expect((await pedir(app, S('admin'), 'POST', '/matriculas', mat('e22', 'sxLibre'))).statusCode).toBe(201);
  });
  it('el índice UNIQUE de la BD impide el duplicado aunque se esquive la API', async () => {
    await expect(sembrar('matriculas', 'dupDirecta', A, { estudianteId: 'e10', anioId: 'an1', seccionId: 'sxLibre', estado: 'activa' }))
      .rejects.toMatchObject({ code: '23505', constraint: 'matriculas_estudiante_anio_uidx' });
  });
  it('CONCURRENCIA: 20 matrículas simultáneas en la última plaza → exactamente 1 gana, 19 reciben 409 seccion_completa', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `e${30 + i}`);
    const rs = await Promise.all(ids.map((e) => pedir(app, S('dirA'), 'POST', '/matriculas', mat(e, 'sx2'))));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const malos = rs.filter((r) => r.statusCode !== 201);
    expect(malos).toHaveLength(19);
    for (const r of malos) expect(err(r).codigo).toBe('seccion_completa');
    expect((await consultaAdmin(`SELECT count(*)::int AS n FROM matriculas WHERE seccion_id = 'sx2' AND estado = 'activa' AND borrado_en IS NULL`))[0]!.n).toBe(1);
  });
  it('CONCURRENCIA: el mismo estudiante matriculado 5 veces a la vez → una sola matrícula', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => pedir(app, S('dirA'), 'POST', '/matriculas', mat('e23', 'sxLibre'))));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.statusCode !== 201)) expect(r.statusCode).toBe(409);
  });
});

describe('retirar y reactivar', () => {
  let id = '';
  beforeAll(async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e24', 'sx1'));
    // sx1 estaba completa (e10 + e11): se libera una plaza para probar el flujo
    expect(r.statusCode).toBe(409);
    const ok = await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e24', 'sxLibre'));
    id = (ok.json() as { datos: { id: string }[] }).datos[0]!.id;
  });
  it('motivo y fecha obligatorios; la fecha no puede ser futura', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', `/matriculas/${id}/retirar`, { fecha: hoy })).campos).toContain('motivo');
    expect(err(await pedir(app, S('dirA'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Traslado' })).campos).toContain('fecha');
    expect(err(await pedir(app, S('dirA'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Traslado', fecha: '2999-01-01' })).codigo).toBe('fecha_futura');
  });
  it('retira, no se puede retirar dos veces y reactiva (limpia motivo y fecha)', async () => {
    const r = await pedir(app, S('secA'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Traslado a otro centro', fecha: hoy });
    expect(r.json()).toMatchObject({ estado: 'retirada', motivoRetiro: 'Traslado a otro centro', fechaRetiro: hoy });
    expect(err(await pedir(app, S('secA'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Otra vez', fecha: hoy })).codigo).toBe('matricula_no_activa');
    const re = await pedir(app, S('secA'), 'POST', `/matriculas/${id}/reactivar`);
    expect(re.statusCode).toBe(200);
    expect(re.json()).toMatchObject({ estado: 'activa' });
    expect(re.json()).not.toHaveProperty('motivoRetiro');
    expect(err(await pedir(app, S('secA'), 'POST', `/matriculas/${id}/reactivar`)).codigo).toBe('matricula_activa');
  });
  it('reactivar con la sección llena → 409 seccion_completa; con el estudiante dado de baja → 409 estudiante_inactivo', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/matriculas', mat('e25', 'sx2')); // sx2 ya está llena (concurrencia)
    expect(r.statusCode).toBe(409);
    await sembrar('matriculas', 'mRet', A, { estudianteId: 'e26', seccionId: 'sx2', anioId: 'an1', estado: 'retirada', fechaRetiro: '2026-03-01', motivoRetiro: 'x' });
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas/mRet/reactivar')).codigo).toBe('seccion_completa');
    await sembrar('estudiantes', 'eBajaM', A, { nombres: 'B', estado: 'inactivo' });
    await sembrar('matriculas', 'mRet2', A, { estudianteId: 'eBajaM', seccionId: 'sxLibre', anioId: 'an1', estado: 'retirada' });
    expect(err(await pedir(app, S('dirA'), 'POST', '/matriculas/mRet2/reactivar')).codigo).toBe('estudiante_inactivo');
  });
  it('otro centro → 404; docente/tutor → 403', async () => {
    expect((await pedir(app, S('dirB'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Traslado', fecha: hoy })).statusCode).toBe(404);
    expect((await pedir(app, S('docA1'), 'POST', `/matriculas/${id}/retirar`, { motivo: 'Traslado', fecha: hoy })).statusCode).toBe(403);
    expect((await pedir(app, S('tutA'), 'POST', `/matriculas/${id}/reactivar`)).statusCode).toBe(403);
  });
  it('CONCURRENCIA: reactivar dos matrículas retiradas en la última plaza → solo una', async () => {
    await sembrar('secciones', 'sUna', A, { cursoId: 'cu1', anioId: 'an1', nombre: 'U', capacidad: 1 });
    await sembrar('matriculas', 'mc1', A, { estudianteId: 'e58', seccionId: 'sUna', anioId: 'an1', estado: 'retirada' });
    await sembrar('matriculas', 'mc2', A, { estudianteId: 'e59', seccionId: 'sUna', anioId: 'an1', estado: 'retirada' });
    const rs = await Promise.all(['mc1', 'mc2', 'mc1', 'mc2'].map((x) => pedir(app, S('dirA'), 'POST', `/matriculas/${x}/reactivar`)));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect((await consultaAdmin(`SELECT count(*)::int AS n FROM matriculas WHERE seccion_id = 'sUna' AND estado = 'activa' AND borrado_en IS NULL`))[0]!.n).toBe(1);
  });
});

describe('mass-assignment en /c/matriculas', () => {
  it('POST genérico: estado forzado a activa (o 422 si pide otro) y con las mismas reglas de cupo', async () => {
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/matriculas', { estudianteId: 'e27', seccionId: 'sxLibre', anioId: 'an1', estado: 'retirada' })).codigo).toBe('campo_protegido');
    const ok = await pedir(app, S('dirA'), 'POST', '/c/matriculas', { estudianteId: 'e27', seccionId: 'sxLibre', anioId: 'an1', fechaRetiro: '2020-01-01', motivoRetiro: 'x' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ estado: 'activa' });
    expect(ok.json()).not.toHaveProperty('motivoRetiro');
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/matriculas', { estudianteId: 'e28', seccionId: 'sx2', anioId: 'an1' })).codigo).toBe('seccion_completa');
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/matriculas', { estudianteId: 'e27', seccionId: 'sxLibre', anioId: 'an1' })).codigo).toBe('matricula_duplicada');
  });
  it('PUT genérico: estado, fechas de retiro, estudiante y año son inmutables; el lote también', async () => {
    const x = ((await pedir(app, S('dirA'), 'GET', '/c/matriculas?f.estudianteId=e27')).json() as { datos: Record<string, unknown>[] }).datos[0]!;
    for (const cambio of [{ estado: 'retirada' }, { fechaRetiro: '2026-01-01' }, { estudianteId: 'e28' }, { anioId: 'an2' }]) {
      const r = await pedir(app, S('dirA'), 'PUT', `/c/matriculas/${x.id}`, { ...x, ...cambio });
      expect(r.statusCode, JSON.stringify(cambio)).toBe(422);
      expect(err(r).codigo).toBe('campo_protegido');
    }
    const lote = await pedir(app, S('dirA'), 'POST', '/c/matriculas/lote', { registros: [{ ...x, estado: 'retirada' }] });
    expect(lote.statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'PUT', `/c/matriculas/${x.id}`, { ...x, observacion: 'ok' })).statusCode).toBe(200);
    const comoActual = await pedir(app, S('dirA'), 'GET', `/c/matriculas/${x.id}`);
    expect(comoActual.json()).toMatchObject({ estado: 'activa' });
  });
  it('traslado de sección por PUT: valida cupo y coherencia de año', async () => {
    const x = ((await pedir(app, S('dirA'), 'GET', '/c/matriculas?f.estudianteId=e27')).json() as { datos: Record<string, unknown>[] }).datos[0]!;
    expect(err(await pedir(app, S('dirA'), 'PUT', `/c/matriculas/${x.id}`, { ...x, seccionId: 'sx2' })).codigo).toBe('seccion_completa');
    expect(err(await pedir(app, S('dirA'), 'PUT', `/c/matriculas/${x.id}`, { ...x, seccionId: 'sy' })).codigo).toBe('anio_incoherente');
  });
});

describe('bajas y vincular tutor', () => {
  it('baja de estudiante: retira su matrícula activa en la misma transacción; segunda baja → 409; el PUT genérico no puede dar de baja', async () => {
    const x = ((await pedir(app, S('dirA'), 'GET', '/c/estudiantes/e27')).json()) as Record<string, unknown>;
    expect(err(await pedir(app, S('dirA'), 'PUT', '/c/estudiantes/e27', { ...x, estado: 'inactivo' })).codigo).toBe('campo_protegido');
    const r = await pedir(app, S('secA'), 'POST', '/estudiantes/e27/baja', { motivo: 'Cambio de domicilio' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'inactivo' });
    const mt = ((await pedir(app, S('dirA'), 'GET', '/c/matriculas?f.estudianteId=e27')).json() as { datos: Record<string, unknown>[] }).datos[0]!;
    expect(mt).toMatchObject({ estado: 'retirada', motivoRetiro: 'Cambio de domicilio' });
    expect(err(await pedir(app, S('secA'), 'POST', '/estudiantes/e27/baja', {})).codigo).toBe('ya_inactivo');
    expect((await pedir(app, S('secA'), 'POST', '/estudiantes/e27/reactivar')).json()).toMatchObject({ estado: 'activo' });
    expect(err(await pedir(app, S('secA'), 'POST', '/estudiantes/e27/reactivar')).codigo).toBe('ya_activo');
  });
  it('baja de docente: bloqueada si tiene cargas; sin cargas pasa; no se asigna una carga a un docente de baja', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/docentes/d1/baja', {});
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('docente_con_cargas');
    await sembrar('docentes', 'dLibre', A, { nombres: 'Libre' });
    expect((await pedir(app, S('dirA'), 'POST', '/docentes/dLibre/baja', {})).statusCode).toBe(200);
    await sembrar('asignaturas', 'asg1', A, { nombre: 'Lengua' });
    expect(err(await pedir(app, S('dirA'), 'POST', '/c/cargas', { docenteId: 'dLibre', seccionId: 'sxLibre', asignaturaId: 'asg1', anioId: 'an1' })).codigo).toBe('docente_inactivo');
  });
  it('baja: permisos (docente 403) y centro ajeno 404', async () => {
    expect((await pedir(app, S('docA1'), 'POST', '/estudiantes/e50/baja', {})).statusCode).toBe(403);
    expect((await pedir(app, S('dirB'), 'POST', '/estudiantes/e50/baja', {})).statusCode).toBe(404);
  });
  it('CONCURRENCIA: asignar una carga a un docente mientras se le da de baja nunca deja un docente inactivo con cargas', async () => {
    for (let i = 0; i < 6; i++) {
      await sembrar('docentes', `dRace${i}`, A, { nombres: `R${i}` });
      await sembrar('asignaturas', `asgR${i}`, A, { nombre: `Materia ${i}` });
      await Promise.all([
        pedir(app, S('dirA'), 'POST', `/docentes/dRace${i}/baja`, {}),
        pedir(app, S('dirA'), 'POST', '/c/cargas', { docenteId: `dRace${i}`, seccionId: 'sxLibre', asignaturaId: `asgR${i}`, anioId: 'an1' }),
      ]);
    }
    const r = await consultaAdmin(`SELECT d.id FROM docentes d WHERE d.id LIKE 'dRace%' AND d.datos->>'estado' = 'inactivo' AND EXISTS (SELECT 1 FROM cargas c WHERE c.docente_id = d.id AND c.borrado_en IS NULL)`);
    expect(r).toHaveLength(0);
  });
  it('vincular y desvincular tutor: idempotente; estudiante de otro centro → 422; inactivo → 409', async () => {
    const r = await pedir(app, S('secA'), 'POST', '/tutores/t1/vincular', { estudianteId: 'e50' });
    expect((r.json() as { estudianteIds: string[] }).estudianteIds).toEqual(['e1', 'e50']);
    expect(((await pedir(app, S('secA'), 'POST', '/tutores/t1/vincular', { estudianteId: 'e50' })).json() as { estudianteIds: string[] }).estudianteIds).toEqual(['e1', 'e50']);
    expect((await pedir(app, S('secA'), 'POST', '/tutores/t1/vincular', { estudianteId: 'eB' })).statusCode).toBe(422);
    expect(err(await pedir(app, S('secA'), 'POST', '/tutores/t1/vincular', { estudianteId: 'eInactivo' })).codigo).toBe('estudiante_inactivo');
    expect(((await pedir(app, S('secA'), 'POST', '/tutores/t1/desvincular', { estudianteId: 'e50' })).json() as { estudianteIds: string[] }).estudianteIds).toEqual(['e1']);
    expect((await pedir(app, S('tutA'), 'POST', '/tutores/t1/vincular', { estudianteId: 'e2' })).statusCode).toBe(403); // el tutor no se vincula solo
    expect((await pedir(app, S('secA'), 'POST', '/tutores/t1/vincular', {})).statusCode).toBe(422);
  });
  it('PUT genérico de tutores: estudianteIds de otro centro o inexistentes → 422', async () => {
    const t = (await pedir(app, S('dirA'), 'GET', '/c/tutores/t2')).json() as Record<string, unknown>;
    expect((await pedir(app, S('dirA'), 'PUT', '/c/tutores/t2', { ...t, estudianteIds: ['eB'] })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'PUT', '/c/tutores/t2', { ...t, estudianteIds: ['e2', 'e2'] })).statusCode).toBe(200);
  });
});

describe('activar año', () => {
  it('activa uno y desactiva el anterior en la misma transacción; el POST/PUT genérico no puede dejar dos activos', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/anios/an2/activar');
    expect(r.json()).toMatchObject({ id: 'an2', activo: true });
    expect(((await pedir(app, S('dirA'), 'GET', '/c/anios/an1')).json() as { activo: boolean }).activo).toBe(false);
    const x = (await pedir(app, S('dirA'), 'GET', '/c/anios/an1')).json() as Record<string, unknown>;
    const dos = await pedir(app, S('dirA'), 'PUT', '/c/anios/an1', { ...x, activo: true });
    expect(dos.statusCode).toBe(409);
    expect(err(dos).codigo).toBe('anio_activo_duplicado');
    expect((await pedir(app, S('dirA'), 'POST', '/c/anios', { nombre: 'Otro', activo: true })).statusCode).toBe(409);
    expect((await pedir(app, S('dirA'), 'POST', '/anios/an1/activar')).statusCode).toBe(200);
  });
  it('CONCURRENCIA: activar 2 años a la vez → siempre queda exactamente uno activo', async () => {
    await Promise.all([pedir(app, S('dirA'), 'POST', '/anios/an1/activar'), pedir(app, S('dirA'), 'POST', '/anios/an2/activar'), pedir(app, S('dirA'), 'POST', '/anios/an1/activar')]);
    expect((await consultaAdmin(`SELECT count(*)::int AS n FROM anios WHERE centro_id = $1 AND activo AND borrado_en IS NULL`, [A]))[0]!.n).toBe(1);
  });
  it('permisos y centro ajeno', async () => {
    expect((await pedir(app, S('docA1'), 'POST', '/anios/an1/activar')).statusCode).toBe(403);
    expect((await pedir(app, S('secA'), 'POST', '/anios/an1/activar')).statusCode).toBe(403);
    expect((await pedir(app, S('dirB'), 'POST', '/anios/an1/activar')).statusCode).toBe(404);
  });
});
