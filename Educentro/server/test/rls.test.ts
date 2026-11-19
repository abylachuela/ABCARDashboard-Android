// Aislamiento por RLS DIRECTO en SQL (sin pasar por la capa de aplicación): aunque la API fallara, la BD aísla.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conContexto, validarContexto } from '../src/db/contexto.js';
import { cerrarPoolApp, poolApp, sembrar, A, B } from './helpers/mundo.js';
import { limpiarBD, owner, prepararBD } from './helpers/app.js';

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  for (const c of [A, B]) await owner().query('INSERT INTO centros (id, nombre) VALUES ($1, $2)', [c, `Centro ${c}`]);
  await sembrar('estudiantes', 'rls_a', A, { n: 'a' });
  await sembrar('estudiantes', 'rls_b', B, { n: 'b' });
});
afterAll(async () => {
  await cerrarPoolApp();
  await owner().end();
});

const sql = async <T>(fn: (q: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> => {
  const c = await poolApp().connect();
  try {
    await c.query('BEGIN');
    return await fn((t, v) => c.query(t, v));
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
};

type Q = (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
/** Comprueba que la sentencia falla sin abortar la transacción de la prueba (usa SAVEPOINT). */
const falla = async (q: Q, texto: string, patron: RegExp): Promise<void> => {
  await q('SAVEPOINT s');
  await expect(q(texto)).rejects.toThrow(patron);
  await q('ROLLBACK TO SAVEPOINT s');
};

describe('RLS en PostgreSQL con el rol no propietario', () => {
  it('sin SET LOCAL app.centro_id / app.rol no se lee ni se escribe NADA', async () => {
    await sql(async (q) => {
      expect((await q('SELECT count(*)::int AS n FROM estudiantes')).rows[0]?.n).toBe(0);
      expect((await q('SELECT count(*)::int AS n FROM auditoria')).rows[0]?.n).toBe(0);
      expect((await q('SELECT count(*)::int AS n FROM centros')).rows[0]?.n).toBe(0);
      await falla(q, "INSERT INTO estudiantes (id, centro_id) VALUES ('x', 'ctr_a')", /row-level security/);
    });
  });

  it('un centro ve solo lo suyo y no puede leer, insertar ni modificar lo de otro', async () => {
    await sql(async (q) => {
      await q("SELECT set_config('app.centro_id', 'ctr_a', true), set_config('app.rol', 'director', true)");
      expect((await q('SELECT id FROM estudiantes ORDER BY id')).rows.map((r) => r.id)).toEqual(['rls_a']);
      expect((await q("SELECT id FROM estudiantes WHERE id = 'rls_b'")).rows).toEqual([]);
      expect((await q("UPDATE estudiantes SET datos = '{}' WHERE id = 'rls_b'")).rowCount).toBe(0);
      await falla(q, "INSERT INTO estudiantes (id, centro_id) VALUES ('x', 'ctr_b')", /row-level security/);
      // no puede «mover» una fila propia a otro centro
      await falla(q, "UPDATE estudiantes SET centro_id = 'ctr_b' WHERE id = 'rls_a'", /row-level security/);
      expect((await q('SELECT id FROM centros')).rows.map((r) => r.id)).toEqual(['ctr_a']);
      await falla(q, "INSERT INTO centros (id, nombre) VALUES ('nuevo', 'x')", /row-level security/);
    });
  });

  it('admin_red ve todos los centros; un rol desconocido sin centro no ve nada', async () => {
    await sql(async (q) => {
      await q("SELECT set_config('app.rol', 'admin_red', true)");
      expect((await q('SELECT id FROM estudiantes ORDER BY id')).rows.map((r) => r.id)).toEqual(['rls_a', 'rls_b']);
    });
    await sql(async (q) => {
      await q("SELECT set_config('app.rol', 'superusuario', true), set_config('app.centro_id', '', true)");
      expect((await q('SELECT count(*)::int AS n FROM estudiantes')).rows[0]?.n).toBe(0);
    });
  });

  it('el contexto no se filtra entre transacciones del mismo pool', async () => {
    await sql(async (q) => {
      await q("SELECT set_config('app.centro_id', 'ctr_a', true)");
    });
    await sql(async (q) => {
      expect((await q('SELECT count(*)::int AS n FROM estudiantes')).rows[0]?.n).toBe(0);
    });
  });

  it('las tablas de colecciones tienen RLS ENABLE + FORCE y la API no tiene DELETE', async () => {
    const { rows } = await owner().query(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzada
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN
              (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'centro_id')
          AND c.relname <> 'usuarios'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(37); // 36 colecciones + auditoria (usuarios excluida)
    for (const r of rows) {
      expect(r.rls, r.relname).toBe(true);
      expect(r.forzada, r.relname).toBe(true);
    }
    await expect(poolApp().query("DELETE FROM estudiantes WHERE id = 'rls_a'")).rejects.toThrow(/permission denied/);
  });
});

describe('capa de acceso transaccional: falla cerrado', () => {
  it('rechaza contextos incompletos o incoherentes', async () => {
    const pool = poolApp();
    const fn = async () => 1;
    // @ts-expect-error rol inválido a propósito
    await expect(conContexto(pool, { rol: 'root', centroId: A, usuarioId: 'u' }, fn)).rejects.toThrow(/rol/);
    await expect(conContexto(pool, { rol: 'docente', centroId: null, usuarioId: 'u' }, fn)).rejects.toThrow(/centro/);
    await expect(conContexto(pool, { rol: 'admin_red', centroId: A, usuarioId: 'u' }, fn)).rejects.toThrow(/admin_red/);
    await expect(conContexto(pool, { rol: 'docente', centroId: A, usuarioId: '' }, fn)).rejects.toThrow(/usuario/);
    expect(() => validarContexto({ rol: 'director', centroId: A, usuarioId: 'u1' })).not.toThrow();
  });

  it('el Tx no permite sentencias de control (SET/COMMIT) y aplica el centro a todas las consultas', async () => {
    await conContexto(poolApp(), { rol: 'director', centroId: A, usuarioId: 'u' }, async (tx) => {
      await expect(tx.query("SET LOCAL app.centro_id = 'ctr_b'")).rejects.toThrow(/no permitida/);
      await expect(tx.query('COMMIT')).rejects.toThrow(/no permitida/);
      expect((await tx.query('SELECT id FROM estudiantes')).rows.map((r) => r.id)).toEqual(['rls_a']);
    });
  });
});
