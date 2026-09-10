import type { FastifyInstance } from 'fastify';
import { buildInviteReport } from './audit.js';

export async function alphaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async (req) => ({
    participantId: req.auth.participantId,
    name: req.auth.name,
    email: req.auth.email,
    workspaceId: req.auth.workspaceId,
    organizer: req.auth.isOrganizer,
    mode: req.auth.mode,
  }));

  app.get('/alpha/report', async (req, reply) => {
    try {
      return reply.send(await buildInviteReport(req.auth));
    } catch (err) {
      return reply.code(403).send({ message: err instanceof Error ? err.message : 'Acesso negado.' });
    }
  });
}

