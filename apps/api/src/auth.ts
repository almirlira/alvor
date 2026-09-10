import type { FastifyReply, FastifyRequest } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthContext {
  readonly userId: string;
  readonly email: string | null;
  readonly workspaceId: string;
  readonly participantId: string;
  readonly name: string;
  readonly isOrganizer: boolean;
  readonly mode: 'local' | 'invite' | 'supabase';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

export interface InviteEntry {
  readonly participant: string;
  readonly name: string;
  readonly token: string;
  readonly organizer: boolean;
}

export const inviteEntries: readonly InviteEntry[] = (process.env['ALPHA_INVITES'] ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item.length > 0)
  .map((item) => {
    if (item.includes('|')) {
      const [participant, name, token] = item.split('|');
      return participant !== undefined && token !== undefined && participant.trim().length > 0 && token.trim().length > 0
        ? { participant: participant.trim(), name: name?.trim() || participant.trim(), token: token.trim(), organizer: participant.trim() === 'P00' }
        : null;
    }
    const sep = item.includes(':') ? ':' : '=';
    const [participant, token] = item.split(sep);
    return participant !== undefined && token !== undefined && participant.trim().length > 0 && token.trim().length > 0
      ? { participant: participant.trim(), name: participant.trim(), token: token.trim(), organizer: participant.trim() === 'P00' }
      : null;
  })
  .filter((item): item is InviteEntry => item !== null);

export const supabaseAuthEnabled = supabaseUrl.length > 0 && serviceRoleKey.length > 0;
export const inviteAuthEnabled = inviteEntries.length > 0;
export const authEnabled = supabaseAuthEnabled || inviteAuthEnabled;

export const supabaseAdmin: SupabaseClient | null = supabaseAuthEnabled
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const LOCAL_AUTH: AuthContext = {
  userId: 'local-owner',
  email: 'local@alvor.dev',
  workspaceId: 'local-workspace',
  participantId: 'LOCAL',
  name: 'Fundador local',
  isOrganizer: true,
  mode: 'local',
};

function bearerToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (raw === undefined) return null;
  const [kind, token] = raw.split(' ');
  if (kind?.toLowerCase() !== 'bearer' || token === undefined || token.trim().length === 0) return null;
  return token.trim();
}

async function ensureWorkspace(userId: string, email: string | null): Promise<string> {
  if (supabaseAdmin === null) return LOCAL_AUTH.workspaceId;

  await supabaseAdmin.from('profiles').upsert({ id: userId, email }, { onConflict: 'id' });

  const existing = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.error !== null) throw existing.error;
  const workspaceId = typeof existing.data?.workspace_id === 'string' ? existing.data.workspace_id : null;
  if (workspaceId !== null) return workspaceId;

  const workspace = await supabaseAdmin
    .from('workspaces')
    .insert({ name: email === null ? 'Meu espaco ALVOR' : `ALVOR de ${email}` })
    .select('id')
    .single();

  if (workspace.error !== null) throw workspace.error;
  const newWorkspaceId = workspace.data.id as string;

  const member = await supabaseAdmin
    .from('workspace_members')
    .insert({ workspace_id: newWorkspaceId, user_id: userId, role: 'owner' });

  if (member.error !== null) throw member.error;
  return newWorkspaceId;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled) {
    req.auth = LOCAL_AUTH;
    return;
  }

  const token = bearerToken(req);
  if (token === null) {
    await reply.code(401).send({ message: 'Sessao ausente. Entre novamente.' });
    return;
  }

  if (inviteAuthEnabled && supabaseAdmin === null) {
    const entry = inviteEntries.find((item) => item.token === token);
    if (entry === undefined) {
      await reply.code(401).send({ message: 'Convite invalido ou expirado.' });
      return;
    }
    req.auth = {
      userId: entry.participant,
      email: null,
      workspaceId: entry.participant,
      participantId: entry.participant,
      name: entry.name,
      isOrganizer: entry.organizer,
      mode: 'invite',
    };
    return;
  }

  if (supabaseAdmin === null) {
    await reply.code(500).send({ message: 'Autenticacao indisponivel.' });
    return;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error !== null || data.user === null) {
    await reply.code(401).send({ message: 'Sessao expirada. Entre novamente.' });
    return;
  }

  const email = data.user.email ?? null;
  const workspaceId = await ensureWorkspace(data.user.id, email);
  req.auth = {
    userId: data.user.id,
    email,
    workspaceId,
    participantId: data.user.id,
    name: email ?? 'Fundador',
    isOrganizer: false,
    mode: 'supabase',
  };
}
