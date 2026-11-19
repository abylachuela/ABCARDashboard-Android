import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGEN, crearApp, limpiarBD, owner, prepararBD } from './helpers/app.js';
import { A, B, cerrarPoolApp, montarMundo, pedir, poolApp, type Mundo } from './helpers/mundo.js';

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
const S = (k: string) => m.s[k]!;
const ids = (r: { json(): unknown }): string[] => ((r.json() as { datos: { id: string }[] }).datos).map((x) => x.id);

describe('aislamiento entre centros por API', () => {
  it('IDs de otro centro: 404 en GET, PUT y DELETE (sin revelar que existen)', async () => {
    for (const [col, id] of [['estudiantes', 'eB'], ['calificaciones', 'calB'], ['actividades', 'actB'], ['comunicados', 'coB'], ['centros', B]] as const) {
      expect((await pedir(app, S('dirA'), 'GET', `/c/${col}/${id}`)).statusCode, `GET ${col}`).toBe(404);
      expect((await pedir(app, S('dirA'), 'PUT', `/c/${col}/${id}`, { nombre: 'hack', centroId: A })).statusCode, `PUT ${col}`).toBe(col === 'centros' ? 403 : 404);
      expect((await pedir(app, S('dirA'), 'DELETE', `/c/${col}/${id}`)).statusCode, `DELETE ${col}`).toBe(col === 'centros' ? 403 : 404);
    }
    const sigue = await pedir(app, S('admin'), 'GET', '/c/estudiantes/eB');
    expect(sigue.statusCode).toBe(200);
    expect((sigue.json() as { nombres: string }).nombres).toBe('Est B');
  });

  it('los listados no mezclan centros; admin_red ve ambos y puede filtrar', async () => {
    const a = ids(await pedir(app, S('dirA'), 'GET', '/c/estudiantes'));
    expect(a.sort()).toEqual(['e1', 'e2']);
    expect(ids(await pedir(app, S('dirB'), 'GET', '/c/estudiantes'))).toEqual(['eB']);
    expect(ids(await pedir(app, S('admin'), 'GET', '/c/estudiantes')).sort()).toEqual(['e1', 'e2', 'eB']);
    expect(ids(await pedir(app, S('admin'), 'GET', `/c/estudiantes?centroId=${B}`))).toEqual(['eB']);
    expect((await pedir(app, S('dirA'), 'GET', `/c/estudiantes?centroId=${B}`)).statusCode).toBe(403);
    expect(ids(await pedir(app, S('dirA'), 'GET', `/c/estudiantes?f.centroId=${B}`))).toEqual([]);
  });

  it('crear en otro centro: 403; el cliente no decide centroId (mass assignment)', async () => {
    expect((await pedir(app, S('dirA'), 'POST', '/c/estudiantes', { centroId: B, nombres: 'X' })).statusCode).toBe(403);
    const ok = await pedir(app, S('dirA'), 'POST', '/c/estudiantes', { nombres: 'Sin centro' });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { centroId: string }).centroId).toBe(A);
    // PUT con centroId distinto del propio: 403; con el propio pero distinto del registro: imposible (RLS)
    expect((await pedir(app, S('dirA'), 'PUT', '/c/estudiantes/e1', { centroId: B, nombres: 'X' })).statusCode).toBe(403);
    // lote con un registro de otro centro: aborta TODO
    const lote = await pedir(app, S('dirA'), 'POST', '/c/estudiantes/lote', { registros: [{ id: 'lote_ok', nombres: 'ok' }, { id: 'lote_mal', centroId: B }] });
    expect(lote.statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'GET', '/c/estudiantes/lote_ok')).statusCode).toBe(404);
    // admin_red debe indicar el centro y este debe existir
    expect((await pedir(app, S('admin'), 'POST', '/c/estudiantes', { nombres: 'X' })).statusCode).toBe(422);
    expect((await pedir(app, S('admin'), 'POST', '/c/estudiantes', { nombres: 'X', centroId: 'no_existe' })).statusCode).toBe(422);
  });

  it('un registro no puede cambiar de centro ni usarse el id de otro centro para crear', async () => {
    expect((await pedir(app, S('admin'), 'PUT', '/c/estudiantes/e1', { nombres: 'X', centroId: B })).statusCode).toBe(422);
    const dup = await pedir(app, S('dirA'), 'POST', '/c/estudiantes', { id: 'eB', nombres: 'colisión' });
    expect(dup.statusCode).toBe(409);
    expect((await pedir(app, S('admin'), 'GET', '/c/estudiantes/eB')).json()).toMatchObject({ nombres: 'Est B', centroId: B });
  });

  it('centros: solo se ve el propio y solo admin_red escribe', async () => {
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/centros'))).toEqual([A]);
    expect(ids(await pedir(app, S('admin'), 'GET', '/c/centros')).sort()).toEqual([A, B]);
    expect((await pedir(app, S('dirA'), 'POST', '/c/centros', { nombre: 'Nuevo' })).statusCode).toBe(403);
    const c = await pedir(app, S('admin'), 'POST', '/c/centros', { nombre: 'Centro C', ciudad: 'Santiago' });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ nombre: 'Centro C', ciudad: 'Santiago', activo: true });
  });
});

