// Visibilidad de comunicados resuelta en el SERVIDOR: matriz completa de usuarios × comunicados, por GET /c/comunicados y
// GET /comunicados; ningún rol sin gestión ve borradores ni comunicados ajenos; contadores calculados por el servidor.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, consultaAdmin, montarMundo, pedir, sembrar, type Mundo } from './helpers/mundo.js';

let app: FastifyInstance;
let m: Mundo;
const S = (k: string) => m.s[k]!;
const base = { titulo: 'T', cuerpo: 'Cuerpo del comunicado', estado: 'publicado', fecha: '2026-01-02' };
const SEG = (tipo: string, id: string) => ({ tipo, id });

const VISIBLES: Record<string, string[]> = {
  cTodos: ['docA1', 'docA2', 'tutA', 'estA1', 'estA2'],
  cDoc: ['docA1', 'docA2'],
  cTut: ['tutA'],
  cEst: ['estA1', 'estA2'],
  cSegTutor: ['tutA'],
  cSecS1: ['docA1', 'estA1', 'tutA'],
  cSecS2: ['docA2', 'estA2'],
  cCursoCu1: ['docA1', 'docA2', 'estA1', 'estA2', 'tutA'],
  cCursoZ: [],
  cDocSecS2: ['docA2'],
  cBorrador: [],
};

beforeAll(async () => {
  await prepararBD();
  await limpiarBD();
  app = (await crearApp()).app;
  m = await montarMundo(app);
  await sembrar('secciones', 'sZ', A, { cursoId: 'cuZ', nombre: 'Z' });
  // el mundo trae co1..co4; se agregan los de esta matriz (se borran los demás para que la matriz sea exacta)
  await consultaAdmin("UPDATE comunicados SET borrado_en = now()");
  const ins = (id: string, datos: Record<string, unknown>, centro = A) => sembrar('comunicados', id, centro, { ...base, ...datos });
  await ins('cTodos', { destinatarios: 'todos' });
  await ins('cDoc', { destinatarios: 'docentes' });
  await ins('cTut', { destinatarios: 'tutores' });
  await ins('cEst', { destinatarios: 'estudiantes' });
  await ins('cSegTutor', { destinatarios: 'tutores', segmento: SEG('tutor', 't1') });
  await ins('cSecS1', { destinatarios: 'todos', segmento: SEG('seccion', 's1') });
  await ins('cSecS2', { destinatarios: 'todos', segmento: SEG('seccion', 's2') });
  await ins('cCursoCu1', { destinatarios: 'todos', segmento: SEG('curso', 'cu1') });
  await ins('cCursoZ', { destinatarios: 'todos', segmento: SEG('curso', 'cuZ') });
  await ins('cDocSecS2', { destinatarios: 'docentes', segmento: SEG('seccion', 's2') });
  await ins('cBorrador', { destinatarios: 'todos', estado: 'borrador' });
  await ins('cB', { destinatarios: 'todos' }, B);
});
afterAll(async () => {
  await app.close();
  await cerrarPoolApp();
  await owner().end();
});

const ids = (r: { json(): unknown }): string[] => ((r.json() as { datos: { id: string }[] }).datos).map((x) => x.id).sort();

