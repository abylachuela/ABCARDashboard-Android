// API REST /api/v1: repositorio genérico (/c/:col), auditoría, lectura de comunicados y respaldo.
// Cada petición abre UNA transacción con contexto de seguridad (SET LOCAL app.*); la sesión sale de la cookie.
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exigirSesion } from '../auth/guardia.js';
import { conContexto } from '../db/contexto.js';
import { ErrorHttp } from '../errores.js';
import type { SesionApi } from '../domain/alcance.js';
import { puedeRol } from '../domain/autorizacion.js';
import { metaDe, COLECCIONES, type MetaColeccion } from '../domain/colecciones.js';
import { esRol, puedeModulo } from '../domain/permisos.js';
import { borrarCentro, guardarCentro, listarCentros, obtenerCentro } from '../repo/centros.js';
import { parsearConsulta } from '../repo/consulta.js';
import {
  borrar, esquemaId, exportarCentro, guardar, listar, MAX_LOTE, obtener, Peticion, validarCuerpo,
} from '../repo/generico.js';
import { motivoDeCabecera } from '../repo/reglas-notas.js';
import { crearAuditoria, listarAuditoria, obtenerAuditoria, registrarAuditoria, ROLES_LEEN_AUDITORIA } from '../repo/auditoria.js';
import { cambiarUsuario, crearUsuario, desactivarUsuario, listarUsuarios, obtenerUsuario } from '../repo/usuarios.js';

export function sesionDe(req: FastifyRequest): SesionApi {
  const u = req.sesion?.usuario;
  if (!u || !esRol(u.rol)) throw new ErrorHttp(401, 'no_autenticado', 'Debes iniciar sesión.');
  return { usuarioId: u.id, rol: u.rol, centroId: u.centroId, refId: u.refId };
}

/** Ejecuta `fn` en una transacción con el contexto de la sesión. Único camino de acceso a datos de la API. */
export function abrir<T>(req: FastifyRequest, fn: (p: Peticion) => Promise<T>, opciones: { motivo?: string | null } = {}): Promise<T> {
  const ses = sesionDe(req);
  // Motivo de edición (director/admin_red sobre periodos cerrados): cabecera X-EDU-Motivo, codificada con encodeURIComponent.
  const motivo = opciones.motivo !== undefined ? opciones.motivo : motivoDeCabecera(req.headers['x-edu-motivo']);
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 200) : null;
  // IP y user-agent los fija el servidor (la auditoría no confía en lo que envíe el cliente).
  return conContexto(req.server.db, { rol: ses.rol, centroId: ses.centroId, usuarioId: ses.usuarioId, ip: String(req.ip ?? '').slice(0, 45) || null, ua }, (tx) => fn(new Peticion(tx, ses, motivo)));
}

function coleccion(nombre: string): MetaColeccion {
  const m = metaDe(nombre);
  if (!m) throw new ErrorHttp(404, 'coleccion_desconocida', 'Colección desconocida.');
  return m;
}
function permitir(req: FastifyRequest, m: MetaColeccion, accion: 'listar' | 'obtener' | 'crear' | 'editar' | 'borrar'): void {
  const d = puedeRol(sesionDe(req), m.nombre, accion);
  if (!d.ok) throw new ErrorHttp(d.status, d.codigo, d.mensaje);
}
const idDe = (id: string): string => {
  if (!esquemaId.safeParse(id).success) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  return id;
};
const ifMatch = (req: FastifyRequest): string | null => (typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null);
const noEncontrado = (): ErrorHttp => new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');

async function todasLasPaginas(pagina: (offset: number) => Promise<{ datos: unknown[]; siguiente: number | null }>): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let off: number | null = 0; off !== null; ) {
    const r = await pagina(off);
    out.push(...r.datos);
    off = r.siguiente;
  }
  return out;
}

type Params = { col: string; id: string };

