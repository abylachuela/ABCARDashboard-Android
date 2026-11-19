// Rutas de notas (Fase 2): lotes transaccionales, resumen con el cálculo compartido, cierre/reapertura de periodos
// y verificación de la cadena de auditoría. Comparten con /c/:col la capa de acceso (transacción + RLS + reglas).
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { exigirSesion } from '../auth/guardia.js';
import { ErrorHttp } from '../errores.js';
import { puedeRol } from '../domain/autorizacion.js';
import { verificarCadena, ROLES_LEEN_AUDITORIA } from '../repo/auditoria.js';
import { esquemaId } from '../repo/generico.js';
import {
  cerrarPeriodo, informeCierre, loteCalificaciones, loteCategorias, loteNotasCompetencia, reabrirPeriodo, resumenNotas,
} from '../repo/notas.js';
import { abrir, sesionDe } from './api.js';

function permitir(req: Parameters<typeof sesionDe>[0], col: string, accion: 'crear' | 'editar'): void {
  const d = puedeRol(sesionDe(req), col, accion);
  if (!d.ok) throw new ErrorHttp(d.status, d.codigo, d.mensaje);
}
const idDe = (id: string): string => {
  if (!esquemaId.safeParse(id).success) throw new ErrorHttp(404, 'no_encontrado', 'Registro no encontrado.');
  return id;
};

export const rutasNotas: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guardia = { preHandler: exigirSesion() };

  // Lotes de notas: validación por fila, resultado por fila; `atomico:true` = todo o nada.
  app.put('/notas/calificaciones/lote', guardia, async (req) => {
    permitir(req, 'calificaciones', 'crear');
    return abrir(req, (p) => loteCalificaciones(p, req.body));
  });
  app.put('/notas/competencias/lote', guardia, async (req) => {
    permitir(req, 'notasCompetencia', 'crear');
    return abrir(req, (p) => loteNotasCompetencia(p, req.body));
  });
  // Reemplazo transaccional de las categorías de una carga (pesos = 100 %).
  app.post('/notas/categorias/lote', guardia, async (req) => {
    permitir(req, 'categorias', 'crear');
    return abrir(req, (p) => loteCategorias(p, req.body));
  });

  app.get('/notas/resumen', guardia, async (req) => abrir(req, (p) => resumenNotas(p, req.query)));

  // Cierre y reapertura de periodos (director y admin_red).
  app.get<{ Params: { id: string } }>('/periodos/:id/informe-cierre', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, async (p) => {
      if (!['director', 'admin_red'].includes(p.ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Solo el director puede revisar el cierre de periodos.');
      return informeCierre(p, id);
    });
  });
  app.post<{ Params: { id: string } }>('/periodos/:id/cerrar', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, (p) => cerrarPeriodo(p, id, req.body));
  });
  app.post<{ Params: { id: string } }>('/periodos/:id/reabrir', guardia, async (req) => {
    const id = idDe(req.params.id);
    return abrir(req, async (p) => ({ periodo: await reabrirPeriodo(p, id, req.body) }));
  });

  // Verificación de la cadena de hashes de la auditoría de un centro.
  app.get('/auditoria/verificar', guardia, async (req) => {
    const ses = sesionDe(req);
    if (!ROLES_LEEN_AUDITORIA.includes(ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso para verificar la auditoría.');
    const { centroId } = z.object({ centroId: z.string().min(1).max(100).optional() }).parse(req.query);
    if (ses.rol !== 'admin_red' && centroId !== undefined && centroId !== ses.centroId) throw new ErrorHttp(404, 'no_encontrado', 'Centro no encontrado.');
    const centro = ses.rol === 'admin_red' ? centroId : ses.centroId;
    if (!centro) throw new ErrorHttp(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
    return abrir(req, async (p) => {
      const existe = await p.tx.query('SELECT 1 FROM centros WHERE id = $1', [centro]);
      if (!existe.rowCount) throw new ErrorHttp(404, 'no_encontrado', 'Centro no encontrado.');
      return verificarCadena(p.tx, centro);
    });
  });
};
