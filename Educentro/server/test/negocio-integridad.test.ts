// Validadores de integridad de la capa genérica (reglas-integridad.ts), centros, usuarios.refId, asistencia, comunicados,
// planes/secuencias (propiedad y estados) y currículo. Cada regla con caso positivo y negativo.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargarCliente } from '../src/domain/cliente-vm.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, consultaAdmin, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
type Err = { error: { codigo: string; mensaje: string; campos?: string[]; errores?: string[]; [k: string]: unknown } };
const err = (r: { json(): unknown }): Err['error'] => (r.json() as Err).error;
const cod = async (p: Promise<{ json(): unknown }>): Promise<string> => err(await p).codigo;
const post = (ses: string, url: string, b: unknown) => pedir(app, S(ses), 'POST', url, b);
const put = (ses: string, url: string, b: unknown) => pedir(app, S(ses), 'PUT', url, b);
const get = async <T = Record<string, unknown>>(ses: string, url: string): Promise<T> => (await pedir(app, S(ses), 'GET', url)).json() as T;

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await sembrar('anios', 'an1', A, { nombre: '2026', inicio: '2026-01-01', fin: '2026-12-31', activo: true });
  await sembrar('cursos', 'cu1', A, { nombre: '1.º', nivel: 'Secundario', grado: 1 });
  await sembrar('asignaturas', 'as1', A, { nombre: 'Lengua' });
  await sembrar('asignaturas', 'as2', A, { nombre: 'Matemática' });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('personas: cédula, código MAT, fechas', () => {
  it('documento: formato 000-0000000-0, se normaliza, único por colección y centro', async () => {
    expect(await cod(post('dirA', '/c/estudiantes', { nombres: 'X', documento: '123' }))).toBe('documento_invalido');
    expect(await cod(post('dirA', '/c/estudiantes', { nombres: 'X', documento: 'abc-1234567-8' }))).toBe('documento_invalido');
    const ok = await post('dirA', '/c/estudiantes', { nombres: 'Doc', documento: '00112345678' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ documento: '001-1234567-8' });
    for (const variante of ['001-1234567-8', '00112345678', '001-12345678']) {
      const r = await post('dirA', '/c/estudiantes', { nombres: 'Dup', documento: variante });
      expect(r.statusCode, variante).toBe(409);
      expect(err(r).codigo).toBe('documento_duplicado');
    }
    expect((await post('dirA', '/c/docentes', { nombres: 'Mismo doc, otra colección', documento: '001-1234567-8' })).statusCode).toBe(201);
    expect((await post('dirB', '/c/estudiantes', { nombres: 'Otro centro', documento: '001-1234567-8' })).statusCode).toBe(201);
    expect((await post('dirA', '/c/estudiantes', { nombres: 'Sin documento' })).statusCode).toBe(201);
    expect((await post('dirA', '/c/estudiantes', { nombres: 'Doc vacío', documento: '' })).statusCode).toBe(201);
  });
  it('la BD impide el duplicado y el documento mal formado aunque se esquive la API', async () => {
    await expect(sembrar('estudiantes', 'dupDoc', A, { documento: '001-1234567-8' })).rejects.toMatchObject({ code: '23505', constraint: 'estudiantes_documento_uidx' });
    await expect(sembrar('estudiantes', 'malDoc', A, { documento: '12345' })).rejects.toMatchObject({ code: '23514' });
  });
  it('código de matrícula: lo asigna el servidor (MAT-<centro>-<n> creciente), ignora el del cliente y no se edita', async () => {
    await sembrar('estudiantes', 'eMax', A, { nombres: 'Con código', matricula: 'MAT-0-2500' });
    const a = (await post('dirA', '/c/estudiantes', { nombres: 'A', matricula: 'MAT-0-9' })).json() as { id: string; matricula: string };
    const b = (await post('dirA', '/c/estudiantes', { nombres: 'B' })).json() as { id: string; matricula: string };
    expect(a.matricula).toMatch(/^MAT-0-\d+$/);
    expect(Number(a.matricula.split('-')[2])).toBeGreaterThan(2500);
    expect(Number(b.matricula.split('-')[2])).toBe(Number(a.matricula.split('-')[2]) + 1);
    expect(err(await put('dirA', `/c/estudiantes/${a.id}`, { ...a, matricula: 'MAT-0-1' })).codigo).toBe('campo_protegido');
    expect((await put('dirA', `/c/estudiantes/${a.id}`, { ...a, nombres: 'A2' })).statusCode).toBe(200);
  });
  it('CONCURRENCIA: 15 altas simultáneas → 15 códigos MAT distintos', async () => {
    const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => post('dirA', '/c/estudiantes', { nombres: `Par ${i}` })));
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);
    const codigos = rs.map((r) => (r.json() as { matricula: string }).matricula);
    expect(new Set(codigos).size).toBe(15);
  });
  it('lote /c/estudiantes/lote: cada alta recibe su código; fecha de nacimiento y correo se validan', async () => {
    const r = await post('dirA', '/c/estudiantes/lote', { registros: [{ id: 'lt_a', nombres: 'L1' }, { id: 'lt_b', nombres: 'L2' }] });
    const cs = (r.json() as { datos: { matricula: string }[] }).datos.map((x) => x.matricula);
    expect(new Set(cs).size).toBe(2);
    expect(await cod(post('dirA', '/c/estudiantes', { nombres: 'F', fechaNacimiento: '2999-01-01' }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/estudiantes', { nombres: 'F', fechaNacimiento: '1800-01-01' }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/estudiantes', { nombres: 'F', fechaNacimiento: '2010-13-01' }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/docentes', { nombres: 'F', email: 'no-es-correo' }))).toBe('datos_invalidos');
    expect((await post('dirA', '/c/docentes', { nombres: 'F', email: 'ok@correo.test' })).statusCode).toBe(201);
  });
  it('mass-assignment: estado de una ficha nueva solo «activo»; el PUT no da de baja ni reactiva', async () => {
    expect(await cod(post('dirA', '/c/docentes', { nombres: 'X', estado: 'inactivo' }))).toBe('campo_protegido');
    const d = await get('dirA', '/c/docentes/d2');
    expect(await cod(put('dirA', '/c/docentes/d2', { ...d, estado: 'inactivo', fechaBaja: '2026-01-01' }))).toBe('campo_protegido');
    expect((await put('dirA', '/c/docentes/d2', { ...d, estado: 'activo' })).statusCode).toBe(200);
  });
  it('borrado: estudiante con matrículas y docente con cargas → 409 tiene_dependencias', async () => {
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/estudiantes/e1'))).toBe('tiene_dependencias');
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/docentes/d1'))).toBe('tiene_dependencias');
  });
});

describe('configuración académica', () => {
  it('periodos: peso 0,01–100, suma ≤ 100, orden único por año (BD), fechas dentro del año, no borrar con actividades', async () => {
    const base = { anioId: 'an1', nombre: 'P', inicio: '2026-01-10', fin: '2026-04-10' };
    expect(await cod(post('dirA', '/c/periodos', { ...base, orden: 1, peso: 0 }))).toBe('fuera_de_rango');
    expect(await cod(post('dirA', '/c/periodos', { ...base, orden: 1, peso: 100.5 }))).toBe('fuera_de_rango');
    const p1 = await post('dirA', '/c/periodos', { ...base, id: 'pp1', orden: 1, peso: 60 });
    expect(p1.statusCode, p1.body).toBe(201);
    const r2 = await post('dirA', '/c/periodos', { ...base, id: 'pp2', orden: 2, peso: 41 });
    expect(r2.statusCode).toBe(422);
    expect(err(r2).codigo).toBe('suma_pesos_excedida');
    expect((await post('dirA', '/c/periodos', { ...base, id: 'pp2', orden: 2, peso: 39 })).statusCode).toBe(201);
    const dup = await post('dirA', '/c/periodos', { ...base, orden: 2, peso: 0.01 });
    expect(dup.statusCode).toBe(409);
    expect(err(dup).codigo).toBe('periodo_orden_duplicado');
    expect(await cod(post('dirA', '/c/periodos', { ...base, orden: 3, peso: 0.01, inicio: '2025-01-01' }))).toBe('datos_invalidos');
    const x = await get('dirA', '/c/periodos/pp1');
    expect(await cod(put('dirA', '/c/periodos/pp1', { ...x, peso: 70 }))).toBe('suma_pesos_excedida');
    await sembrar('actividades', 'actPer', A, { cargaId: 'cg1', periodoId: 'pp1', nombre: 'a', puntosMax: 10 });
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/periodos/pp1'))).toBe('tiene_dependencias');
    expect((await pedir(app, S('dirA'), 'DELETE', '/c/periodos/pp2')).statusCode).toBe(204);
  });
  it('CONCURRENCIA: dos periodos de 60 a la vez en el mismo año → la suma nunca pasa de 100', async () => {
    const base = { anioId: 'an1', nombre: 'R', inicio: '2026-05-01', fin: '2026-06-01' };
    await Promise.all([post('dirA', '/c/periodos', { ...base, orden: 5, peso: 40 }), post('dirA', '/c/periodos', { ...base, orden: 6, peso: 40 }), post('dirA', '/c/periodos', { ...base, orden: 7, peso: 40 })]);
    const filas = await consultaAdmin<{ s: string }>(`SELECT coalesce(sum(peso),0)::text AS s FROM periodos WHERE anio_id = 'an1' AND borrado_en IS NULL`);
    expect(Number(filas[0]!.s)).toBeLessThanOrEqual(100);
  });
  it('secciones: capacidad 1–60, nombre único por curso y año (sin distinguir mayúsculas), no menor que las activas, no borrar con matrículas o cargas', async () => {
    expect(await cod(post('dirA', '/c/secciones', { cursoId: 'cu1', anioId: 'an1', nombre: 'A', capacidad: 0 }))).toBe('fuera_de_rango');
    expect(await cod(post('dirA', '/c/secciones', { cursoId: 'cu1', anioId: 'an1', nombre: 'A', capacidad: 61 }))).toBe('fuera_de_rango');
    expect(await cod(post('dirA', '/c/secciones', { cursoId: 'cuNo', anioId: 'an1', nombre: 'A' }))).toBe('referencia_invalida');
    expect((await post('dirA', '/c/secciones', { id: 'sv1', cursoId: 'cu1', anioId: 'an1', nombre: 'Z', capacidad: 5 })).statusCode).toBe(201);
    for (const nombre of ['Z', 'z', ' Z ']) expect(await cod(post('dirA', '/c/secciones', { cursoId: 'cu1', anioId: 'an1', nombre }))).toBe('seccion_duplicada');
    expect((await post('dirA', '/c/secciones', { cursoId: 'cu1', anioId: 'anOtro', nombre: 'Z' })).statusCode).toBe(422);
    await sembrar('matriculas', 'mv1', A, { estudianteId: 'e1', seccionId: 'sv1', anioId: 'an1', estado: 'activa' });
    await sembrar('matriculas', 'mv2', A, { estudianteId: 'e2', seccionId: 'sv1', anioId: 'an1', estado: 'activa' });
    const s = await get('dirA', '/c/secciones/sv1');
    expect(await cod(put('dirA', '/c/secciones/sv1', { ...s, capacidad: 1 }))).toBe('capacidad_menor_ocupacion');
    expect((await put('dirA', '/c/secciones/sv1', { ...s, capacidad: 2 })).statusCode).toBe(200);
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/secciones/sv1'))).toBe('tiene_dependencias');
    await sembrar('secciones', 'svCarga', A, { cursoId: 'cu1', anioId: 'an1', nombre: 'C' });
    await sembrar('cargas', 'cgv', A, { seccionId: 'svCarga', asignaturaId: 'as1', docenteId: 'd1', anioId: 'an1' });
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/secciones/svCarga'))).toBe('tiene_dependencias');
  });
  it('cursos: grado 1–6 y no borrar con secciones; asignaturas: no borrar con cargas', async () => {
    for (const g of [0, 7, 2.5, 'x']) expect(await cod(post('dirA', '/c/cursos', { nombre: 'C', grado: g })), String(g)).toBe('fuera_de_rango');
    expect((await post('dirA', '/c/cursos', { nombre: '3.º', grado: 3 })).statusCode).toBe(201);
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/cursos/cu1'))).toBe('tiene_dependencias');
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/asignaturas/as1'))).toBe('tiene_dependencias');
    expect((await pedir(app, S('dirA'), 'DELETE', '/c/asignaturas/as2')).statusCode).toBe(204);
  });
  it('cargas: (sección, asignatura) única por BD, referencias del centro, no borrar con categorías/actividades', async () => {
    const dup = await post('dirA', '/c/cargas', { seccionId: 'svCarga', asignaturaId: 'as1', docenteId: 'd2', anioId: 'an1' });
    expect(dup.statusCode).toBe(409);
    expect(err(dup).codigo).toBe('carga_duplicada');
    expect(await cod(post('dirA', '/c/cargas', { seccionId: 'sB', asignaturaId: 'as1', docenteId: 'd1' }))).toBe('referencia_invalida');
    expect(await cod(post('dirA', '/c/cargas', { seccionId: 'svCarga', asignaturaId: 'asNo', docenteId: 'd1' }))).toBe('referencia_invalida');
    expect(await cod(post('dirA', '/c/cargas', { seccionId: 'svCarga', asignaturaId: 'as1', docenteId: 'dB' }))).not.toBe('');
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/cargas/cg1'))).toBe('tiene_dependencias'); // tiene categorías y actividades
    expect(await cod(post('dirA', '/c/cargas', { seccionId: 'svCarga', asignaturaId: 'as9', docenteId: 'd1', horasSemana: 99 }))).not.toBe('');
  });
  it('escalas: min<max, nota mínima dentro, tramos válidos, una sola activa por centro', async () => {
    const e = { nombre: 'E', min: 0, max: 100, notaMinAprobar: 70, tramos: [{ desde: 0, etiqueta: 'Bajo' }, { desde: 70, etiqueta: 'Alto' }] };
    expect(await cod(post('dirA', '/c/escalas', { ...e, min: 100, max: 100, activa: false }))).toBe('escala_invalida');
    expect(await cod(post('dirA', '/c/escalas', { ...e, notaMinAprobar: 120, activa: false }))).toBe('escala_invalida');
    expect(await cod(post('dirA', '/c/escalas', { ...e, tramos: [{ desde: 10, etiqueta: 'x' }], activa: false }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/escalas', { ...e, tramos: [{ desde: 0 }, { desde: 0 }], activa: false }))).toBe('datos_invalidos');
    expect((await post('dirA', '/c/escalas', { ...e, activa: false })).statusCode).toBe(201);
    expect((await post('dirA', '/c/escalas', { ...e, activa: true })).statusCode).toBe(201);
    const otra = await post('dirA', '/c/escalas', { ...e, activa: true });
    expect(otra.statusCode).toBe(409);
    expect(err(otra).codigo).toBe('escala_activa_duplicada');
  });
  it('años: fechas válidas y fin posterior; no borrar con periodos', async () => {
    expect(await cod(post('dirA', '/c/anios', { nombre: 'X', inicio: '2027-05-01', fin: '2027-01-01', activo: false }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/anios', { nombre: 'X', inicio: '2027-02-30', activo: false }))).toBe('datos_invalidos');
    expect(await cod(pedir(app, S('dirA'), 'DELETE', '/c/anios/an1'))).toBe('tiene_dependencias');
  });
});

describe('centros y usuarios', () => {
  it('un centro nuevo nace con su escala por defecto (misma transacción); borrarlo vacío limpia su configuración', async () => {
    const c = (await post('admin', '/c/centros', { nombre: 'Centro C' })).json() as { id: string };
    const escalas = await consultaAdmin(`SELECT datos FROM escalas WHERE centro_id = $1 AND borrado_en IS NULL`, [c.id]);
    expect(escalas).toHaveLength(1);
    expect((escalas[0] as { datos: Record<string, unknown> }).datos).toMatchObject({ activa: true, min: 0, max: 100 });
    await sembrar('asignaturas', 'asC', c.id, { nombre: 'X' });
    expect((await pedir(app, S('admin'), 'DELETE', `/c/centros/${c.id}`)).statusCode).toBe(204);
    expect(await consultaAdmin(`SELECT 1 FROM escalas WHERE centro_id = $1 AND borrado_en IS NULL`, [c.id])).toHaveLength(0);
    expect(await consultaAdmin(`SELECT 1 FROM asignaturas WHERE centro_id = $1 AND borrado_en IS NULL`, [c.id])).toHaveLength(0);
  });
  it('un centro con datos no se elimina (409 centro_con_datos, con el detalle); con usuarios tampoco', async () => {
    const r = await pedir(app, S('admin'), 'DELETE', `/c/centros/${A}`);
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('centro_con_datos');
    expect(err(r).dependencias).toBeTruthy();
    const c = (await post('admin', '/c/centros', { nombre: 'Con usuario' })).json() as { id: string };
    await owner().query(`INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash) VALUES ('usC', $1, 'director', 'D', 'usc@prueba.test', 'x')`, [c.id]);
    expect(await cod(pedir(app, S('admin'), 'DELETE', `/c/centros/${c.id}`))).toBe('centro_con_datos');
  });
  it('usuarios: refId coherente con el rol y el centro', async () => {
    const u = (n: string, rol: string, refId: string | null) => ({ nombre: 'U', email: `${n}@prueba.test`, rol, refId });
    expect(await cod(post('dirA', '/c/usuarios', u('r1', 'docente', 't1')))).toBe('ref_incoherente'); // t1 es tutor
    expect(await cod(post('dirA', '/c/usuarios', u('r2', 'docente', 'dB')))).toBe('ref_incoherente'); // de otro centro
    expect(await cod(post('dirA', '/c/usuarios', u('r3', 'docente', 'noExiste')))).toBe('ref_incoherente');
    expect(await cod(post('dirA', '/c/usuarios', u('r4', 'secretaria', 'd1')))).toBe('ref_incoherente');
    expect((await post('dirA', '/c/usuarios', u('r5', 'docente', 'd2'))).statusCode).toBe(201);
    expect((await post('dirA', '/c/usuarios', u('r6', 'tutor', 't2'))).statusCode).toBe(201);
    expect((await post('dirA', '/c/usuarios', u('r7', 'estudiante', 'e2'))).statusCode).toBe(201);
    expect((await post('dirA', '/c/usuarios', u('r8', 'secretaria', null))).statusCode).toBe(201);
    const nuevo = ((await post('dirA', '/c/usuarios', u('r9', 'docente', null))).json()) as { id: string; actualizadoEn: string };
    expect(await cod(put('dirA', `/c/usuarios/${nuevo.id}`, { refId: 'e1' }))).toBe('ref_incoherente');
    expect((await put('dirA', `/c/usuarios/${nuevo.id}`, { refId: 'd1' })).statusCode).toBe(200);
  });
});

describe('asistencia', () => {
  const dia = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10);
  it('fecha válida y no futura; estudiante con matrícula activa en la sección; estado P/A/T/J', async () => {
    const base = { seccionId: 's1', estudianteId: 'e1', estado: 'P' };
    expect(await cod(post('docA1', '/c/asistencia', { ...base, fecha: '2999-01-01' }))).toBe('fecha_futura');
    expect(await cod(post('docA1', '/c/asistencia', { ...base, fecha: '2026-02-30' }))).toBe('fecha_invalida');
    expect(await cod(post('docA1', '/c/asistencia', { ...base, fecha: dia(5), estado: 'Z' }))).toBe('datos_invalidos');
    expect(await cod(post('docA1', '/c/asistencia', { seccionId: 's1', estudianteId: 'e2', estado: 'P', fecha: dia(5) }))).toBe('estudiante_no_matriculado');
    expect(await cod(post('docA2', '/c/asistencia', { ...base, fecha: dia(5) }))).toBe('sin_permiso');
    const ok = await post('docA1', '/c/asistencia', { ...base, fecha: dia(5) });
    expect(ok.statusCode, ok.body).toBe(201);
  });
  it('autoría y fechas las fija el servidor: registradoPor/justificadoPor del cliente se ignoran; J exige justificación', async () => {
    const r = await post('docA1', '/c/asistencia', { seccionId: 's1', estudianteId: 'e1', estado: 'A', fecha: dia(6), registradoPor: 'usr_falso', registradoEn: '1999-01-01T00:00:00Z', justificadoPor: 'usr_falso' });
    const x = r.json() as Record<string, unknown>;
    expect(x.registradoPor).toBe(S('docA1').id);
    expect(x.registradoEn).not.toBe('1999-01-01T00:00:00Z');
    expect(x).not.toHaveProperty('justificadoPor');
    expect(await cod(put('docA1', `/c/asistencia/${x.id}`, { ...x, estado: 'J' }))).toBe('justificacion_requerida');
    const j = (await put('docA1', `/c/asistencia/${x.id}`, { ...x, estado: 'J', justificacion: 'Certificado médico', justificadoPor: 'usr_falso', registradoPor: 'usr_falso' })).json() as Record<string, unknown>;
    expect(j).toMatchObject({ estado: 'J', justificadoPor: S('docA1').id, registradoPor: S('docA1').id });
    expect(typeof j.justificadoEn).toBe('string');
    expect(await cod(put('docA1', `/c/asistencia/${x.id}`, { ...j, fecha: dia(7) }))).toBe('campo_inmutable');
  });
  it('POST /asistencia/seccion-fecha: lote atómico (un estudiante no matriculado deshace todo), reutiliza el registro del día', async () => {
    await sembrar('matriculas', 'mAs', A, { estudianteId: 'e3', seccionId: 's1', anioId: 'an1', estado: 'activa' });
    await sembrar('estudiantes', 'e3', A, { nombres: 'Tres' });
    const f = dia(8);
    const mal = await post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }, { estudianteId: 'e2', estado: 'A' }] });
    expect(mal.statusCode).toBe(409);
    expect(((await get<{ datos: unknown[] }>('dirA', `/c/asistencia?f.fecha=${f}`))).datos).toHaveLength(0);
    const ok = await post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'T' }, { estudianteId: 'e3', estado: 'J', justificacion: 'Duelo familiar' }] });
    expect(ok.statusCode, ok.body).toBe(200);
    const otra = await post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }] });
    expect(otra.statusCode).toBe(200);
    const lista = (await get<{ datos: Record<string, unknown>[] }>('dirA', `/c/asistencia?f.fecha=${f}`)).datos;
    expect(lista).toHaveLength(2);
    expect(lista.find((x) => x.estudianteId === 'e1')).toMatchObject({ estado: 'P', registradoPor: S('docA1').id });
    expect(await cod(post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: '2999-01-01', registros: [{ estudianteId: 'e1', estado: 'P' }] }))).toBe('fecha_futura');
    expect(await cod(post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'J' }] }))).toBe('justificacion_requerida');
    expect(await cod(post('docA1', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }, { estudianteId: 'e1', estado: 'A' }] }))).toBe('datos_invalidos');
    expect((await post('docA2', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }] })).statusCode).toBe(404); // la sección no es de su alcance: ni existe para él
    expect((await post('tutA', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }] })).statusCode).toBe(403);
    expect((await post('dirB', '/asistencia/seccion-fecha', { seccionId: 's1', fecha: f, registros: [{ estudianteId: 'e1', estado: 'P' }] })).statusCode).toBe(422);
  });
  it('justificar / quitar justificación por endpoint', async () => {
    const x = (await post('docA1', '/c/asistencia', { seccionId: 's1', estudianteId: 'e1', estado: 'A', fecha: dia(9) })).json() as { id: string };
    expect(await cod(post('docA1', `/asistencia/${x.id}/justificar`, {}))).toBe('justificacion_requerida');
    const j = (await post('docA1', `/asistencia/${x.id}/justificar`, { justificacion: 'Cita médica' })).json() as Record<string, unknown>;
    expect(j).toMatchObject({ estado: 'J', justificadoPor: S('docA1').id });
    const q = (await post('docA1', `/asistencia/${x.id}/quitar-justificacion`, {})).json() as Record<string, unknown>;
    expect(q.estado).toBe('A');
    expect(q).not.toHaveProperty('justificacion');
    expect(await cod(post('docA1', `/asistencia/${x.id}/quitar-justificacion`, {}))).toBe('estado_no_justificable');
    expect((await post('docA2', `/asistencia/${x.id}/justificar`, { justificacion: 'x y z' })).statusCode).toBe(404);
  });
});

