// La migración 0009 rellena la cadena de hashes de las filas de auditoría que ya existían (Fase 1) en una BD con datos.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conContexto } from '../src/db/contexto.js';
import { DIR_MIGRACIONES, migrar } from '../src/db/migrar.js';
import { crearPool, type Pool } from '../src/db/pool.js';
import { verificarCadena } from '../src/repo/auditoria.js';
import { ADMIN_URL, CLAVE_APP, CLAVE_OWNER } from './helpers/entorno.js';

const DB = 'educentro_mig_test';
const urlDe = (usuario: string, clave: string): string => {
  const b = new URL(ADMIN_URL);
  return `postgres://${usuario}:${clave}@${b.hostname}:${b.port || '5432'}/${DB}`;
};
let owner: Pool;
let app: Pool;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
  const roles = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/roles.sql');
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `owner_pw=${CLAVE_OWNER}`, '-v', `app_pw=${CLAVE_APP}`, '-v', `dbname=${DB}`, '-f', roles, ADMIN_URL], { stdio: ['ignore', 'ignore', 'inherit'] });
  owner = crearPool(urlDe('educentro_owner', CLAVE_OWNER), { max: 2 });
  app = crearPool(urlDe('educentro_app', CLAVE_APP), { max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
});

describe('migración 0009 sobre una BD con auditoría previa', () => {
  it('rellena seq, prev_hash y hash por centro (orden fecha, id) y la cadena verifica', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-mig9-'));
    for (const f of (await readdir(DIR_MIGRACIONES)).filter((x) => x.endsWith('.sql') && !x.startsWith('0009'))) await copyFile(path.join(DIR_MIGRACIONES, f), path.join(dir, f));
    await migrar(owner, dir);
    const c = await owner.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.rol', 'admin_red', true)");
      for (const [centro, n] of [['mc1', 6], ['mc2', 3]] as const) {
        for (let i = 0; i < n; i++) {
          await c.query(
            `INSERT INTO auditoria (centro_id, usuario_id, rol, accion, coleccion, registro_id, antes, despues, fecha, extra) VALUES ($1, 'u1', 'docente', 'editar', 'calificaciones', $2, '{"puntos":1}', '{"puntos":2}', now() - make_interval(mins => $3), '{"motivo":"previo"}')`,
            [centro, `cal_${i}`, 100 - i],
          );
        }
      }
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const r = await migrar(owner); // aplica solo 0009
    expect(r.aplicadas).toEqual(['0009_auditoria_cadena.sql']);
    const v = await conContexto(app, { rol: 'admin_red', centroId: null, usuarioId: 'prueba' }, async (tx) => ({
      mc1: await verificarCadena(tx, 'mc1'),
      mc2: await verificarCadena(tx, 'mc2'),
    }));
    expect(v.mc1).toMatchObject({ ok: true, registros: 6, ultimoSeq: 6, errores: [] });
    expect(v.mc2).toMatchObject({ ok: true, registros: 3, ultimoSeq: 3 });
    // El orden de la cadena respeta la fecha original; y las inserciones nuevas continúan la cadena
    const orden = await conContexto(app, { rol: 'admin_red', centroId: null, usuarioId: 'p' }, async (tx) => {
      await tx.query(`INSERT INTO auditoria (centro_id, usuario_id, rol, accion) VALUES ('mc1', 'u', 'director', 'nueva')`);
      return (await tx.query<{ seq: string; registro_id: string | null }>(`SELECT seq, registro_id FROM auditoria WHERE centro_id = 'mc1' ORDER BY seq`)).rows;
    });
    expect(orden.map((x) => x.registro_id)).toEqual(['cal_0', 'cal_1', 'cal_2', 'cal_3', 'cal_4', 'cal_5', null]); // la más antigua (cal_0, hace 100 min) abre la cadena
  });
});
