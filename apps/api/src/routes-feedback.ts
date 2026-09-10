import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from './auth.js';
import { readState, writeState } from './state.js';

interface FeedbackNote {
  readonly id: string;
  readonly workspace_id: string;
  readonly author_id: string;
  readonly author_name: string;
  readonly area: string;
  readonly task_id: string | null;
  readonly ease: number;
  readonly outcome: 'completed' | 'help' | 'blocked' | 'skipped';
  readonly comment: string | null;
  readonly details: Record<string, unknown>;
  readonly screen: string | null;
  readonly priority: 'baixa' | 'media' | 'alta';
  readonly status: 'aberta' | 'em_analise' | 'resolvida';
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function cleanChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/feedback', async (req, reply) => {
    if (req.auth.mode === 'supabase' && supabaseAdmin !== null) {
      const res = await supabaseAdmin
        .from('feedback_notes')
        .select('*')
        .eq('workspace_id', req.auth.workspaceId)
        .order('created_at', { ascending: false });

      if (res.error !== null) return reply.code(500).send({ message: res.error.message });
      return reply.send(res.data);
    }

    const notes = await readState<FeedbackNote[]>(req.auth, 'feedback', []);
    return reply.send([...notes].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  });

  app.post<{ Body: { area?: string; taskId?: string; ease?: number; outcome?: string; comment?: string; details?: Record<string, unknown>; note?: string; screen?: string; priority?: string } }>('/feedback', async (req, reply) => {
    const rawEase = req.body?.ease;
    if (typeof rawEase !== 'number' || !Number.isInteger(rawEase) || rawEase < 1 || rawEase > 7) {
      return reply.code(400).send({ message: 'Informe a facilidade de 1 a 7.' });
    }
    const ease = rawEase;
    const outcome = cleanChoice(req.body?.outcome, ['completed', 'help', 'blocked', 'skipped'] as const, 'blocked');
    const rawComment = (req.body?.comment ?? req.body?.note ?? '').trim();

    const payload = {
      workspace_id: req.auth.workspaceId,
      author_id: req.auth.userId,
      author_name: req.auth.name,
      area: (req.body?.area ?? req.body?.screen ?? 'geral').trim().slice(0, 80) || 'geral',
      task_id: typeof req.body?.taskId === 'string' && req.body.taskId.trim().length > 0 ? req.body.taskId.trim().slice(0, 80) : null,
      ease,
      outcome,
      comment: rawComment.length > 0 ? rawComment.slice(0, 2000) : null,
      details: req.body?.details ?? {},
      screen: typeof req.body?.screen === 'string' ? req.body.screen.trim().slice(0, 80) : null,
      priority: cleanChoice(req.body?.priority, ['baixa', 'media', 'alta'] as const, 'media'),
      status: 'aberta' as const,
      note: rawComment.length > 0 ? rawComment.slice(0, 2000) : null,
    };

    if (req.auth.mode === 'supabase' && supabaseAdmin !== null) {
      const res = await supabaseAdmin.from('feedback_notes').insert(payload).select('*').single();
      if (res.error !== null) return reply.code(500).send({ message: res.error.message });
      return reply.code(201).send(res.data);
    }

    const now = new Date().toISOString();
    const item: FeedbackNote = { id: randomUUID(), ...payload, created_at: now, updated_at: now };
    const notes = await readState<FeedbackNote[]>(req.auth, 'feedback', []);
    await writeState(req.auth, 'feedback', [item, ...notes]);
    return reply.code(201).send(item);
  });
}
