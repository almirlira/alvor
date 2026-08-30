import type { TopExpense } from '../../../../packages/ingest/src/dre-kpis';
import { formatBRL, formatPct } from '../lib/format';

export function TopDespesas({ items }: { readonly items: readonly TopExpense[] }): JSX.Element {
  if (items.length === 0) return <p className="dre-subtitle">Sem despesas classificadas neste mes.</p>;
  const max = items[0]?.value ?? 1;
  return (
    <ul className="dre-top">
      {items.map((it) => {
        const cls = it.deltaPct === null ? '' : it.deltaPct > 0.5 ? 'up' : it.deltaPct < -0.5 ? 'down' : '';
        return (
          <li key={it.label}>
            <div className="lbl">
              <span title={it.label}>{it.label}</span>
              <div className="bar" style={{ width: `${Math.max(4, (it.value / max) * 100)}%` }} aria-hidden="true" />
            </div>
            <span className="val">{formatBRL(it.value)}<small style={{ color: 'var(--md-on-surface-variant)', fontWeight: 400 }}> · {formatPct(it.sharePct, 0)}</small></span>
            <span className={`dlt ${cls}`} title="variacao contra o mes anterior">
              {it.deltaPct === null ? '—' : `${it.deltaPct > 0 ? '+' : ''}${formatPct(it.deltaPct, 0)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