describe('planes y secuencias: propiedad y estados', () => {
  let planId = '';
  let secId = '';
  it('secuencias: el docente solo gestiona las de SUS cargas', async () => {
    const mia = await post('docA1', '/c/secuencias', { cargaId: 'cg1', titulo: 'Mi secuencia', indicadoresLogro: [{ uid: 'i1', texto: 'a' }, { uid: 'i2', texto: 'b' }], estado: 'borrador' });
    expect(mia.statusCode, mia.body).toBe(201);
    secId = (mia.json() as { id: string }).id;
    expect((await post('docA1', '/c/secuencias', { cargaId: 'cg2', titulo: 'Ajena' })).statusCode).toBe(403);
    const x = await get('docA1', `/c/secuencias/${secId}`);
    expect((await put('docA2', `/c/secuencias/${secId}`, { ...x, titulo: 'Robo' })).statusCode).toBe(403);
    expect((await pedir(app, S('docA2'), 'DELETE', `/c/secuencias/${secId}`)).statusCode).toBe(403);
    expect(await cod(put('docA1', `/c/secuencias/${secId}`, { ...x, cargaId: 'cg2' }))).not.toBe('');
    expect(await cod(post('dirA', '/c/secuencias', { cargaId: 'cgB', titulo: 'x' }))).toBe('referencia_invalida');
    expect(await cod(post('dirA', '/c/secuencias', { cargaId: 'cg1', titulo: 'x', curriculoVersionId: 'noExiste' }))).toBe('referencia_invalida');
    expect(await cod(post('dirA', '/c/secuencias', { cargaId: 'cg1', titulo: 'x', fechaInicio: '2026-03-01', fechaFin: '2026-02-01' }))).toBe('datos_invalidos');
  });
  it('planes: transiciones borrador → listo → impartido; el docente no salta ni crea «impartido»; indicadores solo con secuencia de la misma carga', async () => {
    const base = { cargaId: 'cg1', tema: 'Tema', fecha: '2026-03-02' };
    expect(await cod(post('docA1', '/c/planes', { ...base, estado: 'impartido' }))).toBe('transicion_invalida');
    const p = await post('docA1', '/c/planes', { ...base, estado: 'borrador', docenteId: 'd2' });
    expect(p.statusCode, p.body).toBe(201);
    planId = (p.json() as { id: string }).id;
    expect((p.json() as { docenteId: string }).docenteId).toBe('d1'); // el docente no decide la autoría
    const x = await get('docA1', `/c/planes/${planId}`);
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, estado: 'impartido' }))).toBe('transicion_invalida');
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, indicadorIds: ['i1'] }))).toBe('indicador_sin_secuencia');
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, secuenciaId: 'noExiste' }))).toBe('referencia_invalida');
    const otraCarga = (await post('docA2', '/c/secuencias', { cargaId: 'cg2', titulo: 'De cg2', indicadoresLogro: [{ uid: 'z1' }] })).json() as { id: string };
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, secuenciaId: otraCarga.id }))).toBe('secuencia_incoherente');
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, secuenciaId: secId, indicadorIds: ['i1', 'noEsDeLaSecuencia'] }))).toBe('indicador_invalido');
    expect((await put('docA1', `/c/planes/${planId}`, { ...x, secuenciaId: secId, indicadorIds: ['i1'] })).statusCode).toBe(200);
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, fecha: '2026-03-07' }))).toBe('dia_no_lectivo'); // sábado
    expect(await cod(put('docA1', `/c/planes/${planId}`, { ...x, fecha: '2026-02-30' }))).toBe('datos_invalidos');
    const ya = await get('docA1', `/c/planes/${planId}`);
    expect((await put('docA1', `/c/planes/${planId}`, { ...ya, estado: 'listo' })).statusCode).toBe(200);
    expect((await put('docA1', `/c/planes/${planId}`, { ...ya, estado: 'impartido' })).statusCode).toBe(200);
  });
  it('plan impartido: el docente no lo edita ni lo borra; el director sí; plan de otro docente → 403', async () => {
    const x = await get('docA1', `/c/planes/${planId}`);
    const r = await put('docA1', `/c/planes/${planId}`, { ...x, tema: 'Cambio' });
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('plan_impartido');
    expect(await cod(pedir(app, S('docA1'), 'DELETE', `/c/planes/${planId}`))).toBe('plan_impartido');
    expect((await put('docA2', `/c/planes/${planId}`, { ...x, tema: 'Robo' })).statusCode).toBe(404); // ni lo ve
    expect((await put('dirA', `/c/planes/${planId}`, { ...x, tema: 'Corregido por dirección' })).statusCode).toBe(200);
    expect((await put('dirA', `/c/planes/${planId}`, { ...x, estado: 'listo' })).statusCode).toBe(200);
  });
  it('eliminar una secuencia desvincula sus planes (cascada transaccional, también los impartidos)', async () => {
    const x = await get('dirA', `/c/planes/${planId}`);
    await put('dirA', `/c/planes/${planId}`, { ...x, estado: 'impartido' });
    expect((await pedir(app, S('docA1'), 'DELETE', `/c/secuencias/${secId}`)).statusCode).toBe(204);
    const p = await get('dirA', `/c/planes/${planId}`);
    expect(p.secuenciaId).toBeNull();
    expect(p.indicadorIds).toEqual([]);
    expect(p.estado).toBe('impartido');
  });
});

