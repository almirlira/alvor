import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DreTable } from '../components/DreTable';
import { TopDespesas } from '../components/TopDespesas';
import { BarrasMes } from '../components/BarrasMes';
import { ExplainPanel } from '../components/ExplainPanel';
import { SemaforoCard } from '../components/SemaforoCard';
import { WelcomeBand } from '../components/WelcomeBand';
import type { SemaforoResult } from './SemaforoPage';
import { apiClient } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { useDre } from '../lib/dre-context';
import { formatBRL, formatPct, monthShort } from '../lib/format';

export function PainelPage(): JSX.Element {
  const { data, loading } = useDre();
  const auth = useAuth();
  const navigate = useNavigate();
  const months = data?.statement.months ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const month = selected ?? months[months.length - 1] ?? null;
  const mi = month === null ? -1 : months.indexOf(month);
  const k = mi >= 0 ? data?.kpis[mi] : undefined;
  const [sem, setSem] = useState<SemaforoResult | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const explainTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (month === null) return;
    void (async () => {
      try {
        setSem(await apiClient.get<SemaforoResult>(`/semaforo?month=${encodeURIComponent(month)}`));
      } catch {
        setSem(null);
      }
    })();
  }, [month]);

  if (loading) return <div className="dre-empty">Carregando…</div>;
  if (!data || !k || month === null) {
    return (
      <div className="dre-empty">
        <p>Nenhuma DRE enviada ainda.</p>
        <button type="button" className="dre-btn" onClick={() => navigate('/enviar')}>Enviar arquivos</button>
      </div>
    );
  }

  const neg = k.resultado_liquido < 0;
  const total = sem === null ? 0 : sem.counts.verde + sem.counts.amarelo + sem.counts.vermelho;
  const help = (key: string) => (e: React.MouseEvent<HTMLButtonElement>): void => {
    explainTrigger.current = e.currentTarget;
    setExplain(key);
  };

  return (
    <>
      <WelcomeBand
        month={month}
        months={months}
        onMonthChange={setSelected}
        fileName={data.statement.fileName}
        resultadoLiquido={k.resultado_liquido}
        counts={sem?.counts ?? null}
        monthShortFn={monthShort}
        displayName={auth.participantName ?? 'fundador'}
      />

      {/* HERO BENTO */}
      <section className="bento-grid" aria-label="Resumo do mês">
        <div className="bento-tile tile-orange">
          <div>
            <div className="tile-label">Resultado líquido do mês</div>
            <div className="tile-number-hero">{formatBRL(k.resultado_liquido)}</div>
          </div>
          <div className="tile-foot">
            <span>
              {neg ? 'A receita não cobriu custos, despesas e juros.' : 'Sobrou depois de tudo.'} Receita líquida {formatBRL(k.receita_liquida)}
              {k.variacao_receita_pct !== null && ` (${k.variacao_receita_pct > 0 ? '+' : ''}${formatPct(k.variacao_receita_pct)} vs. mês anterior)`}.
            </span>
            <button type="button" className="pill-btn pill-dark" onClick={() => navigate('/semaforo')}>Ver semaforo →</button>
          </div>
        </div>
        <div className="bento-tile tile-cream">
          <div>
            <div className="tile-label">Margem bruta</div>
            <div className="tile-number-hero tile-number-percent">{formatPct(k.margem_bruta_pct)}</div>
          </div>
          <div className="tile-foot">
            {k.variacao_margem_bruta_pp === null
              ? 'De cada real vendido, o que sobra depois do CMV.'
              : `${k.variacao_margem_bruta_pp > 0 ? '+' : ''}${k.variacao_margem_bruta_pp.toLocaleString('pt-BR')} pontos vs. mês anterior — ${k.variacao_margem_bruta_pp < 0 ? 'o custo subiu mais que o preço.' : 'preço e custo estão mais saudáveis.'}`}
          </div>
        </div>
      </section>

      {/* SEMAFORO — HERO */}
      <section aria-label="Semaforo de autonomia">
        <div className="section-header">
          <h2 className="section-title">Semáforo de autonomia</h2>
          <div className="section-actions">
            <span className="section-meta">
            {sem === null ? '…' : `${sem.counts.vermelho} vermelho · ${sem.counts.amarelo} amarelo · ${sem.counts.verde} verde`}
            </span>
            <button type="button" className="pill-btn pill-light section-link" onClick={() => navigate('/semaforo')}>Ver todos ({total})</button>
          </div>
        </div>
        <div className="sem-hero-grid">
          {(['vermelho', 'amarelo', 'verde'] as const).map((lvl) => {
            const card = sem?.hero.find((c) => c.level === lvl);
            return card === undefined
              ? <div key={lvl} className="sem-empty">Nada em {lvl} para {monthShort(month)}.</div>
              : <SemaforoCard key={card.id} card={card} compact onOpen={() => navigate(`/semaforo?open=${encodeURIComponent(card.id)}`)} />;
          })}
        </div>
      </section>

      {/* SWISS 4 QUADRANTES */}
      <section className="metrics-section" aria-label="Métricas do mês">
        <div className="swiss-grid-box">
          <div className="swiss-quadrant">
            <div className="quadrant-label"><span>Receita líquida</span><button type="button" className="quadrant-help" onClick={help('kpi_receita_liquida')} aria-label="Explicar receita líquida">?</button></div>
            <div>
              <div className="quadrant-value">{formatBRL(k.receita_liquida)}</div>
              <div className="quadrant-sub">bruta {formatBRL(k.receita_bruta)}</div>
            </div>
          </div>
          <div className="swiss-quadrant">
            <div className="quadrant-label"><span>Despesas / receita</span><button type="button" className="quadrant-help" onClick={help('kpi_despesas_sobre_receita')} aria-label="Explicar despesas sobre receita">?</button></div>
            <div>
              <div className="quadrant-value">{formatPct(k.despesas_sobre_receita_pct)}</div>
              <div className="quadrant-sub">despesas {formatBRL(k.despesas_operacionais)}{k.variacao_despesas_pct !== null && ` · ${k.variacao_despesas_pct > 0 ? '+' : ''}${formatPct(k.variacao_despesas_pct, 0)}`}</div>
            </div>
          </div>
          <div className="swiss-quadrant">
            <div className="quadrant-label"><span>Resultado operacional</span><button type="button" className="quadrant-help" onClick={help('kpi_resultado_operacional')} aria-label="Explicar resultado operacional">?</button></div>
            <div>
              <div className={`quadrant-value${k.resultado_operacional < 0 ? ' neg' : ''}`}>{formatBRL(k.resultado_operacional)}</div>
              <div className="quadrant-sub">margem líquida {formatPct(k.margem_liquida_pct)}</div>
            </div>
          </div>
          <div className="swiss-quadrant">
            <div className="quadrant-label"><span>Ponto de equilíbrio</span><button type="button" className="quadrant-help" onClick={help('kpi_ponto_equilibrio')} aria-label="Explicar ponto de equilíbrio">?</button></div>
            <div>
              <div className="quadrant-value">{formatBRL(k.ponto_equilibrio)}</div>
              <div className="quadrant-sub">receita bruta mínima · MC {formatPct(k.margem_contribuicao_pct)}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="dre-grid-2 dashboard-detail-grid">
        <section className="dre-card">
          <h3>Receita × despesas × resultado (por mês)</h3>
          <BarrasMes kpis={data.kpis} selected={month} onSelect={setSelected} />
        </section>
        <section className="dre-card">
          <h3>Maiores despesas em {monthShort(month)}</h3>
          <TopDespesas items={k.top_despesas.slice(0, 6)} />
        </section>
      </div>

      <section className="dre-card dre-table-card">
        <h3>DRE canônica</h3>
        <p className="dre-table-hint">Deslize para ver os outros meses →</p>
        <DreTable statement={data.statement} selected={month} />
      </section>

      <div className="dre-actions dashboard-final-action">
        <button type="button" className="dre-btn" onClick={() => navigate('/copilot')}>Pedir a leitura do Copilot →</button>
      </div>

      <ExplainPanel metricKey={explain} onClose={() => setExplain(null)} triggerRef={explainTrigger} />
    </>
  );
}
