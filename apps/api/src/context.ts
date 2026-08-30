/**
 * context.ts — transforma a DRE + KPIs + referencias fiscais em itens citaveis
 * ([ref:...]) para o prompt, no formato ScopedDataItem do guardiao do CROSS.
 *
 * Convencao de ids:
 *   dre#<conta>#<AAAA-MM>       valor canonico de uma conta no mes
 *   linha#<row>#<AAAA-MM>       linha original da planilha (ex.: "Marketing")
 *   kpi#<id>#<AAAA-MM>          KPI calculado (margem, ponto de equilibrio…)
 *   fiscal#<id>                 referencia fiscal/contabil verificada (fonte oficial)
 *
 * A IA nao calcula: tudo que ela pode citar em numero nasce aqui.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SanitizedContext, ScopedDataItem, SourceRef } from '@dre/ai';
import { ACCOUNTS, ACCOUNT_BY_KEY, EXPENSE_GROUP_KEYS, type DreImport, type MonthKpis } from '@dre/ingest';
import { KB_DIR } from './store.js';

export const TENANT_ID = 'demo';
export const USER_ID = 'owner';

const MONTHS_LONG = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS_LONG[Number(m) - 1] ?? m} de ${y}`;
}

function monthPeriod(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

/** Detalhe por ref — usado pela UI para mostrar "de onde veio". */
export interface SourceDetail {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly period?: string;
  readonly detail: string;
  readonly sourceType: string;
}

export interface BuiltContext {
  readonly context: SanitizedContext;
  readonly details: ReadonlyMap<string, SourceDetail>;
}

interface FiscalItem {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly description: string;
  readonly source_url: string;
  readonly vigencia: string;
}

export function loadFiscalReference(): readonly FiscalItem[] {
  const p = join(KB_DIR, 'fiscal_reference.json');
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { items?: FiscalItem[] };
    return raw.items ?? [];
  } catch {
    return [];
  }
}

function ref(id: string, value: number): SourceRef {
  return { id, tenantId: TENANT_ID, table: id.split('#')[0] ?? 'dre', rowId: id, value, classification: 'financial' };
}

const KPI_FIELDS: ReadonlyArray<{ key: keyof MonthKpis; id: string; label: string; unit: string }> = [
  { key: 'receita_bruta', id: 'kpi_receita_bruta', label: 'Receita bruta', unit: 'BRL' },
  { key: 'receita_liquida', id: 'kpi_receita_liquida', label: 'Receita liquida', unit: 'BRL' },
  { key: 'lucro_bruto', id: 'kpi_lucro_bruto', label: 'Lucro bruto', unit: 'BRL' },
  { key: 'margem_bruta_pct', id: 'kpi_margem_bruta', label: 'Margem bruta', unit: '%' },
  { key: 'despesas_operacionais', id: 'kpi_despesas_operacionais', label: 'Despesas operacionais', unit: 'BRL' },
  { key: 'despesas_sobre_receita_pct', id: 'kpi_despesas_sobre_receita', label: 'Despesas sobre receita', unit: '%' },
  { key: 'resultado_operacional', id: 'kpi_resultado_operacional', label: 'Resultado operacional', unit: 'BRL' },
  { key: 'resultado_liquido', id: 'kpi_resultado_liquido', label: 'Resultado liquido', unit: 'BRL' },
  { key: 'margem_liquida_pct', id: 'kpi_margem_liquida', label: 'Margem liquida', unit: '%' },
  { key: 'margem_contribuicao_pct', id: 'kpi_margem_contribuicao', label: 'Margem de contribuicao', unit: '%' },
  { key: 'custos_fixos', id: 'kpi_custos_fixos', label: 'Custos fixos (estimativa)', unit: 'BRL' },
  { key: 'ponto_equilibrio', id: 'kpi_ponto_equilibrio', label: 'Ponto de equilibrio (receita bruta minima)', unit: 'BRL' },
  { key: 'variacao_receita_pct', id: 'kpi_variacao_receita', label: 'Variacao da receita liquida vs mes anterior', unit: '%' },
  { key: 'variacao_despesas_pct', id: 'kpi_variacao_despesas', label: 'Variacao das despesas operacionais vs mes anterior', unit: '%' },
  { key: 'variacao_margem_bruta_pp', id: 'kpi_variacao_margem_bruta_pp', label: 'Variacao da margem bruta vs mes anterior (pontos)', unit: 'pp' },
];

