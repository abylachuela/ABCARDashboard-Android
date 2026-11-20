// Auditoría inmutable con cadena de hashes por centro: continuidad, concurrencia, datos fijados por el servidor,
// privilegios del rol de la API y detección de manipulación hecha COMO PROPIETARIO de la BD.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conContexto } from '../src/db/contexto.js';
import { calcularAnclas } from '../src/repo/anclas.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, montarMundo, pedir, poolApp, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
type Informe = { centroId: string; ok: boolean; registros: number; ultimoSeq: number; ultimoHash: string; errores: { seq: number | null; tipo: string }[]; verificadoEn: string };
const verificar = async (ses: string, q = ''): Promise<Informe> => (await pedir(app, S(ses), 'GET', `/auditoria/verificar${q}`)).json() as Informe;

/** Sentencias como PROPIETARIO de la BD (superpoder real: puede suspender triggers y saltarse los privilegios del rol de la API). */
async function comoPropietario<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner().connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.rol', 'admin_red', true)");
    await c.query('ALTER TABLE auditoria NO FORCE ROW LEVEL SECURITY'); // el propietario puede quitar la RLS forzada…
    await c.query('ALTER TABLE auditoria DISABLE TRIGGER USER'); // …y suspender los triggers (solo dentro de esta transacción)
    const r = await fn(c);
    await c.query('ALTER TABLE auditoria ENABLE TRIGGER USER');
    await c.query('ALTER TABLE auditoria FORCE ROW LEVEL SECURITY');
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
const filas = (centro: string) => comoPropietario(async (c) => (await c.query('SELECT * FROM auditoria WHERE centro_id = $1 ORDER BY seq', [centro])).rows as Record<string, string>[]);

async function reiniciar(): Promise<void> {
  await comoPropietario((c) => c.query('TRUNCATE auditoria, auditoria_cabeza'));
}
let k = 0;
/** n escrituras auditadas de notas en el centro A (docente) → n filas de auditoría. */
async function escribir(n: number, ses = 'docA1'): Promise<void> {
  for (let i = 0; i < n; i++) {
    const r = await pedir(app, S(ses), 'POST', '/c/calificaciones', { actividadId: 'act1', estudianteId: `c${++k}`, puntos: i % 10 });
    expect(r.statusCode).toBe(201);
  }
}

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await sembrar('actividades', 'actB2', B, { cargaId: 'cgB', nombre: 'B2', puntosMax: 10 });
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