describe('alcance: docente, tutor y estudiante', () => {
  it('docente: solo sus cargas/secciones/estudiantes en listados y por id', async () => {
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/cargas'))).toEqual(['cg1']);
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/secciones'))).toEqual(['s1']);
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/estudiantes'))).toEqual(['e1']);
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/actividades'))).toEqual(['act1']);
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/calificaciones'))).toEqual(['cal1']);
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/asistencia'))).toEqual(['as_1']);
    expect((await pedir(app, S('docA1'), 'GET', '/c/calificaciones/cal2')).statusCode).toBe(404);
    expect((await pedir(app, S('docA1'), 'GET', '/c/estudiantes/e2')).statusCode).toBe(404);
  });

  it('docente fuera de su carga: no escribe notas, actividades, categorías ni asistencia ajenas', async () => {
    const d = S('docA1');
    expect((await pedir(app, d, 'POST', '/c/calificaciones', { actividadId: 'act2', estudianteId: 'e2', puntos: 10 })).statusCode).toBe(403);
    expect((await pedir(app, d, 'PUT', '/c/calificaciones/cal2', { actividadId: 'act2', estudianteId: 'e2', puntos: 10 })).statusCode).toBe(404);
    expect((await pedir(app, d, 'POST', '/c/calificaciones', { actividadId: 'no_hay', estudianteId: 'e1', puntos: 1 })).statusCode).toBe(422);
    expect((await pedir(app, d, 'POST', '/c/actividades', { cargaId: 'cg2', nombre: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/categorias', { cargaId: 'cg2', nombre: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/actividades', { nombre: 'sin carga' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/asistencia', { seccionId: 's2', estudianteId: 'e2', fecha: '2030-01-01' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/c/planes', { cargaId: 'cg2', tema: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'DELETE', '/c/actividades/act2')).statusCode).toBe(404);
    // no puede «robar» una actividad propia moviéndola a otra carga
    expect((await pedir(app, d, 'PUT', '/c/actividades/act1', { cargaId: 'cg2', nombre: 'mover' })).statusCode).toBe(403);
    // lo suyo sí
    expect((await pedir(app, d, 'PUT', '/c/calificaciones/cal1', { actividadId: 'act1', estudianteId: 'e1', puntos: 9 })).statusCode).toBe(200);
  });

  it('tutor: solo sus hijos; estudiante: solo él mismo (no ve a otro del mismo centro)', async () => {
    expect(ids(await pedir(app, S('tutA'), 'GET', '/c/estudiantes'))).toEqual(['e1']);
    expect(ids(await pedir(app, S('tutA'), 'GET', '/c/calificaciones'))).toEqual(['cal1']);
    expect(ids(await pedir(app, S('tutA'), 'GET', '/c/tutores'))).toEqual(['t1']);
    expect(ids(await pedir(app, S('tutA'), 'GET', '/c/matriculas'))).toEqual(['m1']);
    expect((await pedir(app, S('tutA'), 'GET', '/c/estudiantes/e2')).statusCode).toBe(404);
    expect((await pedir(app, S('tutA'), 'GET', '/c/calificaciones/cal2')).statusCode).toBe(404);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/estudiantes'))).toEqual(['e1']);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/calificaciones'))).toEqual(['cal1']);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/tutores'))).toEqual(['t1']);
    expect((await pedir(app, S('estA2'), 'GET', '/c/calificaciones/cal1')).statusCode).toBe(404);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/entregas'))).toEqual(['en1']);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/cargas'))).toEqual(['cg1']);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/docentes'))).toEqual(['d1']);
  });

  it('estudiante: solo escribe sus entregas, intentos y mensajes; no los de otro', async () => {
    const e = S('estA1');
    expect((await pedir(app, e, 'POST', '/c/entregas', { estudianteId: 'e2', cargaId: 'cg2' })).statusCode).toBe(403);
    expect((await pedir(app, e, 'POST', '/c/entregas', { estudianteId: 'e1', cargaId: 'cg2' })).statusCode).toBe(403);
    expect((await pedir(app, e, 'PUT', '/c/entregas/en2', { estudianteId: 'e1', cargaId: 'cg1' })).statusCode).toBe(404);
    expect((await pedir(app, e, 'POST', '/c/intentos', { estudianteId: 'e2', cargaId: 'cg1' })).statusCode).toBe(403);
    expect((await pedir(app, e, 'POST', '/c/foroMensajes', { autorId: 'usr_estA2', cargaId: 'cg1' })).statusCode).toBe(403);
    expect((await pedir(app, e, 'POST', '/c/foroMensajes', { autorId: S('estA1').id, cargaId: 'cg1', texto: 'hola' })).statusCode).toBe(201);
    expect((await pedir(app, e, 'POST', '/c/calificaciones', { actividadId: 'act1', estudianteId: 'e1', puntos: 10 })).statusCode).toBe(403);
    expect((await pedir(app, S('tutA'), 'POST', '/c/entregas', { estudianteId: 'e1', cargaId: 'cg1' })).statusCode).toBe(403);
  });

  it('comunicados: audiencia y segmento por rol; solo se ve la propia lectura', async () => {
    expect(ids(await pedir(app, S('docA1'), 'GET', '/c/comunicados')).sort()).toEqual(['co1', 'co2']);
    expect(ids(await pedir(app, S('estA1'), 'GET', '/c/comunicados'))).toEqual(['co1']);
    expect(ids(await pedir(app, S('tutA'), 'GET', '/c/comunicados'))).toEqual(['co1']); // co4 es del tutor t2
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/comunicados')).sort()).toEqual(['co1', 'co2', 'co3', 'co4']);
    const co1 = (await pedir(app, S('estA1'), 'GET', '/c/comunicados/co1')).json() as { lecturas: unknown[] };
    expect(co1.lecturas).toEqual([]); // la lectura de «otro» no se revela
    // registrar lectura propia (idempotente) y rechazos
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/co1/lectura')).statusCode).toBe(200);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/co1/lectura')).statusCode).toBe(200);
    const dir = (await pedir(app, S('dirA'), 'GET', '/c/comunicados/co1')).json() as { lecturas: { usuarioId: string }[] };
    expect(dir.lecturas.filter((l) => l.usuarioId === S('estA1').id).length).toBe(1);
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/co2/lectura')).statusCode).toBe(404); // audiencia docentes
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/co3/lectura')).statusCode).toBe(404); // borrador
    expect((await pedir(app, S('tutA'), 'POST', '/comunicados/co4/lectura')).statusCode).toBe(404); // segmento de otro tutor
    expect((await pedir(app, S('estA1'), 'POST', '/comunicados/coB/lectura')).statusCode).toBe(404); // otro centro
    // el director no puede falsear lecturas al editar
    const put = await pedir(app, S('dirA'), 'PUT', '/c/comunicados/co1', { titulo: 'Para todos', estado: 'publicado', destinatarios: 'todos', lecturas: [{ usuarioId: 'falso' }] });
    expect((put.json() as { lecturas: { usuarioId: string }[] }).lecturas.some((l) => l.usuarioId === 'falso')).toBe(false);
  });
});