export interface BuildContextOptions {
  readonly intent: string;
  /** Meses a incluir (default: mes atual e anterior). */
  readonly months?: readonly string[];
  readonly includeLines?: boolean;
  readonly includeFiscal?: boolean;
}

export function buildContext(data: DreImport, opts: BuildContextOptions): BuiltContext {
  const { statement, kpis } = data;
  const allMonths = statement.months;
  const months = opts.months ?? allMonths.slice(-2);
  const items: ScopedDataItem[] = [];
  const details = new Map<string, SourceDetail>();

  const push = (id: string, label: string, value: number, unit: string, detail: string, sourceType: string, ym?: string): void => {
    if (!Number.isFinite(value)) return;
    const period = ym === undefined ? undefined : monthPeriod(ym);
    const periodLabel = ym === undefined ? undefined : monthLabel(ym);
    const item: ScopedDataItem = {
      sourceRef: ref(id, value),
      label: ym === undefined ? label : `${label} — ${periodLabel}`,
      value,
      unit,
      ...(period !== undefined ? { period } : {}),
    };
    items.push(item);
    details.set(id, { id, label, value, unit, detail, sourceType, ...(periodLabel !== undefined ? { period: periodLabel } : {}) });
  };

  for (const ym of months) {
    const mi = allMonths.indexOf(ym);
    if (mi < 0) continue;
    const canonical = statement.canonical[ym];
    const k = kpis[mi];
    if (canonical === undefined || k === undefined) continue;

    // Contas canonicas
    for (const a of ACCOUNTS) {
      const v = canonical[a.key];
      if (v === 0 && a.kind !== 'subtotal') continue;
      push(`dre#${a.key}#${ym}`, a.label, Math.round(v * 100) / 100, 'BRL', `Conta "${a.label}" da DRE canonica, ${monthLabel(ym)} (arquivo ${statement.fileName})`, 'dre', ym);
    }
    // Linhas originais de despesa (top) — para "qual despesa mais cresceu"
    if (opts.includeLines !== false) {
      for (const line of statement.lines) {
        if (line.key === null || line.isSubtotal || line.isGroupHeader) continue;
        const def = ACCOUNT_BY_KEY.get(line.key);
        if (def === undefined || def.kind === 'subtotal') continue;
        const raw = line.values[mi];
        if (raw === null || raw === undefined || raw === 0) continue;
        const v = def.kind === 'revenue' || def.kind === 'financial_income' ? raw : Math.abs(raw);
        push(`linha#${line.rowIndex}#${ym}`, `Linha "${line.rawLabel}"`, Math.round(v * 100) / 100, 'BRL', `Linha ${line.rowIndex + 1} ("${line.rawLabel}") da aba ${statement.sheetName ?? '-'}, ${monthLabel(ym)}`, 'planilha', ym);
      }
    }
    // KPIs
    for (const f of KPI_FIELDS) {
      const v = k[f.key];
      if (typeof v !== 'number') continue;
      push(`kpi#${f.id}#${ym}`, f.label, v, f.unit, `${f.label}, calculado pelo Copilot a partir da DRE de ${monthLabel(ym)}`, 'kpi', ym);
    }
    // Participacao dos grupos de despesa
    for (const g of EXPENSE_GROUP_KEYS) {
      const share = k.participacao_despesas[g];
      if (share === null) continue;
      const label = ACCOUNT_BY_KEY.get(g)?.label ?? g;
      push(`kpi#share_${g}#${ym}`, `Participacao de "${label}" nas despesas`, share, '%', `Participacao do grupo "${label}" no total de despesas operacionais, ${monthLabel(ym)}`, 'kpi', ym);
    }
  }

  if (opts.includeFiscal !== false) {
    for (const f of loadFiscalReference()) {
      push(`fiscal#${f.id}`, f.label, f.value, f.unit, `${f.description} Fonte: ${f.source_url} (${f.vigencia})`, 'fiscal');
    }
  }

  const context: SanitizedContext = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    activeRole: 'owner',
    intent: opts.intent,
    items,
    droppedBecauseOfRole: 0,
    intentScope: 'aggregate',
  };
  return { context, details };
}

/** Fontes no formato que a UI (ChatMessage/ChatBubble) consome. */
export function toUiSources(details: ReadonlyMap<string, SourceDetail>): readonly Record<string, unknown>[] {
  return [...details.values()].map((d) => ({
    id: d.id,
    label: d.label,
    sourceType: d.sourceType,
    period: d.period,
    value: d.value,
    unit: d.unit,
    detail: d.detail,
  }));
}
