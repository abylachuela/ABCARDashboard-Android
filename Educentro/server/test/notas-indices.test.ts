// Columnas calientes generadas (migración 0008): las consultas por carga/estudiante/actividad usan índices (EXPLAIN con volumen),
// y la API y el formato plano no cambian.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conContexto } from '../src/db/contexto.js';
import { COLUMNAS_CALIENTES } from '../src/domain/colecciones.js';
import { limpiarBD, owner, prepararBD } from './helpers/app.js';
import { cerrarPoolApp, poolApp } from './helpers/mundo.js';

const C = 'ctr_vol';
type Nodo = { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: Nodo[] };

async function plan(sql: string, params: unknown[] = []): Promise<Nodo[]> {
  return conContexto(poolApp(), { rol: 'director', centroId: C, usuarioId: 'u' }, async (tx) => {
    const r = await tx.query<{ 'QUERY PLAN': { Plan: Nodo }[] }>(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const out: Nodo[] = [];
    const rec = (n: Nodo): void => {
      out.push(n);
      (n.Plans ?? []).forEach(rec);
    };
    rec(r.rows[0]!['QUERY PLAN'][0]!.Plan);
    return out;
  });
}
const indices = (n: Nodo[]): string[] => n.map((x) => x['Index Name']).filter((x): x is string => !!x);
const secuenciales = (n: Nodo[], tabla: string): boolean => n.some((x) => x['Node Type'] === 'Seq Scan' && x['Relation Name'] === tabla);

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  await owner().query("INSERT INTO centros (id, nombre) VALUES ($1, 'Centro con volumen')", [C]);
  await conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'carga' }, async (tx) => {
    const ins = (t: string, filas: string) => tx.query(`INSERT INTO ${t} (id, centro_id, datos) SELECT ${filas}`);
    // 300 cargas × 15 actividades (4 periodos) = 4500 actividades; 15 estudiantes por carga → 67 500 notas
    await tx.query(`INSERT INTO cargas (id, centro_id, datos) SELECT 'cg' || g, '${C}', jsonb_build_object('docenteId', 'd' || (g % 30), 'seccionId', 's' || (g % 20), 'anioId', 'an1') FROM generate_series(1, 300) g`);
    await ins('categorias', `'cat' || g || '_' || k, '${C}', jsonb_build_object('cargaId', 'cg' || g, 'nombre', 'n' || k, 'peso', 25) FROM generate_series(1, 300) g, generate_series(1, 4) k`);
    await ins('actividades', `'act' || g || '_' || a, '${C}', jsonb_build_object('cargaId', 'cg' || g, 'categoriaId', 'cat' || g || '_' || (1 + a % 4), 'periodoId', 'p' || (1 + a % 4), 'puntosMax', 10, 'nombre', 'A' || a) FROM generate_series(1, 300) g, generate_series(1, 15) a`);
    await ins('calificaciones', `'cal' || g || '_' || a || '_' || e, '${C}', jsonb_build_object('actividadId', 'act' || g || '_' || a, 'estudianteId', 'est' || g || '_' || e, 'puntos', (a + e) % 11) FROM generate_series(1, 300) g, generate_series(1, 15) a, generate_series(1, 15) e`);
    await ins('notas_competencia', `'nc' || g || '_' || e, '${C}', jsonb_build_object('cargaId', 'cg' || g, 'estudianteId', 'est' || g || '_' || e, 'c', '[]'::jsonb) FROM generate_series(1, 300) g, generate_series(1, 15) e`);
    await ins('periodos', `'per' || g, '${C}', jsonb_build_object('anioId', 'an' || (g % 100), 'orden', 1 + (g / 100), 'peso', 25, 'cerrado', g % 2 = 0) FROM generate_series(1, 4000) g`);
  });
  for (const t of ['cargas', 'categorias', 'actividades', 'calificaciones', 'notas_competencia', 'periodos']) await owner().query(`ANALYZE ${t}`);
}, 120_000);
afterAll(async () => {
  await cerrarPoolApp();
  await owner().end();
});

