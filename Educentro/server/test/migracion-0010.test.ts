// La migración 0010 sobre una BD con filas previas que violarían las restricciones nuevas: resuelve los duplicados sin perder
// filas (marcadas con `migracion0010`), deja los índices UNIQUE y se DETIENE si hay cargas duplicadas con datos dependientes.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIR_MIGRACIONES, migrar } from '../src/db/migrar.js';
import { crearPool, type Pool } from '../src/db/pool.js';
import { ADMIN_URL, CLAVE_APP, CLAVE_OWNER } from './helpers/entorno.js';

const DB = 'educentro_mig10_test';
const urlDe = (usuario: string, clave: string): string => {
  const b = new URL(ADMIN_URL);
  return `postgres://${usuario}:${clave}@${b.hostname}:${b.port || '5432'}/${DB}`;
};
let owner: Pool;
const admin = async (): Promise<pg.Client> => {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  return c;
};

async function sql(texto: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.rol', 'admin_red', true)");
    const r = await c.query(texto, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
const fila = (tabla: string, id: string, datos: Record<string, unknown>, creado = '2026-01-01T00:00:00Z') =>
  sql(`INSERT INTO ${tabla} (id, centro_id, datos, creado_en, actualizado_en) VALUES ($1, 'mc', $2::jsonb, $3, $3)`, [id, JSON.stringify(datos), creado]);

beforeAll(async () => {
  const a = await admin();
  await a.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await a.end();
  const roles = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/roles.sql');
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `owner_pw=${CLAVE_OWNER}`, '-v', `app_pw=${CLAVE_APP}`, '-v', `dbname=${DB}`, '-f', roles, ADMIN_URL], { stdio: ['ignore', 'ignore', 'inherit'] });
  owner = crearPool(urlDe('educentro_owner', CLAVE_OWNER), { max: 2 });
});
afterAll(async () => {
  await owner.end();
  const a = await admin();
  await a.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await a.end();
});

