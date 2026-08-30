/**
 * type-inferrer.ts — Inferidor de tipos para colunas de planilha.
 *
 * Para cada coluna, analisa uma amostra de valores e infere o tipo semantico
 * mais provavel. Retorna tambem uma funcao de cast que converte string/unknown
 * para o valor tipado.
 *
 * F2-flow-05 / ADR-015 Divergencia 1: nenhum hardcoding por cliente.
 *
 * Tipos suportados:
 *   - currency    : valores monetarios (R$, $, €, ou numero com virgula/ponto)
 *   - date        : ISO 8601, DD/MM/YYYY, MM/YYYY
 *   - percentage  : numero seguido de % ou entre 0-100 com coluna nomeada pct/perc
 *   - number      : numerico puro (inteiro ou float, virgula pt-BR aceita)
 *   - boolean     : sim/nao, true/false, 1/0, s/n
 *   - string      : fallback
 */

export type InferredType = 'currency' | 'date' | 'percentage' | 'number' | 'boolean' | 'string';

export interface CastResult {
  readonly raw: string;
  readonly value: number | string | boolean | Date | null;
  readonly ok: boolean;
}

export interface ColumnTypeInfo {
  readonly type: InferredType;
  readonly cast: (raw: unknown) => CastResult;
}

// ---------------------------------------------------------------------------
// Patterns de deteccao
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = /[R$€£¥]/;
const CURRENCY_VALUE = /^[R$€£¥\s]*[\d.,]+[R$€£¥\s]*$/;
// Numerico pt-BR: aceita virgula como separador decimal e ponto como milhar
const NUMERIC_PTBR = /^-?[\d.]+,\d+$|^-?\d+$/;
const NUMERIC_EN = /^-?[\d,]+\.\d+$|^-?\d+$/;
// Datas
const DATE_ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/;
const DATE_DDMMYYYY = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_MMYYYY = /^\d{2}\/\d{4}$/;
const DATE_YYYYMM = /^\d{4}-\d{2}$/;
// Percentual
const PERCENTAGE_SUFFIX = /^-?[\d.,]+\s*%$/;
// Boolean
const BOOL_TRUE = /^(sim|yes|true|s|1|verdadeiro)$/i;
const BOOL_FALSE = /^(nao|nao|no|false|n|0|falso)$/i;

// ---------------------------------------------------------------------------
// Funcoes de cast por tipo
// ---------------------------------------------------------------------------

function castCurrency(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  // Remove simbolos de moeda e espacos
  const cleaned = s.replace(/[R$€£¥\s]/g, '').trim();
  const normalized = normalizePtBRNumber(cleaned);
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? { raw: s, value: n, ok: true } : { raw: s, value: null, ok: false };
}

