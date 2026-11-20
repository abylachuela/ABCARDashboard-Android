// Endpoints de negocio TRANSACCIONALES (Fase 3A): matrícula, bajas, cursos e inscripciones, año activo, currículo, asistencia,
// comunicados y horarios. Cada uno abre UNA transacción con el contexto de la sesión (RLS) y aplica sus reglas con bloqueo.
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { exigirSesion } from '../auth/guardia.js';
import { ErrorHttp } from '../errores.js';
import { puedeModulo } from '../domain/permisos.js';
import { esquemaId } from '../repo/generico.js';
import { activarAnio, bajaPersona, matricular, reactivarMatricula, reactivarPersona, retirarMatricula, vincularTutor, type ColPersona } from '../repo/negocio-matriculas.js';
import { cambiarEstadoCurso, guardarNotasCurso, inscribir, reinscribirInscripcion, retirarInscripcion } from '../repo/negocio-cursos.js';
import { importarVersion, marcarVigente } from '../repo/negocio-curriculo.js';
import { asistenciaSeccionFecha, cambiarJustificacion, confirmacionesComunicado, listarComunicados } from '../repo/negocio-aula.js';
import { guardarFranjasTanda, guardarHorarios } from '../repo/negocio-horarios.js';
import { abrir, sesionDe } from './api.js';

const idDe = (id: string): string => {
  if (!esquemaId.safeParse(id).success) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  return id;
};
type P = { id: string };

export const rutasNegocio: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guardia = { preHandler: exigirSesion() };

  // ---------------------------------------------------------------------------------------------------------- matrículas
  app.post('/matriculas', guardia, async (req, reply) => {
    const datos = await abrir(req, (p) => matricular(p, req.body));
    return reply.code(201).send({ datos, total: datos.length });
  });
  app.post<{ Params: P }>('/matriculas/:id/retirar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => retirarMatricula(p, id, req.body));
  });
  app.post<{ Params: P }>('/matriculas/:id/reactivar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => reactivarMatricula(p, id));
  });

  // ------------------------------------------------------------------------------------------------------------- personas
  for (const col of ['estudiantes', 'docentes', 'tutores'] as ColPersona[]) {
    app.post<{ Params: P }>(`/${col}/:id/baja`, guardia, async (req) => {
      const id = idDe(req.params.id);
      return abrir(req, (p) => bajaPersona(p, col, id, req.body));
    });
    app.post<{ Params: P }>(`/${col}/:id/reactivar`, guardia, async (req) => {
      const id = idDe(req.params.id);
      return abrir(req, (p) => reactivarPersona(p, col, id));
    });
  }
  app.post<{ Params: P }>('/tutores/:id/vincular', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => vincularTutor(p, id, req.body, false));
  });
  app.post<{ Params: P }>('/tutores/:id/desvincular', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => vincularTutor(p, id, req.body, true));
  });

  // ----------------------------------------------------------------------------------------------------------- año activo
  app.post<{ Params: P }>('/anios/:id/activar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => activarAnio(p, id));
  });

  // ------------------------------------------------------------------------------------------------- cursos e inscripciones
  app.post<{ Params: P }>('/cursos/:id/inscripciones', guardia, async (req, reply) => {
    const id = idDe(req.params.id);
    const r = await abrir(req, (p) => inscribir(p, id, req.body));
    return reply.code(201).send({ resultados: r.resultados });
  });
  app.post<{ Params: P }>('/cursos/:id/estado', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => cambiarEstadoCurso(p, id, req.body));
  });
  app.post<{ Params: P }>('/cursos/:id/notas', guardia, async (req) => {
    const id = idDe(req.params.id);
    return { datos: await abrir(req, (p) => guardarNotasCurso(p, id, req.body)) };
  });
  app.post<{ Params: P }>('/inscripciones/:id/retirar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => retirarInscripcion(p, id, req.body));
  });
  app.post<{ Params: P }>('/inscripciones/:id/reinscribir', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, async (p) => ({ inscripcion: await reinscribirInscripcion(p, id) }));
  });

  // ---------------------------------------------------------------------------------------------------------------- currículo
  app.post('/curriculo/versiones/importar', guardia, async (req, reply) => {
    const r = await abrir(req, (p) => importarVersion(p, req.body));
    return reply.code(201).send(r);
  });
  app.post<{ Params: P }>('/curriculo/versiones/:id/vigente', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => marcarVigente(p, id));
  });

  // ------------------------------------------------------------------------------------------------------------- asistencia
  app.post('/asistencia/seccion-fecha', guardia, async (req) => {
    const datos = await abrir(req, (p) => asistenciaSeccionFecha(p, req.body));
    return { datos, total: datos.length };
  });
  app.post<{ Params: P }>('/asistencia/:id/justificar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => cambiarJustificacion(p, id, req.body, false));
  });
  app.post<{ Params: P }>('/asistencia/:id/quitar-justificacion', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => cambiarJustificacion(p, id, req.body, true));
  });

  // ----------------------------------------------------------------------------------------------------------- comunicados
  app.get('/comunicados', guardia, async (req) => {
    if (!puedeModulo(sesionDe(req).rol, 'comunicados', 'ver')) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso.');
    return abrir(req, (p) => listarComunicados(p, req.query));
  });
  app.get<{ Params: P }>('/comunicados/:id/confirmaciones', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => confirmacionesComunicado(p, id));
  });

  // -------------------------------------------------------------------------------------------------------------- horarios
  app.post('/horarios/guardar', guardia, async (req) => abrir(req, (p) => guardarHorarios(p, req.body)));
  app.post('/franjas/tanda', guardia, async (req) => abrir(req, (p) => guardarFranjasTanda(p, req.body)));
};
