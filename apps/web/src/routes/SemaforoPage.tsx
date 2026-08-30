import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { useDre } from '../lib/dre-context';
import { monthLong, monthShort } from '../lib/format';
import { LEVEL_MEANING, SemaforoCard, type SemaforoCardData, type SemaforoLevel } from '../components/SemaforoCard';

export interface SemaforoResult {
  readonly month: string;
  readonly cards: readonly SemaforoCardData[];
  readonly counts: Readonly<Record<SemaforoLevel, number>>;
  readonly hero: readonly SemaforoCardData[];
}

type Filter = 'todos' | SemaforoLevel;

export function SemaforoPage(): JSX.Element {
  const { data } = useDre();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const months = data?.statement.months ?? [];
  const [month, setMonth] = useState<string | null>(null);
  const [result, setResult] = useState<SemaforoResult | null>(null);
  const [filter, setFilter] = useState<Filter>((params.get('nivel') as Filter | null) ?? 'todos');
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [error, setError] = useState<string | null>(null);
  const selected = month ?? months[months.length - 1] ?? null;

  useEffect(() => {
    if (selected === null) return;
    void (async () => {
      try {
        setResult(await apiClient.get<SemaforoResult>(`/semaforo?month=${encodeURIComponent(selected)}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao montar o semaforo.');
      }
    })();
  }, [selected]);

  const visible = useMemo(() => (result?.cards ?? []).filter((c) => filter === 'todos' || c.level === filter), [result, filter]);

  if (!data || selected === null) {
    return (
      <div className="dre-empty">
        <p>Envie uma DRE para o semaforo ter o que classificar.</p>
        <button type="button" className="dre-btn" onClick={() => navigate('/enviar')}>Enviar arquivos</button>
      </div>
    );
  }

  const setF = (f: Filter): void => {
    setFilter(f);
    const next = new URLSearchParams(params);
    if (f === 'todos') next.delete('nivel'); else next.set('nivel', f);
    setParams(next, { replace: true });
  };

  const counts = result?.counts ?? { verde: 0, amarelo: 0, vermelho: 0 };
  const total = counts.verde + counts.amarelo + counts.vermelho;

  return (
    <>
      <div className="dre-head">
        <div>
          <div className="dre-eyebrow">Semaforo de autonomia</div>
          <h1 className="dre-title">O que fazer — e com quem — em {monthLong(selected)}</h1>
          <p className="dre-subtitle">Cada card e uma hipotese fundamentada nos numeros da sua DRE, nunca um parecer. A cor diz ate onde voce vai sozinho.</p>
        </div>
        <label>
          <span className="dre-eyebrow" style={{ display: 'block', marginBottom: 4 }}>Mes</span>
          <select className="dre-month-select" value={selected} onChange={(e) => { setMonth(e.target.value); setOpen(null); }}>
            {months.map((m) => <option key={m} value={m}>{monthShort(m)}</option>)}
          </select>
        </label>
      </div>

      <div className="sem-legend">
        <div><b style={{ color: 'var(--alarm-green)' }}>VERDE</b>{LEVEL_MEANING.verde}</div>
        <div><b style={{ color: 'var(--alarm-yellow)' }}>AMARELO</b>{LEVEL_MEANING.amarelo}</div>
        <div><b style={{ color: 'var(--alarm-red)' }}>VERMELHO</b>{LEVEL_MEANING.vermelho}</div>
      </div>

      <div className="sem-filters" role="tablist" aria-label="Filtrar por nivel">
        <button type="button" role="tab" aria-selected={filter === 'todos'} className={`sem-filter${filter === 'todos' ? ' active' : ''}`} onClick={() => setF('todos')}>Todos <span>{total}</span></button>
        {(['vermelho', 'amarelo', 'verde'] as const).map((lvl) => (
          <button key={lvl} type="button" role="tab" aria-selected={filter === lvl} className={`sem-filter f-${lvl}${filter === lvl ? ' active' : ''}`} onClick={() => setF(lvl)}>
            <i aria-hidden="true" />{lvl} <span>{counts[lvl]}</span>
          </button>
        ))}
      </div>

      {error !== null && <div className="dre-err">{error}</div>}

      {result !== null && visible.length === 0 && <div className="sem-empty">Nenhum card neste nivel para {monthShort(selected)}.</div>}

      <div className="sem-stack">
        {visible.map((c) => (
          <SemaforoCard key={c.id} card={c} expanded={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </div>
    </>
  );
}
