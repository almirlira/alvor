/**
 * dre-kpis.ts — KPIs financeiros por mes, funcoes puras sobre a DRE canonica.
 *
 * Todos os numeros aqui viram fontes citaveis ([ref:kpi#<id>#<mes>]) no prompt da IA.
 * A IA NUNCA calcula — tudo que ela pode falar em numero nasce aqui.
 */

import { ACCOUNT_BY_KEY, EXPENSE_GROUP_KEYS, type EntryKey } from './dre-model.js';
import type { DreStatement } from './dre-profile.js';

export interface TopExpense {
  readonly label: string;
  readonly key: EntryKey | null;
  readonly value: number;
  /** Participacao sobre o total de despesas operacionais (%). */
  readonly sharePct: number | null;
  /** Variacao contra o mes anterior (%). null quando nao ha base. */
  readonly deltaPct: number | null;
  readonly previousValue: number | null;
}

export interface MonthKpis {
  readonly month: string;
  readonly receita_bruta: number;
  readonly receita_liquida: number;
  readonly lucro_bruto: number;
  readonly margem_bruta_pct: number | null;
  readonly despesas_operacionais: number;
  readonly despesas_sobre_receita_pct: number | null;
  readonly resultado_operacional: number;
  readonly margem_operacional_pct: number | null;
  readonly resultado_liquido: number;
  readonly margem_liquida_pct: number | null;
  readonly margem_contribuicao: number;
  readonly margem_contribuicao_pct: number | null;
  readonly custos_fixos: number;
  readonly custos_variaveis: number;
  readonly ponto_equilibrio: number | null;
  readonly variacao_receita_pct: number | null;
  readonly variacao_despesas_pct: number | null;
  readonly variacao_resultado_pct: number | null;
  readonly variacao_margem_bruta_pp: number | null;
  /** Participacao de cada grupo de despesa no total de despesas (%). */
  readonly participacao_despesas: Readonly<Record<EntryKey, number | null>>;
  readonly top_despesas: readonly TopExpense[];
}

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole === 0) return null;
  return round2((part / whole) * 100);
}

function delta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
  // Variacao percentual so faz sentido com base comparavel: mesmo sinal e base nao-desprezivel
  // (ex.: resultado de -35 para -10.690 daria "-30.442%" — inutil para o dono).
  if (Math.sign(current) !== Math.sign(previous) && current !== 0) return null;
  if (Math.abs(previous) < Math.abs(current) * 0.05) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function expenseLinesForMonth(statement: DreStatement, monthIndex: number): TopExpense[] {
  const totalDespesas = statement.canonical[statement.months[monthIndex] ?? '']?.despesas_operacionais ?? 0;
  const out: TopExpense[] = [];
  for (const line of statement.lines) {
    if (line.key === null || line.isSubtotal || line.isGroupHeader) continue;
    const def = ACCOUNT_BY_KEY.get(line.key);
    if (def === undefined || def.kind !== 'expense') continue;
    const v = line.values[monthIndex];
    if (v === null || v === undefined) continue;
    const value = Math.abs(v);
    if (value === 0) continue;
    const prevRaw = monthIndex > 0 ? line.values[monthIndex - 1] : null;
    const previousValue = prevRaw === null || prevRaw === undefined ? null : Math.abs(prevRaw);
    out.push({
      label: line.rawLabel,
      key: line.key as EntryKey,
      value: round2(value),
      sharePct: pct(value, totalDespesas),
      deltaPct: previousValue === null ? null : delta(value, previousValue),
      previousValue: previousValue === null ? null : round2(previousValue),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function computeMonthKpis(statement: DreStatement): readonly MonthKpis[] {
  const out: MonthKpis[] = [];
  statement.months.forEach((month, mi) => {
    const c = statement.canonical[month];
    if (c === undefined) return;
    const prev = mi > 0 ? statement.canonical[statement.months[mi - 1] ?? ''] : undefined;

    let fixos = 0;
    let variaveis = 0;
    for (const k of EXPENSE_GROUP_KEYS) {
      const def = ACCOUNT_BY_KEY.get(k);
      if (def?.behavior === 'variavel') variaveis += c[k];
      else fixos += c[k];
    }
    variaveis += c.cmv + c.deducoes;
    fixos += c.despesas_financeiras;
    const margemContribuicao = c.receita_bruta - variaveis;
    const mcPct = pct(margemContribuicao, c.receita_bruta);
    const pontoEquilibrio = mcPct === null || mcPct <= 0 ? null : round2(fixos / (mcPct / 100));

    const participacao = {} as Record<EntryKey, number | null>;
    for (const k of EXPENSE_GROUP_KEYS) participacao[k] = pct(c[k], c.despesas_operacionais);

    const prevMargemBruta = prev === undefined ? null : pct(prev.lucro_bruto, prev.receita_liquida);
    const margemBruta = pct(c.lucro_bruto, c.receita_liquida);

    out.push({
      month,
      receita_bruta: round2(c.receita_bruta),
      receita_liquida: round2(c.receita_liquida),
      lucro_bruto: round2(c.lucro_bruto),
      margem_bruta_pct: margemBruta,
      despesas_operacionais: round2(c.despesas_operacionais),
      despesas_sobre_receita_pct: pct(c.despesas_operacionais, c.receita_liquida),
      resultado_operacional: round2(c.resultado_operacional),
      margem_operacional_pct: pct(c.resultado_operacional, c.receita_liquida),
      resultado_liquido: round2(c.resultado_liquido),
      margem_liquida_pct: pct(c.resultado_liquido, c.receita_liquida),
      margem_contribuicao: round2(margemContribuicao),
      margem_contribuicao_pct: mcPct,
      custos_fixos: round2(fixos),
      custos_variaveis: round2(variaveis),
      ponto_equilibrio: pontoEquilibrio,
      variacao_receita_pct: delta(c.receita_liquida, prev?.receita_liquida),
      variacao_despesas_pct: delta(c.despesas_operacionais, prev?.despesas_operacionais),
      variacao_resultado_pct: delta(c.resultado_liquido, prev?.resultado_liquido),
      variacao_margem_bruta_pp:
        margemBruta === null || prevMargemBruta === null ? null : round2(margemBruta - prevMargemBruta),
      participacao_despesas: participacao,
      top_despesas: expenseLinesForMonth(statement, mi).slice(0, 8),
    });
  });
  return out;
}
