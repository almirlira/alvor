import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const supabaseEnabled = url !== undefined && url.length > 0 && anonKey !== undefined && anonKey.length > 0;

export const supabase: SupabaseClient | null = supabaseEnabled ? createClient(url ?? '', anonKey ?? '') : null;

export async function currentAccessToken(): Promise<string | null> {
  if (supabase === null) return null;
  const { data } = await supabase.auth.getSession();
  const session: Session | null = data.session;
  return session?.access_token ?? null;
}