describe('comunicados: autoría, fecha, segmento y lecturas fijadas por el servidor', () => {
  it('crear: autorId y fecha del servidor; borrador→publicado fija fecha y publicadoEn; los contadores del cliente se ignoran', async () => {
    const r = await post('dirA', '/c/comunicados', { titulo: 'Aviso', cuerpo: 'Cuerpo del aviso', destinatarios: 'todos', estado: 'borrador', autorId: 'usr_falso', fecha: '1999-01-01', totalLeidos: 99, lecturas: [{ usuarioId: 'x' }] });
    expect(r.statusCode, r.body).toBe(201);
    const x = r.json() as Record<string, unknown>;
    expect(x.autorId).toBe(S('dirA').id);
    expect(x.fecha).not.toBe('1999-01-01');
    expect(x).not.toHaveProperty('totalLeidos');
    expect(x).not.toHaveProperty('lecturas');
    const pub = (await put('secA', `/c/comunicados/${x.id}`, { ...x, estado: 'publicado', autorId: 'usr_otro', fecha: '1999-01-01' })).json() as Record<string, unknown>;
    expect(pub).toMatchObject({ estado: 'publicado', autorId: S('dirA').id });
    expect(String(pub.fecha)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pub.fecha).not.toBe('1999-01-01');
    expect(typeof pub.publicadoEn).toBe('string');
    const fijada = pub.fecha;
    expect((await put('dirA', `/c/comunicados/${x.id}`, { ...pub, titulo: 'Aviso 2', fecha: '2000-01-01' })).json()).toMatchObject({ fecha: fijada });
  });
  it('segmento: debe existir en el centro y ser coherente; destinatarios y estado válidos; lecturas no se escriben por PUT', async () => {
    const b = { titulo: 'Seg', cuerpo: 'Mensaje largo', estado: 'borrador' };
    expect(await cod(post('dirA', '/c/comunicados', { ...b, destinatarios: 'todos', segmento: { tipo: 'seccion', id: 'noExiste' } }))).toBe('segmento_inexistente');
    expect(await cod(post('dirA', '/c/comunicados', { ...b, destinatarios: 'todos', segmento: { tipo: 'curso', id: 'cuB' } }))).toBe('segmento_inexistente');
    expect(await cod(post('dirA', '/c/comunicados', { ...b, destinatarios: 'todos', segmento: { tipo: 'planeta', id: 'x' } }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/comunicados', { ...b, destinatarios: 'madres' }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/comunicados', { ...b, destinatarios: 'docentes', segmento: { tipo: 'tutor', id: 't1' } }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/comunicados', { ...b, titulo: 'ab', destinatarios: 'todos' }))).toBe('datos_invalidos');
    expect((await post('dirA', '/c/comunicados', { ...b, destinatarios: 'todos', segmento: { tipo: 'seccion', id: 's1' } })).statusCode).toBe(201);
    expect((await post('dirA', '/c/comunicados', { ...b, destinatarios: 'tutores', segmento: { tipo: 'tutor', id: 't1' } })).statusCode).toBe(201);
    const co1 = await get('dirA', '/c/comunicados/co1');
    const r = await put('dirA', '/c/comunicados/co1', { ...co1, lecturas: [{ usuarioId: 'falso', fecha: 'x' }] });
    expect((r.json() as { lecturas: { usuarioId: string }[] }).lecturas.map((l) => l.usuarioId)).toEqual(['otro']);
  });
});

describe('currículo: versión vigente, solo lectura, verificación, importación atómica', () => {
  const doc = cargarCliente(['core/formato.js', 'data/curriculo-semilla.js']).edu.curriculoSemilla as { DOC: unknown; hashItems(i: unknown): string; aplanar(d: unknown): unknown[] };
  let v1 = '';
  let v2 = '';
  it('crear versión: siempre borrador; el cliente no fija estado, hash ni total', async () => {
    expect(await cod(post('dirA', '/c/curriculoVersiones', { nombre: 'V', estado: 'vigente' }))).toBe('campo_protegido');
    const a = (await post('dirA', '/c/curriculoVersiones', { nombre: 'V1', hash: 'falso', total: 99 })).json() as Record<string, unknown>;
    expect(a).toMatchObject({ estado: 'borrador' });
    expect(a).not.toHaveProperty('hash');
    v1 = a.id as string;
    v2 = ((await post('dirA', '/c/curriculoVersiones', { nombre: 'V2' })).json() as { id: string }).id;
  });
  it('contenidos: verificado exige fuente http(s) y fecha válida; el hash/total de la versión los calcula el servidor', async () => {
    const c = { versionId: v1, clave: 'k1', tipo: 'competencia_fundamental', descripcion: 'Desc' };
    expect(await cod(post('dirA', '/c/curriculoContenidos', { ...c, estado: 'verificado', fecha: '2026-01-01' }))).toBe('fuente_requerida');
    expect(await cod(post('dirA', '/c/curriculoContenidos', { ...c, estado: 'verificado', fuente: 'ftp://x', fecha: '2026-01-01' }))).toBe('fuente_requerida');
    expect(await cod(post('dirA', '/c/curriculoContenidos', { ...c, estado: 'verificado', fuente: 'https://minerd.gob.do/x', fecha: 'ayer' }))).toBe('fecha_invalida');
    expect(await cod(post('dirA', '/c/curriculoContenidos', { ...c, estado: 'raro' }))).toBe('datos_invalidos');
    expect(await cod(post('dirA', '/c/curriculoContenidos', { ...c, versionId: 'noExiste' }))).toBe('referencia_invalida');
    expect((await post('dirA', '/c/curriculoContenidos', { ...c, estado: 'verificado', fuente: 'https://minerd.gob.do/x', fecha: '2026-01-01' })).statusCode).toBe(201);
    expect((await post('dirA', '/c/curriculoContenidos', { ...c, clave: 'k2', estado: 'pendiente' })).statusCode).toBe(201);
    const v = await get('dirA', `/c/curriculoVersiones/${v1}`);
    const r = (await put('dirA', `/c/curriculoVersiones/${v1}`, { ...v, nombre: 'V1b', hash: 'falso', total: 0 })).json() as { hash: string; total: number };
    expect(r.total).toBe(2);
    expect(r.hash).not.toBe('falso');
    expect(await cod(put('dirA', `/c/curriculoVersiones/${v1}`, { ...v, estado: 'vigente' }))).toBe('campo_protegido');
  });
  it('POST /curriculo/versiones/:id/vigente: transaccional (la vigente pasa a anterior); la anterior es de solo lectura; la vigente no se elimina', async () => {
    const r1 = (await post('dirA', `/curriculo/versiones/${v1}/vigente`, {})).json() as { version: Record<string, unknown>; anterior: string | null };
    expect(r1.version).toMatchObject({ estado: 'vigente' });
    expect(r1.anterior).toBeNull();
    const r2 = (await post('dirA', `/curriculo/versiones/${v2}/vigente`, {})).json() as { anterior: string };
    expect(r2.anterior).toBe(v1);
    expect((await get('dirA', `/c/curriculoVersiones/${v1}`)).estado).toBe('anterior');
    const vigentes = await consultaAdmin(`SELECT id FROM curriculo_versiones WHERE centro_id = $1 AND estado = 'vigente' AND borrado_en IS NULL`, [A]);
    expect(vigentes).toHaveLength(1);
    // solo lectura
    const a = await get('dirA', `/c/curriculoVersiones/${v1}`);
    expect(await cod(put('dirA', `/c/curriculoVersiones/${v1}`, { ...a, nombre: 'cambio' }))).toBe('version_anterior_solo_lectura');
    expect(await cod(post('dirA', '/c/curriculoContenidos', { versionId: v1, clave: 'k9', tipo: 'x', descripcion: 'd', estado: 'pendiente' }))).toBe('version_anterior_solo_lectura');
    expect(await cod(pedir(app, S('dirA'), 'DELETE', `/c/curriculoVersiones/${v2}`))).toBe('version_vigente_no_eliminable');
    expect((await post('dirA', `/curriculo/versiones/${v2}/vigente`, {})).statusCode).toBe(200); // idempotente
    expect((await post('docA1', `/curriculo/versiones/${v1}/vigente`, {})).statusCode).toBe(403);
    expect((await post('dirB', `/curriculo/versiones/${v1}/vigente`, {})).statusCode).toBe(404);
  });
  it('CONCURRENCIA: marcar vigentes distintas a la vez → siempre una sola vigente', async () => {
    const ids = [v1, v2, ((await post('dirA', '/c/curriculoVersiones', { nombre: 'V3' })).json() as { id: string }).id];
    await Promise.all(ids.map((id) => post('dirA', `/curriculo/versiones/${id}/vigente`, {})));
    expect(await consultaAdmin(`SELECT id FROM curriculo_versiones WHERE centro_id = $1 AND estado = 'vigente' AND borrado_en IS NULL`, [A])).toHaveLength(1);
  });
  it('eliminar versión: cascada a sus contenidos; bloqueada si una secuencia la usa', async () => {
    const w = (await post('dirA', '/c/curriculoVersiones', { nombre: 'W' })).json() as { id: string };
    await post('dirA', '/c/curriculoContenidos', { versionId: w.id, clave: 'w1', tipo: 'x', descripcion: 'd', estado: 'pendiente' });
    await post('dirA', '/c/secuencias', { cargaId: 'cg1', titulo: 'Usa W', curriculoVersionId: w.id });
    const r = await pedir(app, S('dirA'), 'DELETE', `/c/curriculoVersiones/${w.id}`);
    expect(r.statusCode).toBe(409);
    expect(err(r).codigo).toBe('version_referenciada');
    const z = (await post('dirA', '/c/curriculoVersiones', { nombre: 'Z' })).json() as { id: string };
    await post('dirA', '/c/curriculoContenidos', { versionId: z.id, clave: 'z1', tipo: 'x', descripcion: 'd', estado: 'pendiente' });
    expect((await pedir(app, S('dirA'), 'DELETE', `/c/curriculoVersiones/${z.id}`)).statusCode).toBe(204);
    expect(await consultaAdmin(`SELECT 1 FROM curriculo_contenidos WHERE version_id = $1 AND borrado_en IS NULL`, [z.id])).toHaveLength(0);
  });
  it('POST /curriculo/versiones/importar: valida el esquema, el hash coincide con el del cliente y guarda versión + contenidos como borrador', async () => {
    const items = doc.aplanar(doc.DOC);
    const r = await post('dirA', '/curriculo/versiones/importar', { doc: doc.DOC });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    const j = r.json() as { version: { id: string; estado: string; hash: string; total: number }; total: number; hash: string; duplicadaDe: string | null };
    expect(j.total).toBe(items.length);
    expect(j.hash).toBe(doc.hashItems(items));
    expect(j.version).toMatchObject({ estado: 'borrador', total: items.length, hash: j.hash });
    const n = await consultaAdmin<{ n: number }>(`SELECT count(*)::int AS n FROM curriculo_contenidos WHERE version_id = $1 AND borrado_en IS NULL`, [j.version.id]);
    expect(n[0]!.n).toBe(items.length);
    const otra = (await post('dirA', '/curriculo/versiones/importar', { doc: doc.DOC, nombre: 'Copia', idExterno: 'copia-1' })).json() as { duplicadaDe: string; version: { nombre: string } };
    expect(otra.duplicadaDe).toBe(j.version.id);
    expect(otra.version.nombre).toBe('Copia');
  });
  it('importar documento inválido: 422 con la lista de errores y NADA guardado; permisos', async () => {
    const antes = await consultaAdmin(`SELECT id FROM curriculo_versiones WHERE centro_id = $1`, [A]);
    const r = await post('dirA', '/curriculo/versiones/importar', { doc: { schemaVersion: '1', curriculum: {} } });
    expect(r.statusCode).toBe(422);
    expect(err(r).codigo).toBe('documento_invalido');
    expect(err(r).errores!.length).toBeGreaterThan(0);
    expect(await cod(post('dirA', '/curriculo/versiones/importar', {}))).toBe('datos_invalidos');
    expect(await consultaAdmin(`SELECT id FROM curriculo_versiones WHERE centro_id = $1`, [A])).toHaveLength(antes.length);
    expect((await post('docA1', '/curriculo/versiones/importar', { doc: doc.DOC })).statusCode).toBe(403);
    expect((await post('admin', '/curriculo/versiones/importar', { doc: doc.DOC })).statusCode).toBe(422); // admin_red debe indicar centroId
    expect((await post('admin', '/curriculo/versiones/importar', { doc: doc.DOC, centroId: B })).statusCode).toBe(201);
  });
});
