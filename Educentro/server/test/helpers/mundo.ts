// Escenario común de las pruebas de la API: dos centros, usuarios de todos los roles y datos enlazados.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { hashClave } from '../../src/auth/password.js';
import { conContexto } from '../../src/db/contexto.js';
import { crearPool, type Pool } from '../../src/db/pool.js';
import { APP_URL } from './entorno.js';
import { CLAVE_BUENA, entrar, owner, ORIGEN } from './app.js';

export interface Sesion {
  id: string;
  headers: Record<string, string>;
}
export type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

export const A = 'ctr_a';
export const B = 'ctr_b';

let appPool: Pool | null = null;
export const poolApp = (): Pool => (appPool ??= crearPool(APP_URL, { max: 3, nombre: 'test-app' }));
export const cerrarPoolApp = async (): Promise<void> => {
  await appPool?.end();
  appPool = null;
};

/** Inserta una fila de colección con el contexto admin_red (la RLS aplica también aquí). */
export async function sembrar(tabla: string, id: string, centro: string, datos: Record<string, unknown>): Promise<void> {
  await conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'prueba' }, (tx) =>
    tx.query(`INSERT INTO ${tabla} (id, centro_id, datos) VALUES ($1, $2, $3::jsonb)`, [id, centro, JSON.stringify(datos)]),
  );
}

export interface Mundo {
  s: Record<string, Sesion>;
  usuarios: Record<string, string>; // clave → id de usuario
}

const USUARIOS: [clave: string, rol: string, centro: string | null, ref: string | null][] = [
  ['admin', 'admin_red', null, null],
  ['dirA', 'director', A, null],
  ['docA1', 'docente', A, 'd1'],
  ['docA2', 'docente', A, 'd2'],
  ['secA', 'secretaria', A, null],
  ['tutA', 'tutor', A, 't1'],
  ['estA1', 'estudiante', A, 'e1'],
  ['estA2', 'estudiante', A, 'e2'],
  ['dirB', 'director', B, null],
  ['docB', 'docente', B, 'dB'],
];

