// Batería parametrizada: 6 roles × TODAS las colecciones × acciones (listar/obtener/crear/editar/borrar),
// comparada con ESCRIBE de js/core/permisos.js (cargado con vm desde el cliente, no desde el JSON del servidor).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargarPermisosDelCliente } from '../scripts/paridad.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, cerrarPoolApp, montarMundo, pedir, type Metodo, type Mundo } from './helpers/mundo.js';

const cliente = cargarPermisosDelCliente();
const CLAVES_ROL: Record<string, string> = { admin_red: 'admin', director: 'dirA', docente: 'docA1', secretaria: 'secA', tutor: 'tutA', estudiante: 'estA1' };

/** Lectura denegada por rol (el resto de colecciones las leen todos los roles; el alcance se prueba aparte). */
const SIN_LECTURA: Record<string, string[]> = {
  agenteConfig: ['secretaria', 'tutor', 'estudiante'],
  agenteLog: ['tutor', 'estudiante'],
  planes: ['tutor', 'estudiante'],
  secuencias: ['tutor', 'estudiante'],
  auditoria: ['docente', 'secretaria', 'tutor', 'estudiante'],
};

let app: FastifyInstance;
let m: Mundo;
beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

let n = 0;
/** Registro válido para que `rol` escriba en `col` (cumple las reglas de propiedad de ese rol). */
function cuerpoValido(rol: string, col: string): Record<string, unknown> {
  const k = ++n;
  const base: Record<string, unknown> = rol === 'admin_red' ? { centroId: A } : {};
  if (col === 'usuarios') return { nombre: 'Nuevo', email: `nuevo${k}@prueba.test`, rol: 'docente', refId: null, ...base };
  if (col === 'centros') return { nombre: `Centro nuevo ${k}` };
  if (col === 'calificaciones') return { ...base, actividadId: 'act1', estudianteId: `est_m${k}`, puntos: 7 };
  if (col === 'notasCompetencia') return { ...base, cargaId: 'cg1', estudianteId: `est_m${k}`, c: [] };
  if (col === 'asistencia') return { ...base, seccionId: 's1', estudianteId: `est_m${k}`, fecha: `2027-01-${String(k % 28 + 1).padStart(2, '0')}x${k}`, estado: 'P' };
  if (col === 'agenteConfig') return { ...base, docenteId: rol === 'docente' ? 'd1' : 'd9' };
  if (rol === 'estudiante') return { ...base, estudianteId: 'e1', cargaId: 'cg1', autorId: m.s.estA1!.id, texto: 'hola' };
  return { ...base, cargaId: 'cg1', nombre: `x${k}` };
}

const casos: [string, string][] = [];
for (const rol of Object.keys(CLAVES_ROL)) for (const col of cliente.COLECCIONES) casos.push([rol, col]);

describe('6 roles × colecciones × acciones contra la MATRIZ/ESCRIBE del cliente', () => {
  it.each(casos)('%s sobre %s', async (rol, col) => {
    const ses = m.s[CLAVES_ROL[rol] as string]!;
    const puedeLeer = !(SIN_LECTURA[col] ?? []).includes(rol);
    const puedeEscribir = col !== 'auditoria' && (cliente.ESCRIBE[rol] ?? []).includes(col);

    // listar y obtener
    const l = await pedir(app, ses, 'GET', `/c/${col}?limite=5`);
    expect(l.statusCode, `listar ${rol}/${col}: ${l.body}`).toBe(puedeLeer ? 200 : 403);
    const o = await pedir(app, ses, 'GET', `/c/${col}/no_existe_xyz`);
    expect(o.statusCode, `obtener ${rol}/${col}`).toBe(puedeLeer ? 404 : 403);

    // escritura: sin permiso → 403 en las tres acciones
    if (!puedeEscribir) {
      expect((await pedir(app, ses, 'POST', `/c/${col}`, cuerpoValido(rol, col))).statusCode, `crear ${rol}/${col}`).toBe(403);
      expect((await pedir(app, ses, 'PUT', `/c/${col}/x1`, cuerpoValido(rol, col))).statusCode, `editar ${rol}/${col}`).toBe(403);
      expect((await pedir(app, ses, 'DELETE', `/c/${col}/x1`)).statusCode, `borrar ${rol}/${col}`).toBe(403);
      return;
    }
    // con permiso: ciclo completo crear → editar → borrar
    const c = await pedir(app, ses, 'POST', `/c/${col}`, cuerpoValido(rol, col));
    expect(c.statusCode, `crear ${rol}/${col}: ${c.body}`).toBe(201);
    const id = (c.json() as { id: string }).id;
    const nuevo = { ...cuerpoValido(rol, col), ...(col === 'calificaciones' || col === 'asistencia' ? {} : {}) };
    const antes = c.json() as Record<string, unknown>;
    const e = await pedir(app, ses, 'PUT', `/c/${col}/${id}`, { ...antes, ...Object.fromEntries(Object.entries(nuevo).filter(([k]) => !['estudianteId', 'fecha', 'email', 'actividadId', 'seccionId', 'rol'].includes(k) || !(k in antes))), id });
    expect(e.statusCode, `editar ${rol}/${col}: ${e.body}`).toBe(200);
    const b = await pedir(app, ses, 'DELETE', `/c/${col}/${id}`);
    expect(b.statusCode, `borrar ${rol}/${col}: ${b.body}`).toBe(204);
    expect((await pedir(app, ses, 'GET', `/c/${col}/${id}`)).statusCode).toBe(col === 'usuarios' ? 200 : 404); // usuarios se desactiva, no desaparece
  });

  it('sin sesión: 401 en cualquier colección; colección desconocida: 404', async () => {
    for (const metodo of ['GET', 'POST', 'PUT', 'DELETE'] as Metodo[]) {
      const url = metodo === 'GET' || metodo === 'POST' ? '/c/estudiantes' : '/c/estudiantes/e1';
      const r = await pedir(app, null, metodo, url, metodo === 'POST' || metodo === 'PUT' ? {} : undefined);
      expect(r.statusCode, metodo).toBe(401);
    }
    expect((await pedir(app, m.s.admin!, 'GET', '/c/inventada')).statusCode).toBe(404);
    expect((await pedir(app, m.s.admin!, 'POST', '/c/inventada', {})).statusCode).toBe(404);
  });
});
