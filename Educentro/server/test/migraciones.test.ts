import { mkdtemp, writeFile, copyFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { DIR_MIGRACIONES, migrar } from '../src/db/migrar.js';
import { crearPool } from '../src/db/pool.js';
import { APP_URL } from './helpers/entorno.js';
import { owner } from './helpers/app.js';

afterAll(async () => {
  await owner().end();
});

describe('migraciones', () => {
  it('se aplican y son idempotentes (segunda ejecución no hace nada)', async () => {
    const total = (await readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).length;
    const a = await migrar(owner());
    expect(a.aplicadas.length + a.yaAplicadas.length).toBe(total);
    const b = await migrar(owner());
    expect(b.aplicadas).toEqual([]);
    expect(b.yaAplicadas.length).toBe(total);
    const { rows } = await owner().query('SELECT count(*)::int AS n FROM migraciones_aplicadas');
    expect(rows[0].n).toBe(total);
  });

  it('dos ejecuciones simultáneas no se pisan (bloqueo asesor)', async () => {
    const [x, y] = await Promise.all([migrar(owner()), migrar(owner())]);
    expect(x.aplicadas).toEqual([]);
    expect(y.aplicadas).toEqual([]);
  });

  it('detecta una migración ya aplicada que fue modificada', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-mig-'));
    const primera = (await readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort()[0] as string;
    await writeFile(path.join(dir, primera), '-- distinto\nSELECT 1;');
    await expect(migrar(owner(), dir)).rejects.toThrow(/fue modificada/);
  });

  it('revierte una migración fallida entera y rechaza nombres inválidos', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-mig-'));
    for (const f of (await readdir(DIR_MIGRACIONES)).filter((x) => x.endsWith('.sql'))) {
      await copyFile(path.join(DIR_MIGRACIONES, f), path.join(dir, f));
    }
    await writeFile(path.join(dir, '9999_rota.sql'), 'CREATE TABLE prueba_rota (id int); SELECT 1/0;');
    await expect(migrar(owner(), dir)).rejects.toThrow(/9999_rota/);
    const { rows } = await owner().query("SELECT to_regclass('prueba_rota') AS t");
    expect(rows[0].t).toBeNull();
    await writeFile(path.join(dir, '9999_rota.sql'), 'SELECT 1;');
    await writeFile(path.join(dir, 'mal nombre.sql'), 'SELECT 1;');
    await expect(migrar(owner(), dir)).rejects.toThrow(/inválido/);
  });

  it('el rol de la aplicación no es propietario ni superusuario, y no puede alterar el esquema', async () => {
    const app = crearPool(APP_URL, { max: 1 });
    try {
      const { rows } = await app.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
                (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tableowner = current_user) AS propias
           FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, propias: 0 });
      await expect(app.query('CREATE TABLE x (id int)')).rejects.toThrow(/permission denied/);
      await expect(app.query('SELECT * FROM migraciones_aplicadas')).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('el esquema impone rol válido y centro según rol', async () => {
    const o = owner();
    await o.query('TRUNCATE usuarios, centros CASCADE');
    await o.query("INSERT INTO centros (id, nombre) VALUES ('c1', 'C')");
    const ins = (rol: string, centro: string | null, email: string) =>
      o.query('INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash) VALUES ($1,$2,$3,$4,$5,$6)', [
        `id_${Math.random()}`, centro, rol, 'N', email, 'h',
      ]);
    await expect(ins('superadmin', 'c1', 'a@x.test')).rejects.toThrow(/check/);
    await expect(ins('admin_red', 'c1', 'b@x.test')).rejects.toThrow(/usuarios_centro_segun_rol/);
    await expect(ins('docente', null, 'c@x.test')).rejects.toThrow(/usuarios_centro_segun_rol/);
    await expect(ins('docente', 'c1', 'Mayus@x.test')).rejects.toThrow(/check/);
    await ins('docente', 'c1', 'ok@x.test');
    await expect(ins('director', 'c1', 'ok@x.test')).rejects.toThrow(/usuarios_email_unico/);
    await o.query('TRUNCATE usuarios, centros CASCADE');
  });
});
