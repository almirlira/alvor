/**
 * dre-model.ts — Modelo canonico da DRE (Demonstracao do Resultado do Exercicio).
 *
 * Contas de ENTRADA (vem da planilha, somadas por mes) e SUBTOTAIS (calculados).
 * Convencao de sinal no canonico: TODO valor e armazenado como magnitude positiva;
 * o sinal e dado pelo `kind` (revenue soma, deduction/cost/expense/tax subtrai).
 * Subtotais e resultados podem ser negativos (prejuizo).
 */

export type EntryKey =
  | 'receita_bruta'
  | 'deducoes'
  | 'cmv'
  | 'despesas_pessoal'
  | 'despesas_administrativas'
  | 'despesas_comerciais'
  | 'despesas_ocupacao'
  | 'despesas_marketing'
  | 'outras_despesas'
  | 'receitas_financeiras'
  | 'despesas_financeiras'
  | 'impostos_resultado';

export type SubtotalKey =
  | 'receita_liquida'
  | 'lucro_bruto'
  | 'despesas_operacionais'
  | 'resultado_operacional'
  | 'resultado_financeiro'
  | 'resultado_antes_impostos'
  | 'resultado_liquido';

export type AccountKey = EntryKey | SubtotalKey;

export type AccountKind =
  | 'revenue'
  | 'deduction'
  | 'cost'
  | 'expense'
  | 'financial_income'
  | 'financial_expense'
  | 'tax'
  | 'subtotal';

export type CostBehavior = 'fixo' | 'variavel' | null;

export interface AccountDef {
  readonly key: AccountKey;
  readonly label: string;
  readonly kind: AccountKind;
  /** Comportamento default do custo (usado no ponto de equilibrio). */
  readonly behavior: CostBehavior;
  /** Ordem de apresentacao na DRE canonica. */
  readonly order: number;
}

export const ACCOUNTS: readonly AccountDef[] = [
  { key: 'receita_bruta', label: 'Receita bruta', kind: 'revenue', behavior: null, order: 10 },
  { key: 'deducoes', label: 'Deducoes e impostos sobre vendas', kind: 'deduction', behavior: 'variavel', order: 20 },
  { key: 'receita_liquida', label: 'Receita liquida', kind: 'subtotal', behavior: null, order: 30 },
  { key: 'cmv', label: 'Custo das mercadorias / servicos (CMV)', kind: 'cost', behavior: 'variavel', order: 40 },
  { key: 'lucro_bruto', label: 'Lucro bruto', kind: 'subtotal', behavior: null, order: 50 },
  { key: 'despesas_pessoal', label: 'Despesas com pessoal', kind: 'expense', behavior: 'fixo', order: 60 },
  { key: 'despesas_administrativas', label: 'Despesas administrativas', kind: 'expense', behavior: 'fixo', order: 61 },
  { key: 'despesas_comerciais', label: 'Despesas comerciais', kind: 'expense', behavior: 'variavel', order: 62 },
  { key: 'despesas_ocupacao', label: 'Ocupacao e utilidades', kind: 'expense', behavior: 'fixo', order: 63 },
  { key: 'despesas_marketing', label: 'Marketing', kind: 'expense', behavior: 'fixo', order: 64 },
  { key: 'outras_despesas', label: 'Outras despesas operacionais', kind: 'expense', behavior: 'fixo', order: 65 },
  { key: 'despesas_operacionais', label: 'Total de despesas operacionais', kind: 'subtotal', behavior: null, order: 70 },
  { key: 'resultado_operacional', label: 'Resultado operacional', kind: 'subtotal', behavior: null, order: 80 },
  { key: 'receitas_financeiras', label: 'Receitas financeiras', kind: 'financial_income', behavior: null, order: 90 },
  { key: 'despesas_financeiras', label: 'Despesas financeiras', kind: 'financial_expense', behavior: 'fixo', order: 91 },
  { key: 'resultado_financeiro', label: 'Resultado financeiro', kind: 'subtotal', behavior: null, order: 95 },
  { key: 'resultado_antes_impostos', label: 'Resultado antes dos impostos', kind: 'subtotal', behavior: null, order: 100 },
  { key: 'impostos_resultado', label: 'IRPJ / CSLL', kind: 'tax', behavior: null, order: 110 },
  { key: 'resultado_liquido', label: 'Resultado liquido', kind: 'subtotal', behavior: null, order: 120 },
];

export const ACCOUNT_BY_KEY: ReadonlyMap<AccountKey, AccountDef> = new Map(
  ACCOUNTS.map((a) => [a.key, a]),
);

export const ENTRY_KEYS: readonly EntryKey[] = ACCOUNTS.filter((a) => a.kind !== 'subtotal').map(
  (a) => a.key as EntryKey,
);

export const EXPENSE_GROUP_KEYS: readonly EntryKey[] = [
  'despesas_pessoal',
  'despesas_administrativas',
  'despesas_comerciais',
  'despesas_ocupacao',
  'despesas_marketing',
  'outras_despesas',
];

export function isSubtotalKey(key: AccountKey): key is SubtotalKey {
  return ACCOUNT_BY_KEY.get(key)?.kind === 'subtotal';
}

/** Valores canonicos de um mes: toda chave presente (0 quando ausente). */
export type CanonicalMonth = Readonly<Record<AccountKey, number>>;

/**
 * Calcula os subtotais a partir das contas de entrada (magnitudes positivas).
 */
export function computeSubtotals(entries: Readonly<Record<EntryKey, number>>): CanonicalMonth {
  const receita_liquida = entries.receita_bruta - entries.deducoes;
  const lucro_bruto = receita_liquida - entries.cmv;
  const despesas_operacionais = EXPENSE_GROUP_KEYS.reduce((acc, k) => acc + entries[k], 0);
  const resultado_operacional = lucro_bruto - despesas_operacionais;
  const resultado_financeiro = entries.receitas_financeiras - entries.despesas_financeiras;
  const resultado_antes_impostos = resultado_operacional + resultado_financeiro;
  const resultado_liquido = resultado_antes_impostos - entries.impostos_resultado;
  return {
    ...entries,
    receita_liquida,
    lucro_bruto,
    despesas_operacionais,
    resultado_operacional,
    resultado_financeiro,
    resultado_antes_impostos,
    resultado_liquido,
  };
}

export function emptyEntries(): Record<EntryKey, number> {
  const out = {} as Record<EntryKey, number>;
  for (const k of ENTRY_KEYS) out[k] = 0;
  return out;
}
