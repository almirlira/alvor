import { useMemo } from 'react';
import { useDre } from '../lib/dre-context';
import { formatBRL, formatPct, monthShort } from '../lib/format';

/**
 * Barra fixa de rodape, estilo ticker de mercado.
 *
 * Mostra em destaque LUCRO BRUTO, LUCRO LIQUIDO, CUSTOS e DESPESAS do ultimo mes
 * da DRE, com a variacao contra o mes anterior, em rolagem continua.
 *
 * Semantica de cor (nao e "subiu = verde"):
 *   lucro/receita/margem sobem  → verde   | caem → vermelho
 *   custo/despesa sobem         → vermelho| caem → verde
 *
 * Todos os numeros vem da DRE ja lida — nada e estimado aqui.
 */

type Direction = 'higher-is-better' | 'lower-is-better';

interface TickerItem {
  readonly label: string;
  readonly value: string;
  readonly deltaPct: number | null;
  readonly direction: Direction;
  readonly primary: boolean;
}

/** Variacao percentual so quando a base e comparavel (mesmo sinal, base relevante). */
function delta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
  if (Math.sign(current) !== Math.sign(previous) && current !== 0) return null;
  if (Math.abs(previous) < Math.abs(current) * 0.05) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function toneOf(item: TickerItem): 'up' | 'down' | 'flat' {
  if (item.deltaPct === null || Math.abs(item.deltaPct) < 0.1) return 'flat';
  const rising = item.deltaPct > 0;
  const good = item.direction === 'higher-is-better' ? rising : !rising;
  return good ? 'up' : 'down';
}

function Item({ item }: { readonly item: TickerItem }): JSX.Element {
  const tone = toneOf(item);
  const arrow = item.deltaPct === null || tone === 'flat' ? '—' : item.deltaPct > 0 ? '▲' : '▼';
  return (
    <span className={`tk-item${item.primary ? ' tk-primary' : ''}`}>
      <span className="tk-label">{item.label}</span>
      <span className="tk-line">
        <span className="tk-value">{item.value}</span>
        <span className={`tk-delta tk-${tone}`}>
          {arrow}
          {item.deltaPct !== null && tone !== 'flat' && ` ${Math.abs(item.deltaPct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
        </span>
      </span>
    </span>
  );
}

export function TickerBar(): JSX.Element | null {
  const { data } = useDre();

  const items = useMemo<readonly TickerItem[]>(() => {
    if (data === null) return [];
    const { statement, kpis } = data;
    const i = kpis.length - 1;
    const k = kpis[i];
    const ym = statement.months[i];
    if (k === undefined || ym === undefined) return [];
    const prev = i > 0 ? kpis[i - 1] : undefined;
    const c = statement.canonical[ym];
    const cPrev = i > 0 ? statement.canonical[statement.months[i - 1] ?? ''] : undefined;
    if (c === undefined) return [];

    return [
      { label: 'LUCRO BRUTO', value: formatBRL(k.lucro_bruto), deltaPct: delta(k.lucro_bruto, prev?.lucro_bruto), direction: 'higher-is-better', primary: true },
      { label: 'LUCRO LIQUIDO', value: formatBRL(k.resultado_liquido), deltaPct: delta(k.resultado_liquido, prev?.resultado_liquido), direction: 'higher-is-better', primary: true },
      { label: 'CUSTOS', value: formatBRL(c.cmv), deltaPct: delta(c.cmv, cPrev?.cmv), direction: 'lower-is-better', primary: true },
      { label: 'DESPESAS', value: formatBRL(k.despesas_operacionais), deltaPct: delta(k.despesas_operacionais, prev?.despesas_operacionais), direction: 'lower-is-better', primary: true },
      { label: 'RECEITA LIQUIDA', value: formatBRL(k.receita_liquida), deltaPct: k.variacao_receita_pct, direction: 'higher-is-better', primary: false },
      { label: 'MARGEM BRUTA', value: formatPct(k.margem_bruta_pct), deltaPct: delta(k.margem_bruta_pct ?? 0, prev?.margem_bruta_pct ?? undefined), direction: 'higher-is-better', primary: false },
      { label: 'PONTO DE EQUILIBRIO', value: formatBRL(k.ponto_equilibrio), deltaPct: delta(k.ponto_equilibrio ?? 0, prev?.ponto_equilibrio ?? undefined), direction: 'lower-is-better', primary: false },
    ];
  }, [data]);

  if (data === null || items.length === 0) return null;
  const month = data.statement.months[data.statement.months.length - 1] ?? '';

  return (
    <aside className="tk-bar" aria-label="Indicadores do ultimo mes da DRE">
      <div className="tk-badge">
        <span className="tk-dot" aria-hidden="true" />
        {monthShort(month)}
      </div>
      <div className="tk-viewport">
        {/* Duas copias em sequencia — o laco reinicia sem emenda visivel. */}
        <div className="tk-track">
          {[0, 1].map((copy) => (
            <div className="tk-group" key={copy} aria-hidden={copy === 1}>
              {items.map((it) => <Item key={`${copy}-${it.label}`} item={it} />)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
