// Matriz 6 roles × endpoints nuevos de negocio (Fase 3A), contra ESCRIBE de js/core/permisos.js (cargado con vm desde el cliente).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargarPermisosDelCliente } from '../scripts/paridad.js';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { cerrarPoolApp, montarMundo, pedir, type Metodo, type Mundo } from './helpers/mundo.js';

const cliente = cargarPermisosDelCliente();
const ROLES: Record<string, string> = { admin_red: 'admin', director: 'dirA', docente: 'docA1', secretaria: 'secA', tutor: 'tutA', estudiante: 'estA1' };
// [método, ruta, colecciones cuyo ESCRIBE exige el rol (todas)]
const ENDPOINTS: [Metodo, string, string[]][] = [
  ['POST', '/matriculas', ['matriculas']],
  ['POST', '/matriculas/x/retirar', ['matriculas']],
  ['POST', '/matriculas/x/reactivar', ['matriculas']],
  ['POST', '/estudiantes/x/baja', ['estudiantes']],
  ['POST', '/estudiantes/x/reactivar', ['estudiantes']],
  ['POST', '/docentes/x/baja', ['docentes']],
  ['POST', '/tutores/x/baja', ['tutores']],
  ['POST', '/tutores/x/vincular', ['tutores']],
  ['POST', '/tutores/x/desvincular', ['tutores']],
  ['POST', '/anios/x/activar', ['anios']],
  ['POST', '/cursos/x/inscripciones', ['inscripciones']],
  ['POST', '/cursos/x/estado', ['cursosExtra']],
  ['POST', '/cursos/x/notas', ['inscripciones']],
  ['POST', '/cursos/x/promover', ['inscripciones']],
  ['POST', '/inscripciones/x/retirar', ['inscripciones']],
  ['POST', '/inscripciones/x/reinscribir', ['inscripciones']],
  ['POST', '/curriculo/versiones/importar', ['curriculoVersiones', 'curriculoContenidos']],
  ['POST', '/curriculo/versiones/x/vigente', ['curriculoVersiones']],
  ['POST', '/horarios/guardar', ['horarios']],
  ['POST', '/franjas/tanda', ['franjas']],
];

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

describe('6 roles × endpoints nuevos', () => {
  const casos: [string, Metodo, string][] = [];
  for (const rol of Object.keys(ROLES)) for (const [met, url] of ENDPOINTS) casos.push([rol, met, url]);
  it.each(casos)('%s %s %s', async (rol, met, url) => {
    const colecciones = ENDPOINTS.find((e) => e[1] === url)![2];
    const permitido = colecciones.every((c) => (cliente.ESCRIBE[rol] ?? []).includes(c));
    const r = await pedir(app, m.s[ROLES[rol]!]!, met, url, {});
    if (permitido) expect([401, 403], `${rol} ${url}: ${r.body}`).not.toContain(r.statusCode);
    else expect(r.statusCode, `${rol} ${url}: ${r.body}`).toBe(403);
  });
  it('sin sesión: 401 en todos', async () => {
    for (const [met, url] of ENDPOINTS) expect((await pedir(app, null, met, url, {})).statusCode, url).toBe(401);
    expect((await pedir(app, null, 'GET', '/comunicados')).statusCode).toBe(401);
    expect((await pedir(app, null, 'POST', '/asistencia/seccion-fecha', {})).statusCode).toBe(401);
  });
  it('lectura de /comunicados para los 6 roles; confirmaciones solo gestores', async () => {
    for (const rol of Object.keys(ROLES)) expect((await pedir(app, m.s[ROLES[rol]!]!, 'GET', '/comunicados')).statusCode, rol).toBe(200);
    for (const rol of Object.keys(ROLES)) {
      const esperado = ['admin_red', 'director', 'secretaria'].includes(rol) ? 404 : 403;
      expect((await pedir(app, m.s[ROLES[rol]!]!, 'GET', '/comunicados/noExiste/confirmaciones')).statusCode, rol).toBe(esperado);
    }
  });
});