describe('cadena de hashes: continuidad y concurrencia', () => {
  it('cada entrada lleva seq 1..n, prev_hash = hash anterior y un hash SHA-256 verificable', async () => {
    await reiniciar();
    await escribir(12);
    for (let i = 0; i < 3; i++) expect((await pedir(app, S('docB'), 'POST', '/c/calificaciones', { actividadId: 'actB2', estudianteId: `b${i}`, puntos: 1 })).statusCode).toBe(201);
    const a = await filas(A);
    expect(a.map((f) => Number(f.seq))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(a[0]?.prev_hash).toBe('0'.repeat(64));
    for (let i = 1; i < a.length; i++) expect(a[i]?.prev_hash).toBe(a[i - 1]?.hash);
    for (const f of a) expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(a.map((f) => f.hash)).size).toBe(12);
    const va = await verificar('dirA');
    expect(va).toMatchObject({ ok: true, centroId: A, registros: 12, ultimoSeq: 12, errores: [] });
    expect(va.ultimoHash).toBe(a[11]?.hash);
    expect(await verificar('dirB')).toMatchObject({ ok: true, centroId: B, registros: 3, ultimoSeq: 3 }); // cadenas independientes por centro
    expect(await verificar('admin', `?centroId=${A}`)).toMatchObject({ ok: true, registros: 12 });
    // el hash lo recalcula Node con SHA-256 sobre el contenido canónico (misma fórmula que el trigger)
    const canon = await comoPropietario(async (c) => (await c.query(`SELECT auditoria_canon(a) AS t FROM auditoria a WHERE centro_id = $1 AND seq = 5`, [A])).rows[0].t as string);
    expect(createHash('sha256').update(canon, 'utf8').digest('hex')).toBe(a[4]?.hash);
  });

  it('60 escrituras simultáneas de 3 usuarios (y otro centro): sin huecos, sin duplicados, cadena válida', async () => {
    await reiniciar();
    const reqs: Promise<{ statusCode: number }>[] = [];
    for (let i = 0; i < 60; i++) {
      const ses = ['docA1', 'dirA', 'admin'][i % 3] as string;
      const cuerpo = ses === 'admin' ? { centroId: A, actividadId: 'act1', estudianteId: `p${i}`, puntos: 1 } : { actividadId: 'act1', estudianteId: `p${i}`, puntos: 1 };
      reqs.push(pedir(app, S(ses), 'POST', '/c/calificaciones', cuerpo));
      if (i % 4 === 0) reqs.push(pedir(app, S('docB'), 'POST', '/c/calificaciones', { actividadId: 'actB2', estudianteId: `pb${i}`, puntos: 1 }));
    }
    for (const r of await Promise.all(reqs)) expect(r.statusCode).toBe(201);
    const a = await filas(A);
    const b = await filas(B);
    expect(a.map((f) => Number(f.seq))).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(b).toHaveLength(15);
    expect(await verificar('dirA')).toMatchObject({ ok: true, registros: 60, ultimoSeq: 60 });
    expect(await verificar('dirB')).toMatchObject({ ok: true, registros: 15 });
    // la fecha, fijada por el servidor de BD bajo el bloqueo, es monótona con seq
    const fechas = a.map((f) => new Date(f.fecha as unknown as string).getTime());
    expect([...fechas].sort((x, y) => x - y)).toEqual(fechas);
  });

  it('una cadena de 4500 entradas se recorre por lotes y valida', async () => {
    await reiniciar();
    await conContexto(poolApp(), { rol: 'director', centroId: A, usuarioId: 'usr_dirA' }, (tx) =>
      tx.query(`INSERT INTO auditoria (centro_id, usuario_id, rol, accion, antes, despues) SELECT '${A}', 'u', 'director', 'prueba', NULL, jsonb_build_object('n', g, 'txt', 'acción ñ ✓') FROM generate_series(1, 4500) g`),
    );
    const t0 = Date.now();
    const v = await verificar('dirA');
    expect(v).toMatchObject({ ok: true, registros: 4500, ultimoSeq: 4500 });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});

describe('el servidor fija usuario, rol, fecha, IP y user-agent', () => {
  it('IP y UA se truncan; el cliente no los elige; usuario y rol salen de la sesión', async () => {
    await reiniciar();
    const antes = Date.now();
    const r = await app.inject({
      method: 'POST', url: '/api/v1/c/calificaciones', remoteAddress: '203.0.113.7',
      headers: { ...S('docA1').headers, 'user-agent': 'U'.repeat(500), 'x-forwarded-for': '1.2.3.4' },
      payload: { actividadId: 'act1', estudianteId: 'ipua', puntos: 3, ip: '9.9.9.9', userAgent: 'falso', fecha: '1999-01-01T00:00:00Z' },
    });
    expect(r.statusCode).toBe(201);
    const [f] = await filas(A);
    expect(f).toMatchObject({ usuario_id: S('docA1').id, rol: 'docente', ip: '203.0.113.7' });
    expect((f?.user_agent as string).length).toBe(200);
    expect(Date.now() - new Date(f?.fecha as unknown as string).getTime()).toBeLessThan(Date.now() - antes + 5000);
    expect(new Date(f?.fecha as unknown as string).getFullYear()).toBeGreaterThan(2000);
    const api = ((await pedir(app, S('dirA'), 'GET', '/auditoria')).json() as { datos: { ip: string; userAgent: string; seq: number; huella: string; usuarioId: string }[] }).datos[0]!;
    expect(api).toMatchObject({ ip: '203.0.113.7', seq: 1, usuarioId: S('docA1').id });
    expect(api.userAgent).toHaveLength(200);
    expect(api.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un INSERT con seq, hash, fecha o centro falsos a mano (rol de la API) no los conserva: los recalcula el trigger', async () => {
    await reiniciar();
    await escribir(2);
    await conContexto(poolApp(), { rol: 'director', centroId: A, usuarioId: 'usr_dirA' }, (tx) =>
      tx.query(`INSERT INTO auditoria (id, centro_id, usuario_id, rol, accion, fecha, seq, prev_hash, hash) VALUES ('aud_forjada', '${A}', 'u', 'director', 'x', '1999-01-01', 99, '${'a'.repeat(64)}', '${'b'.repeat(64)}')`),
    );
    const f = (await filas(A)).find((x) => x.id === 'aud_forjada');
    expect(Number(f?.seq)).toBe(3);
    expect(f?.hash).not.toBe('b'.repeat(64));
    expect(new Date(f?.fecha as unknown as string).getFullYear()).toBeGreaterThan(2000);
    expect(await verificar('dirA')).toMatchObject({ ok: true, registros: 3 });
    // y no se puede insertar en un centro que no es el del contexto (RLS)
    await expect(conContexto(poolApp(), { rol: 'director', centroId: A, usuarioId: 'u' }, (tx) => tx.query(`INSERT INTO auditoria (centro_id, usuario_id, rol, accion) VALUES ('${B}', 'u', 'director', 'x')`))).rejects.toThrow(/row-level security/);
  });
});

describe('privilegios: el rol de la API no puede alterar la auditoría ni su cabeza', () => {
  it('UPDATE, DELETE y TRUNCATE de auditoria y auditoria_cabeza → permission denied; INSERT en la cabeza tampoco', async () => {
    await reiniciar();
    await escribir(2);
    const p = poolApp();
    for (const sql of [
      "UPDATE auditoria SET accion = 'x'", 'DELETE FROM auditoria', 'TRUNCATE auditoria',
      'UPDATE auditoria_cabeza SET seq = 0', 'DELETE FROM auditoria_cabeza', 'TRUNCATE auditoria_cabeza',
      "INSERT INTO auditoria_cabeza (centro_id, seq, hash) VALUES ('x', 1, 'y')",
    ]) {
      await expect(p.query(sql), sql).rejects.toThrow(/permission denied/);
    }
    await expect(p.query('ALTER TABLE auditoria DISABLE TRIGGER USER')).rejects.toThrow(/must be owner|permission denied/);
    await expect(p.query("SELECT auditoria_encadenar()")).rejects.toThrow(); // función de trigger: no invocable a mano
  });

  it('ni siquiera el propietario altera la auditoría por la vía normal (el trigger de inmutabilidad aborta)', async () => {
    await reiniciar();
    await escribir(2);
    const c = await owner().connect();
    try {
      for (const sql of ["UPDATE auditoria SET accion = 'x'", 'DELETE FROM auditoria', 'TRUNCATE auditoria']) {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.rol', 'admin_red', true)");
        await c.query('ALTER TABLE auditoria NO FORCE ROW LEVEL SECURITY');
        await expect(c.query(sql), sql).rejects.toThrow(/solo anexado/);
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
  });
});

describe('manipulación COMO PROPIETARIO (suspendiendo triggers): GET /auditoria/verificar la detecta', () => {
  const tipos = (v: Informe) => new Set(v.errores.map((e) => e.tipo));

  it('contenido alterado → hash_alterado en esa entrada', async () => {
    await reiniciar();
    await escribir(8);
    expect((await verificar('dirA')).ok).toBe(true);
    await comoPropietario((c) => c.query(`UPDATE auditoria SET despues = '{"puntos":10}'::jsonb WHERE centro_id = $1 AND seq = 4`, [A]));
    const v = await verificar('dirA');
    expect(v.ok).toBe(false);
    expect(v.errores).toEqual([expect.objectContaining({ seq: 4, tipo: 'hash_alterado' })]);
  });

  it('usuario o fecha alterados (campos de la fila, no solo antes/después) también se detectan', async () => {
    await reiniciar();
    await escribir(5);
    await comoPropietario((c) => c.query(`UPDATE auditoria SET usuario_id = 'otra_persona' WHERE centro_id = $1 AND seq = 2`, [A]));
    expect(tipos(await verificar('dirA')).has('hash_alterado')).toBe(true);
    await reiniciar();
    await escribir(5);
    await comoPropietario((c) => c.query(`UPDATE auditoria SET fecha = fecha - interval '1 day' WHERE centro_id = $1 AND seq = 3`, [A]));
    expect(tipos(await verificar('dirA')).has('hash_alterado')).toBe(true);
  });

  it('entrada borrada en medio, al principio o al final → seq_discontinuo / enlace_roto / cabeza_distinta', async () => {
    for (const [seq, esperado] of [[4, ['seq_discontinuo', 'enlace_roto']], [1, ['seq_discontinuo', 'enlace_roto']], [8, ['cabeza_distinta']]] as const) {
      await reiniciar();
      await escribir(8);
      await comoPropietario((c) => c.query('DELETE FROM auditoria WHERE centro_id = $1 AND seq = $2', [A, seq]));
      const v = await verificar('dirA');
      expect(v.ok, `borrar ${seq}`).toBe(false);
      for (const t of esperado) expect(tipos(v).has(t), `${t} al borrar ${seq}`).toBe(true);
    }
  });

  it('reordenamiento (intercambiar seq de dos entradas) → detectado', async () => {
    await reiniciar();
    await escribir(6);
    await comoPropietario(async (c) => {
      await c.query('UPDATE auditoria SET seq = -1 WHERE centro_id = $1 AND seq = 2', [A]);
      await c.query('UPDATE auditoria SET seq = 2 WHERE centro_id = $1 AND seq = 3', [A]);
      await c.query('UPDATE auditoria SET seq = 3 WHERE centro_id = $1 AND seq = -1', [A]);
    });
    const v = await verificar('dirA');
    expect(v.ok).toBe(false);
    expect(tipos(v).has('hash_alterado') || tipos(v).has('enlace_roto')).toBe(true);
  });

  it('entrada forjada insertada a mano (sin trigger) o recalculando solo su hash → detectada', async () => {
    await reiniciar();
    await escribir(5);
    await comoPropietario((c) =>
      c.query(`INSERT INTO auditoria (id, centro_id, usuario_id, rol, accion, seq, prev_hash, hash) VALUES ('aud_falsa', $1, 'x', 'director', 'editar', 6, $2, $3)`, [A, 'c'.repeat(64), 'd'.repeat(64)]),
    );
    expect((await verificar('dirA')).ok).toBe(false);
    await reiniciar();
    await escribir(5);
    // el atacante recalcula el hash de UNA fila alterada pero no el de las siguientes
    await comoPropietario(async (c) => {
      await c.query(`UPDATE auditoria SET despues = '{"puntos":0}'::jsonb WHERE centro_id = $1 AND seq = 2`, [A]);
      await c.query(`UPDATE auditoria a SET hash = encode(sha256(convert_to(auditoria_canon(a), 'UTF8')), 'hex') WHERE centro_id = $1 AND seq = 2`, [A]);
    });
    const v = await verificar('dirA');
    expect(v.ok).toBe(false);
    expect(v.errores[0]).toMatchObject({ seq: 3, tipo: 'enlace_roto' });
  });

  it('cabeza alterada sin tocar las filas → cabeza_distinta', async () => {
    await reiniciar();
    await escribir(3);
    await comoPropietario((c) => c.query(`UPDATE auditoria_cabeza SET hash = $2 WHERE centro_id = $1`, [A, 'e'.repeat(64)]));
    expect(tipos(await verificar('dirA')).has('cabeza_distinta')).toBe(true);
  });

  it('LÍMITE DOCUMENTADO: quien controla toda la BD puede reescribir TODA la cadena (incluida la cabeza) y verificar() no lo ve; el ancla externo sí', async () => {
    await reiniciar();
    await escribir(6);
    const [ancla] = await calcularAnclas(poolApp(), A);
    expect(ancla).toMatchObject({ centroId: A, seq: 6, ok: true, registros: 6 });
    expect(ancla?.hash).toMatch(/^[0-9a-f]{64}$/);
    // reescritura total: cambia el contenido de la entrada 2 y recalcula TODOS los hashes y la cabeza
    await comoPropietario(async (c) => {
      await c.query(`UPDATE auditoria SET despues = '{"puntos":0}'::jsonb WHERE centro_id = $1 AND seq = 2`, [A]);
      await c.query(`DO $$ DECLARE r record; prev text := repeat('0', 64); h text; BEGIN
        FOR r IN SELECT id FROM auditoria WHERE centro_id = '${A}' ORDER BY seq LOOP
          UPDATE auditoria SET prev_hash = prev WHERE id = r.id;
          SELECT encode(sha256(convert_to(auditoria_canon(a), 'UTF8')), 'hex') INTO h FROM auditoria a WHERE a.id = r.id;
          UPDATE auditoria SET hash = h WHERE id = r.id; prev := h;
        END LOOP;
        UPDATE auditoria_cabeza SET hash = prev WHERE centro_id = '${A}'; END $$`);
    });
    expect(await verificar('dirA')).toMatchObject({ ok: true }); // la cadena es internamente coherente: no se detecta SIN ancla
    const v = await verificar('dirA', `?anclaSeq=${ancla?.seq}&anclaHash=${ancla?.hash}`);
    expect(v.ok).toBe(false);
    expect(v.errores.some((e) => e.tipo === 'ancla_distinta')).toBe(true);
    const [nueva] = await calcularAnclas(poolApp(), A);
    expect(nueva?.hash).not.toBe(ancla?.hash);
  });

  it('con ancla válida la verificación sigue ok aunque haya entradas posteriores', async () => {
    await reiniciar();
    await escribir(4);
    const [ancla] = await calcularAnclas(poolApp(), A);
    await escribir(3);
    expect(await verificar('dirA', `?anclaSeq=${ancla?.seq}&anclaHash=${ancla?.hash}`)).toMatchObject({ ok: true, registros: 7 });
    expect((await pedir(app, S('dirA'), 'GET', `/auditoria/verificar?anclaSeq=1`)).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'GET', `/auditoria/verificar?anclaSeq=1&anclaHash=xyz`)).statusCode).toBe(422);
  });
});

describe('GET /auditoria/verificar: permisos y alcance por centro', () => {
  it('director solo su centro (otro centro → 404); admin_red cualquiera (centroId obligatorio); docente/secretaría/tutor/estudiante 403; sin sesión 401', async () => {
    await reiniciar();
    await escribir(2);
    expect((await pedir(app, S('dirA'), 'GET', `/auditoria/verificar?centroId=${B}`)).statusCode).toBe(404);
    expect((await pedir(app, S('dirA'), 'GET', `/auditoria/verificar?centroId=${A}`)).statusCode).toBe(200);
    expect((await pedir(app, S('dirB'), 'GET', `/auditoria/verificar?centroId=${A}`)).statusCode).toBe(404);
    expect((await pedir(app, S('admin'), 'GET', '/auditoria/verificar')).statusCode).toBe(422);
    expect((await pedir(app, S('admin'), 'GET', `/auditoria/verificar?centroId=${B}`)).statusCode).toBe(200);
    expect((await pedir(app, S('admin'), 'GET', '/auditoria/verificar?centroId=no_existe')).statusCode).toBe(404);
    for (const k2 of ['docA1', 'secA', 'tutA', 'estA1']) expect((await pedir(app, S(k2), 'GET', '/auditoria/verificar')).statusCode, k2).toBe(403);
    expect((await pedir(app, null, 'GET', '/auditoria/verificar')).statusCode).toBe(401);
    const vacio = await pedir(app, S('admin'), 'GET', `/auditoria/verificar?centroId=${B}`);
    expect(vacio.json()).toMatchObject({ ok: true, registros: 0, ultimoSeq: 0 });
  });

  it('el informe lista como mucho 50 errores y avisa del truncado', async () => {
    await reiniciar();
    await escribir(60);
    await comoPropietario((c) => c.query(`UPDATE auditoria SET accion = 'otra' WHERE centro_id = $1`, [A]));
    const v = (await pedir(app, S('dirA'), 'GET', '/auditoria/verificar')).json() as Informe & { truncado: boolean };
    expect(v.ok).toBe(false);
    expect(v.errores).toHaveLength(50);
    expect(v.truncado).toBe(true);
  });
});
