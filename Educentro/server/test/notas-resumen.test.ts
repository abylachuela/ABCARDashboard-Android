// GET /notas/resumen == EDU.consultas.resumenNotas del cliente sobre los mismos datos (semilla demo: modelo ponderado en
// cen_1/cen_2 y por competencias en cen_3), para cada rol, respetando centro y alcance.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashClave } from '../src/auth/password.js';
import type { SemillaDemo } from '../src/dev/semilla-demo.js';
import { CLAVE_BUENA, crearApp, entrar, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { cargarEduCliente, type EduCliente } from './helpers/cliente-edu.js';
import { cerrarPoolApp, pedir, type Sesion } from './helpers/mundo.js';
import { cargarSemilla, crearAcceso } from './helpers/semilla.js';

let app: FastifyInstance;
let demo: SemillaDemo;
const cliente: EduCliente = cargarEduCliente();
const ses: Record<string, Sesion> = {};
type Fila = Record<string, unknown> & { estudianteId: string; cargaId: string; final: number | null; modelo?: string };

const ACCESOS = ['usr_dir_1', 'usr_sec_1', 'usr_doc_1_01', 'usr_doc_1_03', 'usr_tut_1', 'usr_est_1', 'usr_dir_2', 'usr_dir_3', 'usr_doc_3_01', 'usr_sec_3'];

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  demo = await cargarSemilla();
  for (const id of ACCESOS) {
    const email = await crearAcceso(demo, id);
    const x = await entrar(app, email, CLAVE_BUENA);
    ses[id] = { id, headers: x.headers };
  }
  await owner().query("INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash) VALUES ('usr_admin', NULL, 'admin_red', 'Admin', 'admin@semilla.test', $1)", [await hashClave(CLAVE_BUENA)]);
  const x = await entrar(app, 'admin@semilla.test', CLAVE_BUENA);
  ses.admin = { id: 'usr_admin', headers: x.headers };
}, 120_000);
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

const COLS = ['matriculas', 'cargas', 'categorias', 'actividades', 'calificaciones', 'notasCompetencia', 'periodos', 'escalas'];

/** Lo que haría el cliente en modo API: cargar las colecciones que ve (paginadas) y calcular con su propio resumenNotas. */
async function esperadoPorElCliente(s: Sesion, centro?: string): Promise<Fila[]> {
  const d: Record<string, unknown[]> = {};
  for (const col of COLS) {
    d[col] = [];
    for (let off: number | null = 0; off !== null; ) {
      const r = (await pedir(app, s, 'GET', `/c/${col}?limite=500&offset=${off}${centro ? `&centroId=${centro}` : ''}&orden=id`)).json() as { datos: unknown[]; siguiente: number | null };
      d[col].push(...r.datos);
      off = r.siguiente;
    }
  }
  return JSON.parse(JSON.stringify(cliente.consultas.resumenNotas(d))) as Fila[];
}
const del = async (s: Sesion, q = ''): Promise<{ datos: Fila[]; total: number }> => {
  const r = await pedir(app, s, 'GET', `/notas/resumen${q}`);
  expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
  return r.json() as { datos: Fila[]; total: number };
};
const clave = (f: Fila) => `${f.estudianteId}|${f.cargaId}`;

