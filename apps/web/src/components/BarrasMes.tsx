import type { MonthKpis } from '../../../../packages/ingest/src/dre-kpis';
import { formatBRL, monthShort } from '../lib/format';

interface Props {
  readonly kpis: readonly MonthKpis[];
  readonly selected: string;
  readonly onSelect?: (month: string) => void;
}


/** Barras agrupadas em SVG puro: receita liquida, despesas operacionais (+CMV) e resultado liquido. */
export function BarrasMes({ kpis, selected, onSelect }: Props): JSX.Element {
  const W = 760;
  const H = 240;
  const padL = 8;
  const padB = 26;
  const padT = 10;
  const n = Math.max(1, kpis.length);
  const groupW = (W - padL * 2) / n;
  const barW = Math.max(4, Math.min(16, groupW / 4));
  const vals = kpis.flatMap((k) => [k.receita_liquida, k.despesas_operacionais + (k.receita_liquida - k.lucro_bruto), k.resultado_liquido]);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const minV = Math.min(0, ...vals);
  const range = max - minV;
  const scale = (H - padT - padB) / range;
  const zeroY = padT + max * scale;

  const bar = (x: number, v: number, cls: string, title: string): JSX.Element => {
    const h = Math.abs(v) * scale;
    const y = v >= 0 ? zeroY - h : zeroY;
    return <rect x={x} y={y} width={barW} height={Math.max(1, h)} className={cls} rx={2}><title>{title}</title></rect>;
  };

  return (
    <>
      <svg className="dre-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Receita, despesas e resultado por mes">
        <line x1={padL} x2={W - padL} y1={zeroY} y2={zeroY} className="chart-axis" />
        {kpis.map((k, i) => {
          const gx = padL + i * groupW;
          const cx = gx + groupW / 2;
          const desp = k.despesas_operacionais + (k.receita_liquida - k.lucro_bruto);
          const isSel = k.month === selected;
          return (
            <g key={k.month} onClick={() => onSelect?.(k.month)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              {isSel && <rect x={gx} y={padT} width={groupW} height={H - padT - padB} className="chart-sel" rx={6} />}
              {bar(cx - barW * 1.5 - 2, k.receita_liquida, 'chart-receita', `Receita liquida ${monthShort(k.month)}: ${formatBRL(k.receita_liquida)}`)}
              {bar(cx - barW / 2, desp, 'chart-despesas', `Custos + despesas ${monthShort(k.month)}: ${formatBRL(desp)}`)}
              {bar(cx + barW / 2 + 2, k.resultado_liquido, k.resultado_liquido < 0 ? 'chart-resultado-neg' : 'chart-resultado', `Resultado liquido ${monthShort(k.month)}: ${formatBRL(k.resultado_liquido)}`)}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} className="chart-label" fontFamily="JetBrains Mono, monospace">
                {monthShort(k.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="dre-legend">
        <span><i className="l-receita" />Receita liquida</span>
        <span><i className="l-despesas" />CMV + despesas</span>
        <span><i className="l-resultado" />Resultado liquido (coral = negativo)</span>
      </div>
    </>
  );
}