export async function montarMundo(app: FastifyInstance): Promise<Mundo> {
  const o = owner();
  for (const c of [A, B]) await o.query('INSERT INTO centros (id, nombre) VALUES ($1, $2)', [c, `Centro ${c}`]);
  const hash = await hashClave(CLAVE_BUENA);
  const usuarios: Record<string, string> = {};
  for (const [clave, rol, centro, ref] of USUARIOS) {
    const id = `usr_${clave}`;
    usuarios[clave] = id;
    await o.query('INSERT INTO usuarios (id, centro_id, rol, ref_id, nombre, email, hash) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      id, centro, rol, ref, `Persona ${clave}`, `${clave.toLowerCase()}@prueba.test`, hash,
    ]);
  }
  // Centro A
  await sembrar('secciones', 's1', A, { cursoId: 'cu1', nombre: 'A' });
  await sembrar('secciones', 's2', A, { cursoId: 'cu1', nombre: 'B' });
  await sembrar('docentes', 'd1', A, { nombres: 'Uno' });
  await sembrar('docentes', 'd2', A, { nombres: 'Dos' });
  await sembrar('cargas', 'cg1', A, { docenteId: 'd1', seccionId: 's1', asignaturaId: 'as1' });
  await sembrar('cargas', 'cg2', A, { docenteId: 'd2', seccionId: 's2', asignaturaId: 'as1' });
  await sembrar('estudiantes', 'e1', A, { nombres: 'Est Uno' });
  await sembrar('estudiantes', 'e2', A, { nombres: 'Est Dos' });
  await sembrar('matriculas', 'm1', A, { estudianteId: 'e1', seccionId: 's1', estado: 'activa' });
  await sembrar('matriculas', 'm2', A, { estudianteId: 'e2', seccionId: 's2', estado: 'activa' });
  await sembrar('tutores', 't1', A, { nombres: 'Tutor Uno', estudianteIds: ['e1'] });
  await sembrar('tutores', 't2', A, { nombres: 'Tutor Dos', estudianteIds: ['e2'] });
  await sembrar('actividades', 'act1', A, { cargaId: 'cg1', nombre: 'Tarea 1', puntosMax: 10 });
  await sembrar('actividades', 'act2', A, { cargaId: 'cg2', nombre: 'Tarea 2', puntosMax: 10 });
  await sembrar('categorias', 'cat1', A, { cargaId: 'cg1', nombre: 'Tareas', peso: 100 });
  await sembrar('categorias', 'cat2', A, { cargaId: 'cg2', nombre: 'Tareas', peso: 100 });
  await sembrar('calificaciones', 'cal1', A, { actividadId: 'act1', estudianteId: 'e1', puntos: 8 });
  await sembrar('calificaciones', 'cal2', A, { actividadId: 'act2', estudianteId: 'e2', puntos: 5 });
  await sembrar('asistencia', 'as_1', A, { seccionId: 's1', estudianteId: 'e1', fecha: '2026-01-10', estado: 'P' });
  await sembrar('asistencia', 'as_2', A, { seccionId: 's2', estudianteId: 'e2', fecha: '2026-01-10', estado: 'A' });
  await sembrar('entregas', 'en1', A, { tareaId: 'ta1', cargaId: 'cg1', estudianteId: 'e1' });
  await sembrar('entregas', 'en2', A, { tareaId: 'ta2', cargaId: 'cg2', estudianteId: 'e2' });
  await sembrar('comunicados', 'co1', A, { titulo: 'Para todos', estado: 'publicado', destinatarios: 'todos', lecturas: [{ usuarioId: 'otro', fecha: '2026-01-01T00:00:00Z' }] });
  await sembrar('comunicados', 'co2', A, { titulo: 'Solo docentes', estado: 'publicado', destinatarios: 'docentes' });
  await sembrar('comunicados', 'co3', A, { titulo: 'Borrador', estado: 'borrador', destinatarios: 'todos' });
  await sembrar('comunicados', 'co4', A, { titulo: 'Segmento tutor 2', estado: 'publicado', destinatarios: 'tutores', segmento: { tipo: 'tutor', id: 't2' } });
  await sembrar('periodos', 'p1', A, { nombre: 'P1', orden: 1 });
  await sembrar('periodos', 'p2', A, { nombre: 'P2', orden: 2 });
  await sembrar('periodos', 'p10', A, { nombre: 'P10', orden: 10 });
  // Centro B
  await sembrar('secciones', 'sB', B, { nombre: 'B1' });
  await sembrar('docentes', 'dB', B, { nombres: 'Doc B' });
  await sembrar('cargas', 'cgB', B, { docenteId: 'dB', seccionId: 'sB' });
  await sembrar('estudiantes', 'eB', B, { nombres: 'Est B' });
  await sembrar('matriculas', 'mB', B, { estudianteId: 'eB', seccionId: 'sB', estado: 'activa' });
  await sembrar('actividades', 'actB', B, { cargaId: 'cgB', nombre: 'Act B' });
  await sembrar('calificaciones', 'calB', B, { actividadId: 'actB', estudianteId: 'eB', puntos: 9 });
  await sembrar('comunicados', 'coB', B, { titulo: 'De B', estado: 'publicado', destinatarios: 'todos' });

  const s: Record<string, Sesion> = {};
  for (const [clave] of USUARIOS) {
    const x = await entrar(app, `${clave.toLowerCase()}@prueba.test`, CLAVE_BUENA);
    s[clave] = { id: usuarios[clave] as string, headers: x.headers };
  }
  return { s, usuarios };
}

export function pedir(app: FastifyInstance, ses: Sesion | null, metodo: Metodo, url: string, payload?: unknown, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return app.inject({
    method: metodo,
    url: `/api/v1${url}`,
    headers: { ...(ses?.headers ?? { origin: ORIGEN }), ...extra },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

/** Consulta con contexto admin_red (la RLS FORCE no deja ver filas al propietario sin contexto). */
export async function consultaAdmin<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
  return conContexto(poolApp(), { rol: 'admin_red', centroId: null, usuarioId: 'prueba' }, async (tx) => (await tx.query<R>(sql, params)).rows);
}