describe('matriz usuarios × comunicados (GET /c/comunicados y GET /comunicados)', () => {
  for (const ruta of ['/c/comunicados', '/comunicados']) {
    for (const usuario of ['docA1', 'docA2', 'tutA', 'estA1', 'estA2']) {
      it(`${ruta}: ${usuario} ve exactamente los dirigidos a él (nunca borradores ni ajenos)`, async () => {
        const esperado = Object.entries(VISIBLES).filter(([, us]) => us.includes(usuario)).map(([k]) => k).sort();
        const r = await pedir(app, S(usuario), 'GET', ruta);
        expect(r.statusCode, r.body).toBe(200);
        expect(ids(r)).toEqual(esperado);
        expect(ids(r)).not.toContain('cBorrador');
        expect(ids(r)).not.toContain('cB');
      });
    }
    it(`${ruta}: dirección y secretaría ven TODO su centro (con borradores); admin_red todos los centros; dirB solo el suyo`, async () => {
      const todosA = Object.keys(VISIBLES).sort();
      expect(ids(await pedir(app, S('dirA'), 'GET', ruta))).toEqual(todosA);
      expect(ids(await pedir(app, S('secA'), 'GET', ruta))).toEqual(todosA);
      expect(ids(await pedir(app, S('admin'), 'GET', ruta))).toEqual([...todosA, 'cB'].sort());
      expect(ids(await pedir(app, S('dirB'), 'GET', ruta))).toEqual(['cB']);
      expect(ids(await pedir(app, S('docB'), 'GET', ruta))).toEqual(['cB']);
    });
  }
  it('GET /c/comunicados/:id: lo invisible es 404 (no se filtra su existencia)', async () => {
    for (const [id, us] of Object.entries(VISIBLES)) {
      for (const u of ['docA1', 'docA2', 'tutA', 'estA1', 'estA2']) expect((await pedir(app, S(u), 'GET', `/c/comunicados/${id}`)).statusCode, `${u}/${id}`).toBe(us.includes(u) ? 200 : 404);
    }
    expect((await pedir(app, S('dirA'), 'GET', '/c/comunicados/cB')).statusCode).toBe(404);
  });
  it('confirmar lectura solo de lo que se ve (ruta controlada): segmento ajeno y borrador → 404', async () => {
    expect((await pedir(app, S('docA2'), 'POST', '/comunicados/cSecS1/lectura')).statusCode).toBe(404);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/cSecS2/lectura')).statusCode).toBe(404);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/cBorrador/lectura')).statusCode).toBe(404);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/cCursoZ/lectura')).statusCode).toBe(404);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/cSecS1/lectura')).statusCode).toBe(200);
    expect((await pedir(app, S('tutA'), 'POST', '/comunicados/cSecS1/lectura')).statusCode).toBe(200);
  });
});

describe('contadores y confirmaciones calculados en el servidor', () => {
  it('gestores: totalDestinatarios y totalLeidos; el resto no los recibe y solo ve sus propias lecturas', async () => {
    const lista = (await pedir(app, S('dirA'), 'GET', '/comunicados')).json() as { datos: Record<string, unknown>[] };
    const por = (id: string) => lista.datos.find((x) => x.id === id)!;
    expect(por('cTodos')).toMatchObject({ totalDestinatarios: 5, totalLeidos: 0 });
    expect(por('cDoc')).toMatchObject({ totalDestinatarios: 2 });
    expect(por('cEst')).toMatchObject({ totalDestinatarios: 2 });
    expect(por('cSegTutor')).toMatchObject({ totalDestinatarios: 1 });
    expect(por('cSecS1')).toMatchObject({ totalDestinatarios: 3, totalLeidos: 2 }); // estA1 y tutA confirmaron arriba
    expect(por('cCursoCu1')).toMatchObject({ totalDestinatarios: 5 });
    expect(por('cCursoZ')).toMatchObject({ totalDestinatarios: 0 });
    expect(por('cBorrador')).toMatchObject({ totalDestinatarios: 0 });
    const est = (await pedir(app, S('estA1'), 'GET', '/comunicados')).json() as { datos: Record<string, unknown>[] };
    const x = est.datos.find((y) => y.id === 'cSecS1')!;
    expect(x).not.toHaveProperty('totalDestinatarios');
    expect(x.leido).toBe(true);
    expect((x.lecturas as { usuarioId: string }[]).map((l) => l.usuarioId)).toEqual([S('estA1').id]);
    expect(est.datos.find((y) => y.id === 'cTodos')!.leido).toBe(false);
  });
  it('GET /comunicados/:id/confirmaciones: solo gestores; lista quién debe leer y quién ya leyó', async () => {
    const r = (await pedir(app, S('secA'), 'GET', '/comunicados/cSecS1/confirmaciones')).json() as { datos: { usuarioId: string; leido: boolean; rol: string }[] };
    expect(r.datos.map((x) => x.rol).sort()).toEqual(['docente', 'estudiante', 'tutor']);
    expect(r.datos.filter((x) => x.leido).map((x) => x.usuarioId).sort()).toEqual([S('estA1').id, S('tutA').id].sort());
    for (const u of ['docA1', 'tutA', 'estA1']) expect((await pedir(app, S(u), 'GET', '/comunicados/cSecS1/confirmaciones')).statusCode, u).toBe(403);
    expect((await pedir(app, S('dirB'), 'GET', '/comunicados/cSecS1/confirmaciones')).statusCode).toBe(404);
  });
  it('sin sesión → 401', async () => {
    expect((await pedir(app, null, 'GET', '/comunicados')).statusCode).toBe(401);
  });
});
