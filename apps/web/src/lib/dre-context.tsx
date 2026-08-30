import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DreStatement } from '../../../../packages/ingest/src/dre-profile';
import type { MonthKpis } from '../../../../packages/ingest/src/dre-kpis';
import { apiClient, ApiError } from './api-client';

export interface DreImport {
  readonly statement: DreStatement;
  readonly kpis: readonly MonthKpis[];
}

interface DreContextValue {
  readonly data: DreImport | null;
  readonly loading: boolean;
  readonly error: string | null;
  reload(): Promise<void>;
  setData(next: DreImport | null): void;
}

const Ctx = createContext<DreContextValue | null>(null);

export function DreProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [data, setData] = useState<DreImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiClient.get<DreImport>('/dre/current');
      setData(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setData(null);
      else setError(err instanceof Error ? err.message : 'Falha ao carregar a DRE.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<DreContextValue>(
    () => ({ data, loading, error, reload, setData }),
    [data, loading, error, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDre(): DreContextValue {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useDre fora do DreProvider');
  return v;
}
