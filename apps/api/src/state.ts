import { readJson, writeJson } from './store.js';
import { supabaseAdmin } from './auth.js';

export interface StateScope {
  readonly workspaceId: string;
  readonly mode: 'local' | 'invite' | 'supabase';
}

export async function readState<T>(scope: StateScope, key: string, fallback: T): Promise<T> {
  if (scope.mode === 'local' || supabaseAdmin === null) {
    const scopedKey = scope.mode === 'invite' ? `invite-${scope.workspaceId}-${key}` : key;
    return readJson<T>(scopedKey, fallback);
  }

  const res = await supabaseAdmin
    .from('alpha_state')
    .select('value')
    .eq('workspace_id', scope.workspaceId)
    .eq('key', key)
    .maybeSingle();

  if (res.error !== null) throw res.error;
  return res.data === null ? fallback : (res.data.value as T);
}

export async function writeState(scope: StateScope, key: string, value: unknown): Promise<void> {
  if (scope.mode === 'local' || supabaseAdmin === null) {
    const scopedKey = scope.mode === 'invite' ? `invite-${scope.workspaceId}-${key}` : key;
    writeJson(scopedKey, value);
    return;
  }

  const res = await supabaseAdmin.from('alpha_state').upsert(
    {
      workspace_id: scope.workspaceId,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,key' },
  );

  if (res.error !== null) throw res.error;
}