describe('escalada de rol y mass-assignment en usuarios', () => {
  it('el director no crea ni promueve admin_red; nadie se cambia el rol ni el centro', async () => {
    const d = S('dirA');
    expect((await pedir(app, d, 'POST', '/c/usuarios', { nombre: 'X', email: 'x1@prueba.test', rol: 'admin_red' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'PUT', `/c/usuarios/${S('admin').id}`, { nombre: 'X' })).statusCode).toBe(404); // admin_red no es visible
    expect((await pedir(app, d, 'PUT', `/c/usuarios/${S('docA1').id}`, { rol: 'admin_red' })).statusCode).toBe(403);
    expect((await pedir(app, d, 'PUT', `/c/usuarios/${S('dirA').id}`, { rol: 'docente' })).statusCode).toBe(403); // propio rol
    expect((await pedir(app, d, 'PUT', `/c/usuarios/${S('docA1').id}`, { centroId: B })).statusCode).toBe(422);
    expect((await pedir(app, d, 'PUT', `/c/usuarios/${S('dirB').id}`, { nombre: 'X' })).statusCode).toBe(404); // otro centro
    expect((await pedir(app, d, 'POST', '/c/usuarios', { nombre: 'X', email: 'x2@prueba.test', rol: 'docente', centroId: B })).statusCode).toBe(403);
    expect((await pedir(app, S('docA1'), 'PUT', `/c/usuarios/${S('docA1').id}`, { rol: 'director' })).statusCode).toBe(403);
    expect((await pedir(app, S('secA'), 'POST', '/c/usuarios', { nombre: 'X', email: 'x3@prueba.test', rol: 'docente' })).statusCode).toBe(403);
    expect((await pedir(app, S('admin'), 'POST', '/c/usuarios', { nombre: 'Otro admin', email: 'x4@prueba.test', rol: 'admin_red' })).statusCode).toBe(201);
  });

  it('id, rol u otros campos de sistema en el cuerpo no se aplican', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Ana', email: 'ANA@prueba.test ', rol: 'docente', hash: 'x', activo: true, debeCambiarClave: false, intentos: 0 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ email: 'ana@prueba.test', centroId: A, debeCambiarClave: true });
    const { rows } = await owner().query('SELECT hash FROM usuarios WHERE email = $1', ['ana@prueba.test']);
    expect(rows[0].hash).toMatch(/^\$argon2id\$/);
  });
});

