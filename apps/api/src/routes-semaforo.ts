/**
 * routes-semaforo.ts — GET /semaforo?month=AAAA-MM → SemaforoResult
 * Deterministico, sem IA: recalculado a cada chamada a partir da DRE atual.
 */

import type { FastifyInstance } from 'fastify';
import { buildSemaforo } from './semaforo.js';
import { getCurrentImport } from './routes-dre.js';

export async function semaforoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { month?: string } }>('/semaforo', async (req, reply) => {
    const data = getCurrentImport();
    if (data === null) return reply.code(404).send({ message: 'Envie uma DRE primeiro.' });
    return reply.send(buildSemaforo(data, req.query.month));
  });
}
