import type { FastifyPluginAsync } from 'fastify';

export const rutasSalud: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    try {
      await Promise.race([
        app.db.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2_000).unref()),
      ]);
      return { estado: 'ok' };
    } catch {
      // Sin detalles internos.
      return reply.code(503).send({ estado: 'degradado' });
    }
  });
};
