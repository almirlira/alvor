import type { FastifyRequest } from 'fastify';
import { inviteEntries, supabaseAdmin, type AuthContext } from './auth.js';
import { readState, writeState, type StateScope } from './state.js';
import { getCurrentImport } from './routes-dre.js';

export interface UsageEvent {
  readonly participantId: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly at: string;
}

export async function recordUsage(req: FastifyRequest, statusCode: number): Promise<void> {
  const auth = req.auth;
  if (auth.mode === 'local' || req.routeOptions.url === '/health') return;

  const event: UsageEvent = {
    participantId: auth.participantId,
    name: auth.name,
    method: req.method,
    path: req.url.split('?')[0] ?? req.url,
    statusCode,
    at: new Date().toISOString(),
  };

  if (auth.mode === 'supabase' && supabaseAdmin !== null) {
    await supabaseAdmin.from('audit_events').insert({
      workspace_id: auth.workspaceId,
      user_id: auth.userId,
      event: `${event.method} ${event.path}`,
      metadata: event,
    });
    return;
  }

  const usage = await readState<UsageEvent[]>(auth, 'usage', []);
  await writeState(auth, 'usage', [event, ...usage].slice(0, 500));
}

export async function buildInviteReport(requester: AuthContext): Promise<Record<string, unknown>> {
  if (!requester.isOrganizer) throw new Error('Apenas o organizador pode ver o relatorio da alpha.');

  const participants = await Promise.all(inviteEntries.map(async (entry) => {
    const scope: StateScope = { mode: 'invite', workspaceId: entry.participant };
    const usage = await readState<UsageEvent[]>(scope, 'usage', []);
    const feedback = await readState<unknown[]>(scope, 'feedback', []);
    const statement = await getCurrentImport(scope);
    const lastSeen = usage[0]?.at ?? null;
    return {
      participantId: entry.participant,
      name: entry.name,
      organizer: entry.organizer,
      lastSeen,
      usageCount: usage.length,
      feedbackCount: feedback.length,
      hasDre: statement !== null,
      feedback,
      usage: usage.slice(0, 80),
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    participants,
  };
}

