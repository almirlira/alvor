import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiClient, setAuthTokenProvider } from './api-client';
import { currentAccessToken, supabase, supabaseEnabled } from './supabase';

const inviteAuthEnabled = (import.meta.env['VITE_ALPHA_INVITE_AUTH'] as string | undefined) === 'on';
const inviteStorageKey = 'alvor-alpha-invite-token-v1';

interface InviteSession {
  readonly participantId: string;
  readonly name: string;
  readonly organizer: boolean;
}

interface AuthContextValue {
  readonly enabled: boolean;
  readonly mode: 'none' | 'invite' | 'supabase';
  readonly loading: boolean;
  readonly session: Session | InviteSession | null;
  readonly participantName: string | null;
  readonly participantId: string | null;
  readonly organizer: boolean;
  signIn(value: string): Promise<void>;
  signOut(): Promise<void>;
}

interface MeResponse {
  readonly participantId: string;
  readonly name: string;
  readonly organizer: boolean;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | InviteSession | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled || inviteAuthEnabled);

  useEffect(() => {
    if (inviteAuthEnabled) {
      setAuthTokenProvider(async () => localStorage.getItem(inviteStorageKey));
      const token = localStorage.getItem(inviteStorageKey);
      if (token === null) {
        setSession(null);
        setLoading(false);
      } else {
        void apiClient.get<MeResponse>('/me').then((me) => {
          setSession({ participantId: me.participantId, name: me.name, organizer: me.organizer });
          setLoading(false);
        }).catch(() => {
          localStorage.removeItem(inviteStorageKey);
          setSession(null);
          setLoading(false);
        });
      }
      return undefined;
    }

    setAuthTokenProvider(currentAccessToken);
    if (supabase === null) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const sub = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: inviteAuthEnabled || supabaseEnabled,
      mode: inviteAuthEnabled ? 'invite' : supabaseEnabled ? 'supabase' : 'none',
      loading,
      session,
      participantName: session !== null && 'name' in session ? session.name : session?.user.email ?? null,
      participantId: session !== null && 'participantId' in session ? session.participantId : session?.user.id ?? null,
      organizer: session !== null && 'organizer' in session ? session.organizer : false,
      async signIn(value: string): Promise<void> {
        if (inviteAuthEnabled) {
          const token = value.trim();
          if (token.length < 8) throw new Error('Informe o codigo de convite completo.');
          localStorage.setItem(inviteStorageKey, token);
          try {
            const me = await apiClient.get<MeResponse>('/me');
            setSession({ participantId: me.participantId, name: me.name, organizer: me.organizer });
          } catch (err) {
            localStorage.removeItem(inviteStorageKey);
            throw err;
          }
          return;
        }
        if (supabase === null) return;
        const { error } = await supabase.auth.signInWithOtp({
          email: value,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
          },
        });
        if (error !== null) throw error;
      },
      async signOut(): Promise<void> {
        if (inviteAuthEnabled) {
          localStorage.removeItem(inviteStorageKey);
          setSession(null);
          return;
        }
        if (supabase !== null) await supabase.auth.signOut();
      },
    }),
    [loading, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useAuth fora do AuthProvider');
  return v;
}