function castDate(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  // ISO
  if (DATE_ISO.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? { raw: s, value: null, ok: false }
      : { raw: s, value: d, ok: true };
  }
  // DD/MM/YYYY
  if (DATE_DDMMYYYY.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    if (dd && mm && yyyy) {
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      return Number.isNaN(d.getTime())
        ? { raw: s, value: null, ok: false }
        : { raw: s, value: d, ok: true };
    }
  }
  // MM/YYYY
  if (DATE_MMYYYY.test(s)) {
    const [mm, yyyy] = s.split('/');
    if (mm && yyyy) {
      const d = new Date(`${yyyy}-${mm}-01T00:00:00Z`);
      return Number.isNaN(d.getTime())
        ? { raw: s, value: null, ok: false }
        : { raw: s, value: d, ok: true };
    }
  }
  // YYYY-MM
  if (DATE_YYYYMM.test(s)) {
    const d = new Date(`${s}-01T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? { raw: s, value: null, ok: false }
      : { raw: s, value: d, ok: true };
  }
  return { raw: s, value: null, ok: false };
}

function castPercentage(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  const cleaned = s.replace('%', '').trim();
  const normalized = normalizePtBRNumber(cleaned);
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? { raw: s, value: n, ok: true } : { raw: s, value: null, ok: false };
}

function castNumber(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  const normalized = normalizePtBRNumber(s);
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? { raw: s, value: n, ok: true } : { raw: s, value: null, ok: false };
}

function castBoolean(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  if (BOOL_TRUE.test(s)) return { raw: s, value: true, ok: true };
  if (BOOL_FALSE.test(s)) return { raw: s, value: false, ok: true };
  return { raw: s, value: null, ok: false };
}

function castString(raw: unknown): CastResult {
  const s = String(raw ?? '').trim();
  return { raw: s, value: s, ok: true };
}

/**
 * Converte numero no formato pt-BR (virgula decimal, ponto milhar) para
 * formato EN (ponto decimal) para parseFloat.
 *
 * Exemplos:
 *   "1.500,00" -> "1500.00"   (ponto milhar, virgula decimal)
 *   "1500,00"  -> "1500.00"   (sem ponto milhar, virgula decimal)
 *   "1500.00"  -> "1500.00"   (formato EN — mantido)
 *   "1,500.00" -> "1500.00"   (formato EN com virgula milhar)
 *   "1500"     -> "1500"      (inteiro)
 */
function normalizePtBRNumber(s: string): string {
  const hasDotThenThreeDigitsThenComma = /\d\.\d{3}[,]/.test(s);
  const hasCommaDecimal = /\d,\d/.test(s);
  const hasDotDecimal = /\d\.\d/.test(s);

  if (hasDotThenThreeDigitsThenComma || (hasCommaDecimal && !hasDotDecimal)) {
    // Formato pt-BR: ponto e separador de milhar, virgula e decimal
    // 1.500,00 -> remove pontos -> 1500,00 -> troca virgula por ponto -> 1500.00
    return s.replace(/\./g, '').replace(',', '.');
  }

  if (hasCommaDecimal && hasDotDecimal) {
    // Ambiguidade: 1,500.00 (EN com virgula de milhar) -> remove virgulas
    return s.replace(/,/g, '');
  }

  // Inteiro ou formato EN
  return s.replace(/,/g, '');
}

// ---------------------------------------------------------------------------
// Amostragem e inferencia
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 20;

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s.length === 0 || s === '-' || s.toLowerCase() === 'n/a';
}

function scoreType(values: readonly unknown[]): InferredType {
  const sample = values.slice(0, SAMPLE_SIZE).filter((v) => !isEmpty(v));
  if (sample.length === 0) return 'string';

  let currency = 0;
  let date = 0;
  let percentage = 0;
  let number = 0;
  let boolean_ = 0;

  for (const v of sample) {
    const s = String(v).trim();

    if (PERCENTAGE_SUFFIX.test(s)) {
      percentage++;
      continue;
    }
    if (CURRENCY_SYMBOLS.test(s) && CURRENCY_VALUE.test(s)) {
      currency++;
      continue;
    }
    if (DATE_ISO.test(s) || DATE_DDMMYYYY.test(s) || DATE_MMYYYY.test(s) || DATE_YYYYMM.test(s)) {
      date++;
      continue;
    }
    if (BOOL_TRUE.test(s) || BOOL_FALSE.test(s)) {
      boolean_++;
      continue;
    }
    if (NUMERIC_PTBR.test(s) || NUMERIC_EN.test(s)) {
      number++;
      continue;
    }
  }

  const total = sample.length;
  const threshold = 0.6; // 60% dos valores devem confirmar o tipo

  if (currency / total >= threshold) return 'currency';
  if (date / total >= threshold) return 'date';
  if (percentage / total >= threshold) return 'percentage';
  if (boolean_ / total >= threshold) return 'boolean';
  if (number / total >= threshold) return 'number';

  return 'string';
}

/**
 * Infere tipo de uma coluna a partir de uma amostra de valores da coluna.
 *
 * @param columnValues - Array de valores da coluna (sem o header).
 * @returns ColumnTypeInfo com tipo inferido e funcao de cast.
 */
export function inferColumnType(columnValues: readonly unknown[]): ColumnTypeInfo {
  const type = scoreType(columnValues);
  let cast: (raw: unknown) => CastResult;

  switch (type) {
    case 'currency':
      cast = castCurrency;
      break;
    case 'date':
      cast = castDate;
      break;
    case 'percentage':
      cast = castPercentage;
      break;
    case 'number':
      cast = castNumber;
      break;
    case 'boolean':
      cast = castBoolean;
      break;
    default:
      cast = castString;
  }

  return { type, cast };
}

/**
 * Infere tipos para todas as colunas de uma matriz de dados.
 *
 * @param matrix - Matriz 2D onde matrix[0] sao os headers e matrix[1..] sao os dados.
 * @returns Array de ColumnTypeInfo com um item por coluna.
 */
export function inferAllColumnTypes(matrix: readonly (readonly unknown[])[]): ColumnTypeInfo[] {
  if (matrix.length === 0) return [];
  const headerRow = matrix[0];
  if (!headerRow) return [];
  const colCount = headerRow.length;
  const result: ColumnTypeInfo[] = [];

  for (let col = 0; col < colCount; col++) {
    const columnValues = matrix.slice(1).map((row) => (Array.isArray(row) ? row[col] : undefined));
    result.push(inferColumnType(columnValues));
  }

  return result;
}