describe('entradas hostiles: filtros, orden, límites, tamaño, lote', () => {
  it('f.campo con SQL/JSON raros no inyecta: o se ignora el valor o se rechaza el nombre', async () => {
    for (const v of ["' OR 1=1 --", "x'; DROP TABLE estudiantes; --", '{"$ne":null}', '\\u0000', '%00', '"; select pg_sleep(5);--', 'a'.repeat(150)]) {
      const r = await pedir(app, S('dirA'), 'GET', `/c/estudiantes?f.nombres=${encodeURIComponent(v)}`);
      expect(r.statusCode, v).toBe(200);
      expect(ids(r)).toEqual([]);
    }
    for (const campo of ["x'--", 'a;b', 'a b', '1abc', 'a->b', '__proto__x\'', 'x'.repeat(60)]) {
      const r = await pedir(app, S('dirA'), 'GET', `/c/estudiantes?f.${encodeURIComponent(campo)}=1`);
      expect(r.statusCode, campo).toBe(422);
    }
    expect((await owner().query("SELECT to_regclass('estudiantes') AS t")).rows[0].t).not.toBeNull();
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/estudiantes?f.nombres=Est Uno'))).toEqual(['e1']);
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/cargas?f.docenteId=d1&f.docenteId=d2')).sort()).toEqual(['cg1', 'cg2']);
    expect((await pedir(app, S('dirA'), 'GET', `/c/estudiantes?${Array.from({ length: 11 }, (_, i) => `f.a${i}=1`).join('&')}`)).statusCode).toBe(422);
  });

  it('orden no permitido (inyección o campos de sistema ocultos) → 422; orden numérico correcto', async () => {
    for (const o of ["nombres;DROP TABLE x", "a' or '1'='1", 'a b', '1x', '(select 1)', 'x'.repeat(50)]) {
      expect((await pedir(app, S('dirA'), 'GET', `/c/periodos?orden=${encodeURIComponent(o)}`)).statusCode, o).toBe(422);
    }
    expect((await pedir(app, S('dirA'), 'GET', '/c/usuarios?orden=hash')).statusCode).toBe(422);
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/periodos?orden=orden'))).toEqual(['p1', 'p2', 'p10']); // numérico, no textual
    expect(ids(await pedir(app, S('dirA'), 'GET', '/c/periodos?orden=orden&desc=true'))).toEqual(['p10', 'p2', 'p1']);
  });

  it('paginación: límite máximo 500, offset, total y siguiente', async () => {
    expect((await pedir(app, S('dirA'), 'GET', '/c/periodos?limite=501')).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'GET', '/c/periodos?limite=0')).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'GET', '/c/periodos?offset=-1')).statusCode).toBe(422);
    const p1 = (await pedir(app, S('dirA'), 'GET', '/c/periodos?orden=orden&limite=2')).json() as { datos: unknown[]; total: number; siguiente: number | null };
    expect([p1.datos.length, p1.total, p1.siguiente]).toEqual([2, 3, 2]);
    const p2 = (await pedir(app, S('dirA'), 'GET', '/c/periodos?orden=orden&limite=2&offset=2')).json() as { datos: unknown[]; total: number; siguiente: number | null };
    expect([p2.datos.length, p2.total, p2.siguiente]).toEqual([1, 3, null]);
  });

  it('tamaño del registro (256 KB) y del lote (500); cuerpos inválidos', async () => {
    const grande = await pedir(app, S('dirA'), 'POST', '/c/estudiantes', { nombres: 'x'.repeat(300 * 1024) });
    expect(grande.statusCode).toBe(413);
    const justo = await pedir(app, S('dirA'), 'POST', '/c/estudiantes', { nombres: 'x'.repeat(200 * 1024) });
    expect(justo.statusCode).toBe(201);
    const lote501 = await pedir(app, S('dirA'), 'POST', '/c/periodos/lote', { registros: Array.from({ length: 501 }, (_, i) => ({ id: `l${i}` })) });
    expect(lote501.statusCode).toBe(422);
    const lote500 = await pedir(app, S('dirA'), 'POST', '/c/periodos/lote', { registros: Array.from({ length: 500 }, (_, i) => ({ id: `lp${i}` })) });
    expect(lote500.statusCode).toBe(200);
    expect((lote500.json() as { datos: unknown[] }).datos.length).toBe(500);
    expect((await pedir(app, S('dirA'), 'POST', '/c/periodos/lote', { registros: [] })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/c/periodos/lote', { registros: [{ id: 'ok_l' }, 'texto'] })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'GET', '/c/periodos/ok_l')).statusCode).toBe(404); // transaccional: nada se guardó
    expect((await pedir(app, S('dirA'), 'POST', '/c/periodos', [1, 2])).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/c/periodos', { id: 'id con espacios y ;' })).statusCode).toBe(422);
    const raro = await app.inject({ method: 'POST', url: '/api/v1/c/periodos', headers: { ...S('dirA').headers, 'content-type': 'application/json' }, payload: '{"__proto__":{"x":1},"nombre":"p"}' });
    expect(raro.statusCode).toBe(400); // secure-json-parse de Fastify lo rechaza antes de llegar al repositorio
    expect((await pedir(app, S('dirA'), 'POST', '/c/periodos', { nombre: 'nulo\u0000' })).statusCode).toBe(422);
  });

  it('el servidor fija id, creadoEn y actualizadoEn; ignora los del cliente', async () => {
    const r = await pedir(app, S('dirA'), 'POST', '/c/periodos', { nombre: 'Z', creadoEn: '1999-01-01T00:00:00.000Z', actualizadoEn: '1999-01-01T00:00:00.000Z', borradoEn: 'x' });
    const j = r.json() as { id: string; creadoEn: string; actualizadoEn: string; borradoEn?: string };
    expect(j.id).toMatch(/^per_/);
    expect(j.creadoEn.startsWith('1999')).toBe(false);
    expect(j.borradoEn).toBeUndefined();
  });
});

describe('concurrencia optimista (If-Match) y borrado lógico', () => {
  it('PUT con If-Match obsoleto → 409; vigente → 200; sin cabecera → 200', async () => {
    const d = S('dirA');
    const c = (await pedir(app, d, 'POST', '/c/periodos', { nombre: 'V1' })).json() as { id: string; actualizadoEn: string };
    const v2 = await pedir(app, d, 'PUT', `/c/periodos/${c.id}`, { nombre: 'V2' }, { 'if-match': c.actualizadoEn });
    expect(v2.statusCode).toBe(200);
    const nuevo = (v2.json() as { actualizadoEn: string }).actualizadoEn;
    expect(nuevo > c.actualizadoEn).toBe(true);
    const rancio = await pedir(app, d, 'PUT', `/c/periodos/${c.id}`, { nombre: 'V3' }, { 'if-match': c.actualizadoEn });
    expect(rancio.statusCode).toBe(409);
    expect(rancio.json().error.codigo).toBe('conflicto_version');
    expect((await pedir(app, d, 'DELETE', `/c/periodos/${c.id}`, undefined, { 'if-match': c.actualizadoEn })).statusCode).toBe(409);
    expect((await pedir(app, d, 'PUT', `/c/periodos/${c.id}`, { nombre: 'V3' }, { 'if-match': 'no-es-fecha' })).statusCode).toBe(422);
    expect((await pedir(app, d, 'PUT', `/c/periodos/${c.id}`, { nombre: 'V3' }, { 'if-match': `"${nuevo}"` })).statusCode).toBe(200);
    expect((await pedir(app, d, 'GET', `/c/periodos/${c.id}`)).json()).toMatchObject({ nombre: 'V3' });
    expect((await pedir(app, d, 'DELETE', `/c/periodos/${c.id}`)).statusCode).toBe(204);
    expect((await pedir(app, d, 'DELETE', `/c/periodos/${c.id}`)).statusCode).toBe(404);
  });

  it('dos escrituras simultáneas con el mismo If-Match: solo una gana', async () => {
    const d = S('dirA');
    const c = (await pedir(app, d, 'POST', '/c/periodos', { nombre: 'C' })).json() as { id: string; actualizadoEn: string };
    const rs = await Promise.all([1, 2, 3].map((i) => pedir(app, d, 'PUT', `/c/periodos/${c.id}`, { nombre: `C${i}` }, { 'if-match': c.actualizadoEn })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });

  it('borrado lógico: el id se puede reutilizar (calificación determinista) y POST duplicado → 409', async () => {
    const d = S('docA1');
    const cuerpo = { id: 'cal_det', actividadId: 'act1', estudianteId: 'e_det', puntos: 5 };
    expect((await pedir(app, d, 'POST', '/c/calificaciones', cuerpo)).statusCode).toBe(201);
    expect((await pedir(app, d, 'POST', '/c/calificaciones', cuerpo)).statusCode).toBe(409);
    expect((await pedir(app, d, 'POST', '/c/calificaciones', { ...cuerpo, id: 'otra' })).statusCode).toBe(409); // único (actividad, estudiante)
    expect((await pedir(app, d, 'DELETE', '/c/calificaciones/cal_det')).statusCode).toBe(204);
    const re = await pedir(app, d, 'POST', '/c/calificaciones', { ...cuerpo, puntos: 6 });
    expect(re.statusCode).toBe(201);
    expect((re.json() as { puntos: number }).puntos).toBe(6);
  });

  it('lote: upsert por id (crea y actualiza) en una transacción', async () => {
    const d = S('dirA');
    const r = await pedir(app, d, 'POST', '/c/periodos/lote', { registros: [{ id: 'lt1', nombre: 'a' }, { id: 'lt1', nombre: 'b' }, { id: 'lt2', nombre: 'c' }] });
    expect(r.statusCode).toBe(200);
    expect((await pedir(app, d, 'GET', '/c/periodos/lt1')).json()).toMatchObject({ nombre: 'b' });
    expect((await pedir(app, d, 'POST', '/c/periodos/lote', { registros: [{ nombre: 'sin id' }] })).statusCode).toBe(422);
  });
});

describe('CSRF y Origin en escrituras', () => {
  const cuerpo = { nombre: 'csrf' };
  it('sin X-EDU-CSRF → 403 en POST, PUT, DELETE y lote; con token ajeno → 403', async () => {
    const { cookie } = (() => {
      const h = S('dirA').headers;
      return { cookie: h.cookie as string };
    })();
    const sin = { cookie, origin: ORIGEN };
    for (const [met, url] of [['POST', '/c/periodos'], ['PUT', '/c/periodos/p1'], ['DELETE', '/c/periodos/p1'], ['POST', '/c/periodos/lote'], ['POST', '/auditoria'], ['POST', '/comunicados/co1/lectura']] as const) {
      const r = await app.inject({ method: met, url: `/api/v1${url}`, headers: sin, ...(met === 'DELETE' ? {} : { payload: cuerpo }) });
      expect(r.statusCode, `${met} ${url}`).toBe(403);
      expect(r.json().error.codigo).toBe('csrf_invalido');
    }
    const ajeno = await pedir(app, { id: 'x', headers: { ...S('dirA').headers, 'x-edu-csrf': S('dirB').headers['x-edu-csrf'] as string } }, 'POST', '/c/periodos', cuerpo);
    expect(ajeno.statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'GET', '/c/periodos/p1')).statusCode).toBe(200);
  });

  it('Origin de otro sitio → 403 aunque el CSRF sea correcto; Sec-Fetch-Site cross-site sin Origin → 403; GET no lo exige', async () => {
    const h = S('dirA').headers;
    expect((await app.inject({ method: 'POST', url: '/api/v1/c/periodos', headers: { ...h, origin: 'https://evil.example' }, payload: cuerpo })).statusCode).toBe(403);
    const { origin: _o, ...sinOrigin } = h;
    expect((await app.inject({ method: 'POST', url: '/api/v1/c/periodos', headers: { ...sinOrigin, 'sec-fetch-site': 'cross-site' }, payload: cuerpo })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/c/periodos', headers: { cookie: h.cookie as string } })).statusCode).toBe(200);
  });
});

describe('auditoria', () => {
  it('escribir calificaciones y notasCompetencia audita antes/después con usuario, rol y centro del servidor', async () => {
    const d = S('docA1');
    const previo = ((await pedir(app, d, 'GET', '/c/calificaciones/cal1')).json() as { puntos: number }).puntos;
    await pedir(app, d, 'PUT', '/c/calificaciones/cal1', { actividadId: 'act1', estudianteId: 'e1', puntos: 3 });
    await pedir(app, d, 'POST', '/c/notasCompetencia', { id: 'nc1', cargaId: 'cg1', estudianteId: 'e1', c: [] });
    await pedir(app, d, 'DELETE', '/c/notasCompetencia/nc1');
    const r = await pedir(app, S('dirA'), 'GET', '/auditoria?coleccion=calificaciones&registroId=cal1');
    expect(r.statusCode).toBe(200);
    const [a] = (r.json() as { datos: { antes: { puntos: number }; despues: { puntos: number } }[] }).datos;
    expect(a).toMatchObject({ accion: 'editar', coleccion: 'calificaciones', registroId: 'cal1', usuarioId: d.id, rol: 'docente', centroId: A });
    expect(a!.antes.puntos).toBe(previo);
    expect(a!.despues.puntos).toBe(3);
    const nc = (await pedir(app, S('dirA'), 'GET', '/auditoria?coleccion=notasCompetencia&registroId=nc1')).json() as { datos: { accion: string }[] };
    expect(nc.datos.map((x) => x.accion).sort()).toEqual(['borrar', 'crear']);
    // una colección no auditada no genera filas
    await pedir(app, d, 'POST', '/c/planes', { cargaId: 'cg1', tema: 't' });
    expect(((await pedir(app, S('dirA'), 'GET', '/auditoria?coleccion=planes')).json() as { total: number }).total).toBe(0);
  });

  it('POST /auditoria: lista blanca de campos; usuarioId/rol/fecha/centro los fija el servidor; roles y acciones controlados', async () => {
    const d = S('docA1');
    const r = await pedir(app, d, 'POST', '/auditoria', {
      accion: 'importar_planilla', motivo: 'm'.repeat(900), archivo: 'x.xlsx', usuarioId: 'falso', rol: 'admin_red', fecha: '1999-01-01T00:00:00Z', centroId: A, id: 'aud_falso', campoLibre: 'x',
    });
    expect(r.statusCode).toBe(201);
    const j = r.json() as { id: string; fecha: string; motivo: string; campoLibre?: unknown };
    expect(j).toMatchObject({ usuarioId: d.id, rol: 'docente', centroId: A, accion: 'importar_planilla' });
    expect(j.id).not.toBe('aud_falso');
    expect(j.fecha.startsWith('1999')).toBe(false);
    expect(j.motivo.length).toBe(600);
    expect(j.campoLibre).toBeUndefined();
    expect((await pedir(app, d, 'POST', '/auditoria', { accion: 'x', centroId: B })).statusCode).toBe(403);
    expect((await pedir(app, d, 'POST', '/auditoria', { accion: 'editar', coleccion: 'calificaciones', registroId: 'cal1' })).statusCode).toBe(403); // reservada
    expect((await pedir(app, d, 'POST', '/auditoria', { accion: 'a b;--' })).statusCode).toBe(422);
    expect((await pedir(app, d, 'POST', '/auditoria', { accion: 'x', coleccion: 'inventada' })).statusCode).toBe(422);
    expect((await pedir(app, d, 'POST', '/auditoria', { accion: 'x', coleccion: 'auditoria' })).statusCode).toBe(422);
    expect((await pedir(app, S('estA1'), 'POST', '/auditoria', { accion: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, S('tutA'), 'POST', '/auditoria', { accion: 'x' })).statusCode).toBe(403);
    expect((await pedir(app, S('admin'), 'POST', '/auditoria', { accion: 'x' })).statusCode).toBe(422); // admin_red debe indicar centro
    expect((await pedir(app, S('admin'), 'POST', '/auditoria', { accion: 'x', centroId: B })).statusCode).toBe(201);
  });

  it('GET /auditoria: director solo su centro; docente/tutor/estudiante/secretaría 403; admin_red todo', async () => {
    expect((await pedir(app, S('docA1'), 'GET', '/auditoria')).statusCode).toBe(403);
    expect((await pedir(app, S('secA'), 'GET', '/auditoria')).statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'GET', `/auditoria?centroId=${B}`)).statusCode).toBe(403);
    const a = (await pedir(app, S('dirA'), 'GET', '/auditoria?limite=500')).json() as { datos: { centroId: string }[] };
    expect(a.datos.length).toBeGreaterThan(0);
    expect(a.datos.every((x) => x.centroId === A)).toBe(true);
    const todo = (await pedir(app, S('admin'), 'GET', '/auditoria?limite=500')).json() as { datos: { centroId: string }[] };
    expect(todo.datos.some((x) => x.centroId === B)).toBe(true);
    expect((await pedir(app, S('dirA'), 'GET', '/auditoria?desde=no-fecha')).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'GET', '/c/auditoria')).statusCode).toBe(200);
    expect((await pedir(app, S('dirA'), 'PUT', '/c/auditoria/x', {})).statusCode).toBe(403);
  });

  it('la auditoría no se puede alterar: ni por SQL con el rol de la API ni por trigger (ni el propietario)', async () => {
    const p = poolApp();
    await expect(p.query("UPDATE auditoria SET accion = 'x'")).rejects.toThrow(/permission denied/);
    await expect(p.query('DELETE FROM auditoria')).rejects.toThrow(/permission denied/);
    await expect(p.query('TRUNCATE auditoria')).rejects.toThrow(/permission denied/);
    // El propietario tampoco puede: aun sin RLS lo impide el trigger (con RLS forzada, además, no hay política de UPDATE/DELETE).
    const c = await owner().connect();
    try {
      for (const sentencia of ["UPDATE auditoria SET accion = 'x'", 'DELETE FROM auditoria', 'TRUNCATE auditoria']) {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.rol', 'admin_red', true)");
        await c.query('ALTER TABLE auditoria NO FORCE ROW LEVEL SECURITY'); // solo dentro de esta transacción (se revierte)
        await expect(c.query(sentencia), sentencia).rejects.toThrow(/solo anexado/);
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
  });
});

describe('usuarios: sin hashes, alta con clave temporal, desactivación', () => {
  const SECRETOS = /hash|argon|clave"|"intentos|bloqueado|token/i;

  it('ninguna respuesta de usuarios (lista, objeto, alta, cambio, respaldo) contiene hash ni datos de autenticación', async () => {
    const respuestas = [
      await pedir(app, S('admin'), 'GET', '/c/usuarios'),
      await pedir(app, S('dirA'), 'GET', '/c/usuarios'),
      await pedir(app, S('dirA'), 'GET', `/c/usuarios/${S('docA1').id}`),
      await pedir(app, S('docA1'), 'GET', '/c/usuarios'),
      await pedir(app, S('dirA'), 'PUT', `/c/usuarios/${S('docA2').id}`, { nombre: 'Renombrado' }),
      await pedir(app, S('dirA'), 'GET', `/respaldo/exportar`),
    ];
    for (const r of respuestas) {
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toMatch(/\$argon2/);
      expect(r.body).not.toMatch(/"hash"/);
      if (!r.body.startsWith('{"formato"')) expect(r.body).not.toMatch(/"(intentos|bloqueado_hasta|bloqueadoHasta|token|sesion)/i); // el respaldo tiene una colección llamada «intentos»
    }
    expect(SECRETOS).toBeDefined();
    const lista = (respuestas[1]!.json() as { datos: Record<string, unknown>[] }).datos;
    expect(lista.every((u) => u.centroId === A)).toBe(true);
    expect(Object.keys(lista[0]!).sort()).toEqual(['activo', 'actualizadoEn', 'centroId', 'creadoEn', 'debeCambiarClave', 'email', 'id', 'nombre', 'refId', 'rol']);
    expect(((respuestas[3]!.json() as { datos: unknown[] }).datos).length).toBe(1); // el docente solo se ve a sí mismo
  });

  it('alta: clave temporal aleatoria devuelta UNA vez, debe cambiarla; el usuario nuevo entra y queda bloqueado hasta cambiarla', async () => {
    const alta = await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Nueva Persona', email: 'nueva.persona@prueba.test', rol: 'secretaria' });
    expect(alta.statusCode).toBe(201);
    const j = alta.json() as { id: string; claveTemporal: string; debeCambiarClave: boolean };
    expect(j.claveTemporal.length).toBeGreaterThanOrEqual(16);
    expect(j.debeCambiarClave).toBe(true);
    const otra = (await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Otra', email: 'otra.persona@prueba.test', rol: 'secretaria' })).json() as { claveTemporal: string };
    expect(otra.claveTemporal).not.toBe(j.claveTemporal);
    expect(JSON.stringify((await pedir(app, S('dirA'), 'GET', `/c/usuarios/${j.id}`)).json())).not.toContain(j.claveTemporal);
    const lg = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN }, payload: { email: 'nueva.persona@prueba.test', clave: j.claveTemporal } });
    expect(lg.statusCode).toBe(200);
    expect(lg.json().debeCambiarClave).toBe(true);
    const cookie = lg.cookies[0]!.value;
    const csrf = (lg.json() as { csrfToken: string }).csrfToken;
    const bloqueada = await app.inject({ method: 'GET', url: '/api/v1/c/periodos', headers: { cookie: `edu_sid=${cookie}` } });
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json().error.codigo).toBe('cambio_clave_obligatorio');
    void csrf;
    expect((await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Dup', email: 'nueva.persona@prueba.test', rol: 'docente' })).statusCode).toBe(409);
    expect((await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Mal', email: 'no-es-correo', rol: 'docente' })).statusCode).toBe(422);
    expect((await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Mal', email: 'a@b.test', rol: 'superadmin' })).statusCode).toBe(422);
  });

  it('«borrar» desactiva (no elimina), revoca sesiones y no permite autodesactivarse', async () => {
    const alta = (await pedir(app, S('dirA'), 'POST', '/c/usuarios', { nombre: 'Baja', email: 'baja@prueba.test', rol: 'docente' })).json() as { id: string; claveTemporal: string };
    const lg = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN }, payload: { email: 'baja@prueba.test', clave: alta.claveTemporal } });
    expect(lg.statusCode).toBe(200);
    expect((await pedir(app, S('dirA'), 'DELETE', `/c/usuarios/${alta.id}`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `edu_sid=${lg.cookies[0]!.value}` } })).statusCode).toBe(401);
    expect((await pedir(app, S('dirA'), 'GET', `/c/usuarios/${alta.id}`)).json()).toMatchObject({ activo: false });
    const { rows } = await owner().query('SELECT count(*)::int AS n FROM usuarios WHERE id = $1', [alta.id]);
    expect(rows[0].n).toBe(1);
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGEN }, payload: { email: 'baja@prueba.test', clave: alta.claveTemporal } });
    expect(again.statusCode).toBe(401);
    expect((await pedir(app, S('dirA'), 'DELETE', `/c/usuarios/${S('dirA').id}`)).statusCode).toBe(403);
    expect((await pedir(app, S('dirA'), 'PUT', `/c/usuarios/${S('dirA').id}`, { activo: false })).statusCode).toBe(403);
  });
});