describe('migración 0010 con datos previos', () => {
  it('resuelve cédulas, códigos MAT, matrículas, año/escala/currículo activos, secciones, periodos e inscripciones duplicados', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-mig10-'));
    for (const f of (await readdir(DIR_MIGRACIONES)).filter((x) => x.endsWith('.sql') && !x.startsWith('0010'))) await copyFile(path.join(DIR_MIGRACIONES, f), path.join(dir, f));
    await migrar(owner, dir); // hasta 0009
    await sql(`INSERT INTO centros (id, nombre) VALUES ('mc', 'Centro migración')`);
    // documentos: dos iguales (con y sin guiones), uno mal formado, uno bien y único
    await fila('estudiantes', 'e1', { documento: '001-1234567-8', matricula: 'MAT-1-2001' }, '2026-01-01T00:00:00Z');
    await fila('estudiantes', 'e2', { documento: '00112345678', matricula: 'MAT-1-2001' }, '2026-02-01T00:00:00Z');
    await fila('estudiantes', 'e3', { documento: '12345', matricula: 'MAT-1-2002' });
    await fila('estudiantes', 'e4', { documento: '002-7654321-0', matricula: 'MAT-1-2003' });
    await fila('estudiantes', 'e5', { nombres: 'Sin documento ni código' });
    await fila('docentes', 'd1', { documento: '003-0000000-1' }, '2026-01-01T00:00:00Z');
    await fila('docentes', 'd2', { documento: '003-0000000-1' }, '2026-03-01T00:00:00Z');
    // matrículas duplicadas (una activa, una retirada más reciente)
    await fila('matriculas', 'm1', { estudianteId: 'e1', anioId: 'an1', seccionId: 's1', estado: 'retirada' }, '2026-03-01T00:00:00Z');
    await fila('matriculas', 'm2', { estudianteId: 'e1', anioId: 'an1', seccionId: 's1', estado: 'activa' }, '2026-01-01T00:00:00Z');
    await fila('matriculas', 'm3', { estudianteId: 'e1', anioId: 'an2', seccionId: 's2', estado: 'activa' });
    // dos años activos, dos escalas activas, dos currículos vigentes
    await fila('anios', 'an1', { nombre: '2025', inicio: '2025-01-01', activo: true });
    await fila('anios', 'an2', { nombre: '2026', inicio: '2026-01-01', activo: true });
    await fila('escalas', 'esA', { nombre: 'A' });
    await fila('escalas', 'esB', { nombre: 'B', activa: true });
    await fila('escalas', 'esC', { nombre: 'C', activa: false });
    await fila('curriculo_versiones', 'cv1', { estado: 'vigente', vigenteDesde: '2020-01-01' });
    await fila('curriculo_versiones', 'cv2', { estado: 'vigente', vigenteDesde: '2024-01-01' });
    await fila('curriculo_versiones', 'cvCfg', { esConfig: true, nombre: 'Config' });
    // secciones repetidas (mayúsculas distintas), periodos con el mismo orden, inscripciones repetidas
    await fila('secciones', 's1', { cursoId: 'c1', anioId: 'an1', nombre: 'A' }, '2026-01-01T00:00:00Z');
    await fila('secciones', 's2', { cursoId: 'c1', anioId: 'an1', nombre: 'a ' }, '2026-02-01T00:00:00Z');
    await fila('periodos', 'p1', { anioId: 'an1', orden: 1, peso: 30 }, '2026-01-01T00:00:00Z');
    await fila('periodos', 'p2', { anioId: 'an1', orden: 1, peso: 30 }, '2026-02-01T00:00:00Z');
    await fila('periodos', 'p3', { anioId: 'an1', orden: 2, peso: 40 });
    await fila('inscripciones', 'i1', { cursoId: 'cx', estudianteId: 'e1', estado: 'retirado' }, '2026-03-01T00:00:00Z');
    await fila('inscripciones', 'i2', { cursoId: 'cx', estudianteId: 'e1', estado: 'inscrito' }, '2026-01-01T00:00:00Z');
    // cargas repetidas SIN datos dependientes
    await fila('cargas', 'g1', { seccionId: 's1', asignaturaId: 'as1' }, '2026-01-01T00:00:00Z');
    await fila('cargas', 'g2', { seccionId: 's1', asignaturaId: 'as1' }, '2026-02-01T00:00:00Z');

    const r = await migrar(owner, DIR_MIGRACIONES);
    expect(r.aplicadas).toEqual(['0010_integridad.sql']);

    const datos = async (t: string, id: string) => (await sql(`SELECT datos, borrado_en FROM ${t} WHERE id = $1`, [id]))[0] as { datos: Record<string, unknown>; borrado_en: Date | null };
    // documentos
    expect((await datos('estudiantes', 'e1')).datos.documento).toBe('001-1234567-8'); // la más antigua conserva
    const e2 = (await datos('estudiantes', 'e2')).datos;
    expect(e2).not.toHaveProperty('documento');
    expect(e2).toMatchObject({ documentoOriginal: '00112345678', migracion0010: 'codigo_repetido' }); // además tenía el código repetido: el último motivo queda marcado
    expect((await datos('estudiantes', 'e3')).datos).toMatchObject({ documentoOriginal: '12345', migracion0010: 'documento_invalido' });
    expect((await datos('estudiantes', 'e4')).datos.documento).toBe('002-7654321-0');
    expect((await datos('docentes', 'd2')).datos).toMatchObject({ migracion0010: 'documento_duplicado' });
    // código MAT repetido: el más reciente recibe uno nuevo posterior al máximo
    expect((await datos('estudiantes', 'e1')).datos.matricula).toBe('MAT-1-2001');
    const e2m = (await datos('estudiantes', 'e2')).datos;
    expect(e2m.matriculaAnterior).toBe('MAT-1-2001');
    expect(Number(String(e2m.matricula).split('-')[2])).toBeGreaterThan(2003);
    // matrículas: queda la activa; la otra se marca borrada pero NO se pierde la fila
    expect((await datos('matriculas', 'm2')).borrado_en).toBeNull();
    expect((await datos('matriculas', 'm1')).borrado_en).not.toBeNull();
    expect((await datos('matriculas', 'm1')).datos.migracion0010).toBe('matricula_duplicada');
    expect((await datos('matriculas', 'm3')).borrado_en).toBeNull();
    // año / escala / currículo
    expect((await datos('anios', 'an2')).datos.activo).toBe(true);
    expect((await datos('anios', 'an1')).datos).toMatchObject({ activo: false, migracion0010: 'anio_activo_repetido' });
    expect((await datos('escalas', 'esA')).datos).not.toHaveProperty('migracion0010'); // la primera por id queda activa
    expect((await datos('escalas', 'esB')).datos).toMatchObject({ activa: false });
    expect((await datos('escalas', 'esC')).datos).toMatchObject({ activa: false });
    expect((await datos('curriculo_versiones', 'cv2')).datos.estado).toBe('vigente');
    expect((await datos('curriculo_versiones', 'cv1')).datos).toMatchObject({ estado: 'anterior' });
    // secciones, periodos, inscripciones, cargas
    expect((await datos('secciones', 's2')).datos.nombre).toBe('a (2)');
    expect([(await datos('periodos', 'p1')).datos.orden, (await datos('periodos', 'p2')).datos.orden, (await datos('periodos', 'p3')).datos.orden]).toEqual([1, 2, 3]);
    expect((await datos('inscripciones', 'i1')).borrado_en).not.toBeNull();
    expect((await datos('inscripciones', 'i2')).borrado_en).toBeNull();
    expect((await datos('cargas', 'g2')).borrado_en).not.toBeNull();
    expect((await datos('cargas', 'g1')).borrado_en).toBeNull();
  });

  it('con las restricciones ya creadas, la BD rechaza nuevos duplicados y datos mal formados (23505 / 23514)', async () => {
    const intento = (t: string, id: string, d: Record<string, unknown>) => fila(t, id, d);
    await expect(intento('estudiantes', 'n1', { documento: '002-7654321-0' })).rejects.toMatchObject({ code: '23505', constraint: 'estudiantes_documento_uidx' });
    await expect(intento('estudiantes', 'n2', { documento: '9' })).rejects.toMatchObject({ code: '23514' });
    await expect(intento('estudiantes', 'n3', { matricula: 'MAT-1-2001' })).rejects.toMatchObject({ code: '23505', constraint: 'estudiantes_codigo_uidx' });
    await expect(intento('matriculas', 'n4', { estudianteId: 'e1', anioId: 'an1' })).rejects.toMatchObject({ code: '23505', constraint: 'matriculas_estudiante_anio_uidx' });
    await expect(intento('anios', 'n5', { activo: true })).rejects.toMatchObject({ code: '23505', constraint: 'anios_activo_uidx' });
    await expect(intento('escalas', 'n6', { nombre: 'dup' })).rejects.toMatchObject({ code: '23505', constraint: 'escalas_activa_uidx' });
    await expect(intento('curriculo_versiones', 'n7', { estado: 'vigente' })).rejects.toMatchObject({ code: '23505', constraint: 'curriculo_versiones_vigente_uidx' });
    await expect(intento('secciones', 'n8', { cursoId: 'c1', anioId: 'an1', nombre: ' A' })).rejects.toMatchObject({ code: '23505', constraint: 'secciones_curso_anio_nombre_uidx' });
    await expect(intento('cargas', 'n9', { seccionId: 's1', asignaturaId: 'as1' })).rejects.toMatchObject({ code: '23505', constraint: 'cargas_seccion_asignatura_uidx' });
    await expect(intento('inscripciones', 'n10', { cursoId: 'cx', estudianteId: 'e1' })).rejects.toMatchObject({ code: '23505', constraint: 'inscripciones_curso_estudiante_uidx' });
    await expect(intento('periodos', 'n11', { anioId: 'an1', orden: 1 })).rejects.toMatchObject({ code: '23505', constraint: 'periodos_anio_orden_uidx' });
    // las filas borradas no cuentan: se puede reutilizar lo liberado
    await expect(intento('matriculas', 'n12', { estudianteId: 'e9', anioId: 'an1' })).resolves.toBeDefined();
  });

  it('se DETIENE (sin aplicar nada) si hay cargas repetidas con categorías o actividades', async () => {
    const a = await admin();
    await a.query(`DROP DATABASE IF EXISTS ${DB}b WITH (FORCE)`);
    await a.end();
    const roles = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/roles.sql');
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `owner_pw=${CLAVE_OWNER}`, '-v', `app_pw=${CLAVE_APP}`, '-v', `dbname=${DB}b`, '-f', roles, ADMIN_URL], { stdio: ['ignore', 'ignore', 'inherit'] });
    const b = new URL(ADMIN_URL);
    const o2 = crearPool(`postgres://educentro_owner:${CLAVE_OWNER}@${b.hostname}:${b.port || '5432'}/${DB}b`, { max: 2 });
    try {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-mig10b-'));
      for (const f of (await readdir(DIR_MIGRACIONES)).filter((x) => x.endsWith('.sql') && !x.startsWith('0010'))) await copyFile(path.join(DIR_MIGRACIONES, f), path.join(dir, f));
      await migrar(o2, dir);
      const c = await o2.connect();
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.rol', 'admin_red', true)");
      await c.query(`INSERT INTO centros (id, nombre) VALUES ('mc', 'x')`);
      await c.query(`INSERT INTO cargas (id, centro_id, datos, creado_en) VALUES ('g1', 'mc', '{"seccionId":"s","asignaturaId":"a"}', '2026-01-01'), ('g2', 'mc', '{"seccionId":"s","asignaturaId":"a"}', '2026-02-01')`);
      await c.query(`INSERT INTO actividades (id, centro_id, datos) VALUES ('ac', 'mc', '{"cargaId":"g2"}')`);
      await c.query('COMMIT');
      c.release();
      await expect(migrar(o2, DIR_MIGRACIONES)).rejects.toThrow(/cargas repetidas.*g2/);
      const aplicadas = await o2.query(`SELECT version FROM migraciones_aplicadas WHERE version LIKE '0010%'`);
      expect(aplicadas.rows).toHaveLength(0);
    } finally {
      await o2.end();
      const a2 = await admin();
      await a2.query(`DROP DATABASE IF EXISTS ${DB}b WITH (FORCE)`);
      await a2.end();
    }
  });
});