describe('GET /notas/resumen == resumenNotas del cliente (semilla demo)', () => {
  for (const [rol, id, centro, min] of [
    ['director cen_1 (ponderado)', 'usr_dir_1', undefined, 50],
    ['secretaría cen_1', 'usr_sec_1', undefined, 50],
    ['docente cen_1 (sus cargas)', 'usr_doc_1_01', undefined, 5],
    ['docente cen_1 (otra)', 'usr_doc_1_03', undefined, 5],
    ['tutor cen_1 (su hijo)', 'usr_tut_1', undefined, 3],
    ['estudiante cen_1 (él mismo)', 'usr_est_1', undefined, 3],
    ['director cen_2', 'usr_dir_2', undefined, 20],
    ['director cen_3 (competencias)', 'usr_dir_3', undefined, 50],
    ['docente cen_3 (competencias)', 'usr_doc_3_01', undefined, 5],
    ['secretaría cen_3', 'usr_sec_3', undefined, 50],
    ['admin_red cen_1', 'admin', 'cen_1', 50],
    ['admin_red cen_3', 'admin', 'cen_3', 50],
  ] as [string, string, string | undefined, number][]) {
    it(`${rol}: mismas filas, mismos valores (sin redondear), mismo orden`, async () => {
      const s = ses[id] as Sesion;
      const esperado = await esperadoPorElCliente(s, centro);
      const r = await del(s, centro ? `?centroId=${centro}` : '');
      expect(esperado.length).toBeGreaterThanOrEqual(min);
      expect(r.total).toBe(esperado.length);
      expect(r.datos.map(clave)).toEqual(esperado.map(clave));
      expect(r.datos).toEqual(esperado); // incluye final, pct, aprobado, periodos, escala y (competencias) estado, cf, via, calc
    });
  }

  it('ambos modelos aparecen y las filas de competencias traen estado y cf', async () => {
    const c1 = (await del(ses.usr_dir_1 as Sesion)).datos;
    const c3 = (await del(ses.usr_dir_3 as Sesion)).datos;
    expect(c1.every((f) => f.modelo === undefined)).toBe(true);
    expect(c3.every((f) => f.modelo === 'competencias' && typeof f.estado === 'string')).toBe(true);
    expect(c3.some((f) => f.estado === 'Aprobado')).toBe(true);
    expect(c1.some((f) => f.final !== null && !Number.isInteger(f.final))).toBe(true); // sin redondear
  });

  it('filtros por sección, asignatura, estudiante y periodo == el mismo filtro sobre la salida del cliente', async () => {
    const s = ses.usr_dir_1 as Sesion;
    const todo = await esperadoPorElCliente(s);
    const sec = todo[0]!.seccionId as string;
    const car = todo[0]!.cargaId;
    const est = todo[0]!.estudianteId;
    expect((await del(s, `?seccionId=${sec}`)).datos).toEqual(todo.filter((f) => f.seccionId === sec));
    expect((await del(s, `?cargaId=${car}`)).datos).toEqual(todo.filter((f) => f.cargaId === car));
    expect((await del(s, `?estudianteId=${est}`)).datos).toEqual(todo.filter((f) => f.estudianteId === est));
    const conPeriodo = (await del(s, `?cargaId=${car}&periodoId=per_1_1`)).datos;
    const base = todo.filter((f) => f.cargaId === car);
    expect(conPeriodo.map((f) => { const { notaPeriodo, ...resto } = f; void notaPeriodo; return resto; })).toEqual(base);
    for (const f of conPeriodo) {
      const x = (f.periodos as { periodoId: string; nota: number | null }[]).find((p) => p.periodoId === 'per_1_1');
      expect(f.notaPeriodo).toBe(x?.nota ?? null);
    }
    const c3 = (await del(ses.usr_dir_3 as Sesion, '?periodoId=per_3_2')).datos;
    expect(c3.some((f) => typeof f.notaPeriodo === 'number')).toBe(true);
  });

  it('respeta centro y alcance: el docente no ve otras cargas; tutor/estudiante solo lo suyo; otro centro y datos ajenos → vacío o error', async () => {
    const doc = (await del(ses.usr_doc_1_01 as Sesion)).datos;
    const propias = new Set((demo.cargas ?? []).filter((c) => c.docenteId === 'doc_1_01').map((c) => c.id));
    expect(doc.length).toBeGreaterThan(0);
    expect(doc.every((f) => propias.has(f.cargaId))).toBe(true);
    const otraCarga = (demo.cargas ?? []).find((c) => c.docenteId === 'doc_1_02')!.id as string;
    expect((await del(ses.usr_doc_1_01 as Sesion, `?cargaId=${otraCarga}`)).datos).toEqual([]);
    expect((await del(ses.usr_est_1 as Sesion)).datos.every((f) => f.estudianteId === 'est_1_01')).toBe(true);
    expect((await del(ses.usr_est_1 as Sesion, '?estudianteId=est_1_02')).datos).toEqual([]);
    const tutor = (await del(ses.usr_tut_1 as Sesion)).datos;
    const hijos = new Set(((demo.tutores ?? []).find((t) => t.id === 'tut_1_01')?.estudianteIds as string[]) ?? []);
    expect(tutor.every((f) => hijos.has(f.estudianteId))).toBe(true);
    // el director de un centro no ve otro, y pedir otro centro es 403; admin_red debe indicarlo
    expect((await pedir(app, ses.usr_dir_1 as Sesion, 'GET', '/notas/resumen?centroId=cen_3')).statusCode).toBe(403);
    expect((await pedir(app, ses.admin as Sesion, 'GET', '/notas/resumen')).statusCode).toBe(422);
    expect((await pedir(app, ses.usr_dir_1 as Sesion, 'GET', '/notas/resumen?periodoId=per_3_1')).statusCode).toBe(404); // periodo de otro centro
    expect((await pedir(app, ses.usr_dir_1 as Sesion, 'GET', `/notas/resumen?seccionId=${(demo.secciones ?? []).find((x) => x.centroId === 'cen_3')!.id}`)).json()).toMatchObject({ datos: [], total: 0 });
    expect((await pedir(app, null, 'GET', '/notas/resumen')).statusCode).toBe(401);
    expect((await pedir(app, ses.usr_dir_1 as Sesion, 'GET', '/notas/resumen?limite=5')).statusCode).toBe(422); // solo parámetros conocidos
  });

  it('el resultado es el mismo con el cálculo del servidor tras guardar notas por la API (sin redondear)', async () => {
    const s = ses.usr_doc_1_01 as Sesion;
    const act = (demo.actividades ?? []).find((a) => a.cargaId === (demo.cargas ?? []).find((c) => c.docenteId === 'doc_1_01')!.id && a.periodoId === 'per_1_3')!;
    const est = (demo.matriculas ?? []).find((mm) => mm.seccionId === (demo.cargas ?? []).find((c) => c.id === act.cargaId)!.seccionId)!.estudianteId as string;
    const r = await pedir(app, s, 'PUT', '/notas/calificaciones/lote', { registros: [{ actividadId: act.id, estudianteId: est, puntos: 13.37 }] });
    expect(r.statusCode).toBe(200);
    expect(await esperadoPorElCliente(s)).toEqual((await del(s)).datos);
    const fila = (await del(s, `?cargaId=${act.cargaId}&estudianteId=${est}`)).datos[0]!;
    expect(fila.final).not.toBeNull();
  });
});