describe('respaldo', () => {
  it('exportar: director su centro, admin_red cualquiera (con centroId); otros 403; importar 501', async () => {
    const d = await pedir(app, S('dirA'), 'GET', '/respaldo/exportar');
    expect(d.statusCode).toBe(200);
    const j = d.json() as { formato: string; centroId: string; colecciones: Record<string, { centroId?: string }[]> };
    expect(j).toMatchObject({ formato: 'educentro-respaldo', version: 1, centroId: A });
    expect(j.colecciones.estudiantes!.map((x) => (x as { id?: string }).id).sort()).toEqual(expect.arrayContaining(['e1', 'e2']));
    for (const [col, regs] of Object.entries(j.colecciones)) for (const r of regs) if (col !== 'centros') expect(r.centroId, col).toBe(A);
    expect(JSON.stringify(j)).not.toContain('eB');
    expect((await pedir(app, S('dirA'), 'GET', `/respaldo/exportar?centroId=${B}`)).statusCode).toBe(403);
    expect((await pedir(app, S('admin'), 'GET', '/respaldo/exportar')).statusCode).toBe(422);
    expect((await pedir(app, S('admin'), 'GET', `/respaldo/exportar?centroId=${B}`)).statusCode).toBe(200);
    expect((await pedir(app, S('admin'), 'GET', '/respaldo/exportar?centroId=nada')).statusCode).toBe(404);
    for (const k of ['docA1', 'secA', 'tutA', 'estA1']) expect((await pedir(app, S(k), 'GET', '/respaldo/exportar')).statusCode, k).toBe(403);
    const imp = await pedir(app, S('dirA'), 'POST', '/respaldo/importar', {});
    expect(imp.statusCode).toBe(501);
    expect(imp.json().error.mensaje).toContain('Fase 5');
    const aud = (await pedir(app, S('dirA'), 'GET', '/auditoria?accion=exportar_respaldo')).json() as { total: number };
    expect(aud.total).toBeGreaterThanOrEqual(1);
  });
});