export const rutasApi: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guardia = { preHandler: exigirSesion() };

  // ---------------------------------------------------------------------------------------- GET /c/:col
  app.get<{ Params: Params }>('/c/:col', guardia, async (req) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'listar');
    return abrir(req, async (p) => {
      if (m.tipo === 'auditoria') return listarAuditoria(p.tx, p.ses, req.query);
      const c = parsearConsulta(req.query);
      if (m.tipo === 'usuarios') return listarUsuarios(p, c);
      if (m.tipo === 'centros') return listarCentros(p, c);
      return listar(p, m, c);
    });
  });

  // ------------------------------------------------------------------------------------ GET /c/:col/:id
  app.get<{ Params: Params }>('/c/:col/:id', guardia, async (req) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'obtener');
    const id = idDe(req.params.id);
    const r = await abrir(req, (p) => {
      if (m.tipo === 'auditoria') return obtenerAuditoria(p.tx, p.ses, id);
      if (m.tipo === 'usuarios') return obtenerUsuario(p, id);
      if (m.tipo === 'centros') return obtenerCentro(p, id);
      return obtener(p, m, id);
    });
    if (!r) throw noEncontrado();
    return r;
  });

  // ----------------------------------------------------------------------------------- POST /c/:col/lote
  app.post<{ Params: Params }>('/c/:col/lote', guardia, async (req) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'crear');
    if (m.tipo === 'usuarios') throw new ErrorHttp(422, 'no_soportado', 'Los usuarios se crean de uno en uno (POST /c/usuarios).');
    const { registros } = z.object({ registros: z.array(z.unknown()).min(1).max(MAX_LOTE) }).parse(req.body);
    const datos = await abrir(req, async (p) => {
      const out = [];
      for (const [i, r] of registros.entries()) {
        const et = `Registro ${i + 1}: `;
        const cuerpo = validarCuerpo(r, et);
        const op = { modo: 'upsert' as const };
        out.push((m.tipo === 'centros' ? await guardarCentro(p, m, cuerpo, op, et) : await guardar(p, m, cuerpo, op, et)).registro);
      }
      return out;
    });
    return { datos };
  });

  // ---------------------------------------------------------------------------------------- POST /c/:col
  app.post<{ Params: Params }>('/c/:col', guardia, async (req, reply) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'crear');
    const cuerpo = validarCuerpo(req.body);
    const r = await abrir(req, async (p) => {
      if (m.tipo === 'usuarios') {
        const u = await crearUsuario(p, cuerpo);
        return { ...u.registro, claveTemporal: u.claveTemporal };
      }
      const op = { modo: 'crear' as const };
      return (m.tipo === 'centros' ? await guardarCentro(p, m, cuerpo, op) : await guardar(p, m, cuerpo, op)).registro;
    });
    return reply.code(201).send(r);
  });

  // ------------------------------------------------------------------------------------ PUT /c/:col/:id
  app.put<{ Params: Params }>('/c/:col/:id', guardia, async (req) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'editar');
    const id = idDe(req.params.id);
    const cuerpo = validarCuerpo(req.body);
    const im = ifMatch(req);
    return abrir(req, async (p) => {
      if (m.tipo === 'usuarios') return cambiarUsuario(p, id, cuerpo, im);
      const op = { modo: 'editar' as const, idUrl: id, ifMatch: im };
      return (m.tipo === 'centros' ? await guardarCentro(p, m, cuerpo, op) : await guardar(p, m, cuerpo, op)).registro;
    });
  });

  // --------------------------------------------------------------------------------- DELETE /c/:col/:id
  app.delete<{ Params: Params }>('/c/:col/:id', guardia, async (req, reply) => {
    const m = coleccion(req.params.col);
    permitir(req, m, 'borrar');
    const id = idDe(req.params.id);
    const im = ifMatch(req);
    await abrir(req, async (p) => {
      if (m.tipo === 'usuarios') return desactivarUsuario(p, id, im);
      if (m.tipo === 'centros') return borrarCentro(p, id, im);
      return borrar(p, m, id, im);
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------------------------------- /auditoria
  app.get('/auditoria', guardia, async (req) => {
    const ses = sesionDe(req);
    if (!ROLES_LEEN_AUDITORIA.includes(ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso para leer la auditoría.');
    return abrir(req, (p) => listarAuditoria(p.tx, p.ses, req.query));
  });
  app.post('/auditoria', guardia, async (req, reply) => {
    const r = await abrir(req, (p) => crearAuditoria(p.tx, p.ses, req.body));
    return reply.code(201).send(r);
  });

  // ------------------------------------------------------------------------ POST /comunicados/:id/lectura
  // Registra SOLO la lectura propia (regla de registrarLectura): centro, publicado, audiencia y segmento.
  app.post<{ Params: { id: string } }>('/comunicados/:id/lectura', guardia, async (req) => {
    const ses = sesionDe(req);
    if (!puedeModulo(ses.rol, 'comunicados', 'ver')) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso.');
    const id = idDe(req.params.id);
    const NO = new ErrorHttp(404, 'no_encontrado', 'Comunicado no disponible.');
    return abrir(req, async (p) => {
      const r = await p.tx.query<{ centro_id: string; datos: Record<string, unknown> }>(
        `SELECT centro_id, datos FROM comunicados WHERE id = $1 AND borrado_en IS NULL FOR UPDATE`,
        [id],
      );
      const c = r.rows[0];
      if (!c || c.centro_id !== ses.centroId || c.datos.estado !== 'publicado') throw NO;
      // visibilidad resuelta en el servidor (alcance por rol, segmento de curso/sección/tutor): lo que no ves, no lo puedes confirmar
      if (!(await obtener(p, metaDe('comunicados') as MetaColeccion, id))) throw NO;
      const aud = (c.datos.destinatarios as string | undefined) ?? 'todos';
      const propia = { docente: 'docentes', tutor: 'tutores', estudiante: 'estudiantes' }[ses.rol as string];
      if (aud !== 'todos' && propia !== aud) throw NO;
      const seg = c.datos.segmento as { tipo?: string; id?: string } | undefined;
      if (seg && seg.tipo === 'tutor' && (ses.rol !== 'tutor' || seg.id !== ses.refId)) throw NO;
      const fecha = new Date().toISOString();
      await p.tx.query(
        `UPDATE comunicados SET datos = jsonb_set(datos, '{lecturas}', coalesce(datos->'lecturas', '[]'::jsonb) || $2::jsonb)
          WHERE id = $1 AND NOT coalesce(datos->'lecturas', '[]'::jsonb) @> $3::jsonb`,
        [id, JSON.stringify([{ usuarioId: ses.usuarioId, fecha }]), JSON.stringify([{ usuarioId: ses.usuarioId }])],
      );
      return { leido: true };
    });
  });

  // ---------------------------------------------------------------------------------------------- respaldo
  app.get('/respaldo/exportar', guardia, async (req) => {
    const ses = sesionDe(req);
    if (!puedeModulo(ses.rol, 'respaldo', 'exportar')) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso para exportar.');
    const { centroId } = z.object({ centroId: z.string().min(1).max(100).optional() }).parse(req.query);
    if (ses.rol !== 'admin_red' && centroId !== undefined && centroId !== ses.centroId) throw new ErrorHttp(403, 'centro_no_permitido', 'Centro no permitido.');
    const centro = ses.rol === 'admin_red' ? centroId : ses.centroId;
    if (!centro) throw new ErrorHttp(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
    return abrir(req, async (p) => {
      if (!(await obtenerCentro(p, centro))) throw noEncontrado();
      const colecciones: Record<string, unknown[]> = {};
      for (const nombre of COLECCIONES) {
        const m = coleccion(nombre);
        if (m.tipo === 'centros') colecciones[nombre] = [await obtenerCentro(p, centro)];
        else if (m.tipo === 'usuarios') {
          // Proyección sin hash ni tokens; solo los usuarios del centro (admin_red no pertenece a ninguno).
          colecciones[nombre] = await todasLasPaginas((offset) => listarUsuarios(p, parsearConsulta({ centroId: centro, limite: '500', offset: String(offset) })));
        } else if (m.tipo === 'auditoria') {
          colecciones[nombre] = await todasLasPaginas((offset) => listarAuditoria(p.tx, p.ses, { centroId: centro, limite: '500', offset: String(offset) }));
        } else colecciones[nombre] = await exportarCentro(p.tx, m, centro);
      }
      const conteos = Object.fromEntries(Object.entries(colecciones).map(([k, v]) => [k, v.length]));
      await registrarAuditoria(p.tx, p.ses, centro, { accion: 'exportar_respaldo', extra: { registros: conteos } });
      return { formato: 'educentro-respaldo', version: 1, generadoEn: new Date().toISOString(), centroId: centro, colecciones };
    });
  });
  app.post('/respaldo/importar', guardia, async () => {
    throw new ErrorHttp(501, 'no_implementado', 'La importación de respaldos llega en la Fase 5.');
  });
};