describe('EXPLAIN: las consultas por carga, estudiante y actividad usan índice', () => {
  it('calificaciones por actividad, por estudiante y por celda (actividad+estudiante)', async () => {
    const porAct = await plan(`SELECT id FROM calificaciones WHERE borrado_en IS NULL AND centro_id = $1 AND actividad_id::text = ANY($2::text[])`, [C, ['act5_3']]);
    expect(secuenciales(porAct, 'calificaciones')).toBe(false);
    expect(indices(porAct).join()).toMatch(/calificaciones_(actividad|act_est)/);
    const porEst = await plan(`SELECT id FROM calificaciones WHERE borrado_en IS NULL AND centro_id = $1 AND estudiante_id::text = ANY($2::text[])`, [C, ['est5_3']]);
    expect(secuenciales(porEst, 'calificaciones')).toBe(false);
    expect(indices(porEst).join()).toContain('calificaciones_estudiante_idx');
    const celda = await plan(`SELECT id FROM calificaciones WHERE actividad_id = $1 AND estudiante_id = $2 AND borrado_en IS NULL`, ['act5_3', 'est5_3']);
    expect(indices(celda)).toContain('calificaciones_act_est_uidx');
  });

  it('actividades por carga y periodo; categorías por carga; notas de competencia por carga y por estudiante', async () => {
    const a = await plan(`SELECT id FROM actividades WHERE carga_id = $1 AND periodo_id = $2 AND borrado_en IS NULL`, ['cg7', 'p2']);
    expect(indices(a)).toContain('actividades_carga_periodo_idx');
    const a2 = await plan(`SELECT id FROM actividades WHERE borrado_en IS NULL AND carga_id::text = ANY($1::text[])`, [['cg7', 'cg9']]);
    expect(secuenciales(a2, 'actividades')).toBe(false);
    const c = await plan(`SELECT id FROM categorias WHERE carga_id = $1 AND borrado_en IS NULL`, ['cg7']);
    expect(indices(c)).toContain('categorias_carga_idx');
    const n = await plan(`SELECT id FROM notas_competencia WHERE carga_id = $1 AND estudiante_id = $2 AND borrado_en IS NULL`, ['cg7', 'est7_3']);
    expect(secuenciales(n, 'notas_competencia')).toBe(false);
    expect(indices(n).join()).toMatch(/notas_competencia_(carga_est_uidx|estudiante_idx)/); // cualquiera de los dos índices selectivos
    const n2 = await plan(`SELECT id FROM notas_competencia WHERE borrado_en IS NULL AND carga_id::text = ANY($1::text[])`, [['cg7']]);
    expect(secuenciales(n2, 'notas_competencia')).toBe(false);
    const n3 = await plan(`SELECT id FROM notas_competencia WHERE borrado_en IS NULL AND estudiante_id::text = ANY($1::text[])`, [['est7_3']]);
    expect(indices(n3)).toContain('notas_competencia_estudiante_idx');
  });

  it('periodos de un año ordenados; y el alcance del docente (notas de las actividades de sus cargas) no recorre toda la tabla', async () => {
    const p = await plan(`SELECT id FROM periodos WHERE centro_id = $1 AND anio_id = $2 AND borrado_en IS NULL ORDER BY orden`, [C, 'an7']);
    expect(indices(p)).toContain('periodos_anio_orden_idx');
    const doc = await plan(
      `SELECT id FROM calificaciones WHERE borrado_en IS NULL AND centro_id = $1 AND actividad_id IN (SELECT id FROM actividades WHERE borrado_en IS NULL AND carga_id = ANY($2::text[]))`,
      [C, ['cg1', 'cg2', 'cg3']],
    );
    expect(secuenciales(doc, 'calificaciones')).toBe(false);
    expect(secuenciales(doc, 'actividades')).toBe(false);
  });

  it('las consultas del resumen (matrículas ya indexadas + hot columns) tampoco recorren las tablas de notas', async () => {
    const r = await plan(`SELECT id, datos FROM calificaciones WHERE centro_id = $1 AND borrado_en IS NULL AND actividad_id = ANY($2::text[]) AND estudiante_id = ANY($3::text[]) ORDER BY id`, [C, ['act1_1', 'act1_2', 'act1_3'], ['est1_1', 'est1_2']]);
    expect(secuenciales(r, 'calificaciones')).toBe(false);
  });
});

describe('las columnas generadas siguen a `datos`; la API y el formato plano no cambian', () => {
  it('el registro sigue entero en `datos` y las columnas se actualizan solas', async () => {
    await conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'u' }, async (tx) => {
      const r = await tx.query<{ puntos: string; actividad_id: string; datos: Record<string, unknown> }>(`SELECT puntos::text, actividad_id, datos FROM calificaciones WHERE id = 'cal5_3_4'`);
      expect(r.rows[0]).toMatchObject({ actividad_id: 'act5_3', puntos: '7', datos: { actividadId: 'act5_3', estudianteId: 'est5_4', puntos: 7 } });
      await tx.query(`UPDATE calificaciones SET datos = datos || '{"puntos": 9.5}' WHERE id = 'cal5_3_4'`);
      expect((await tx.query<{ puntos: string }>(`SELECT puntos::text FROM calificaciones WHERE id = 'cal5_3_4'`)).rows[0]?.puntos).toBe('9.5');
      const p = await tx.query<{ cerrado: boolean }>(`SELECT cerrado FROM periodos WHERE id IN ('per1','per2') ORDER BY id`);
      expect(p.rows.map((x) => x.cerrado)).toEqual([false, true]);
      // valores no numéricos no rompen la generación (la API los rechaza antes): quedan en NULL
      await tx.query(`INSERT INTO calificaciones (id, centro_id, datos) VALUES ('cal_txt', '${C}', '{"actividadId":"x","estudianteId":"y","puntos":"abc"}')`);
      expect((await tx.query<{ puntos: string | null }>(`SELECT puntos::text FROM calificaciones WHERE id = 'cal_txt'`)).rows[0]?.puntos).toBeNull();
    });
  });

  it('el mapa de columnas calientes del servidor coincide con las columnas generadas de la BD', async () => {
    const r = await owner().query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND is_generated = 'ALWAYS'`);
    const generadas = new Set(r.rows.map((x) => `${x.table_name}.${x.column_name}`));
    const snake = (s: string): string => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    for (const [col, campos] of Object.entries(COLUMNAS_CALIENTES)) {
      for (const sql of Object.values(campos)) expect(generadas.has(`${snake(col)}.${sql}`), `${col}.${sql}`).toBe(true);
    }
  });
});
