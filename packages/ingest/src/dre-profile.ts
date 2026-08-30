/**
 * dre-profile.ts — Le uma matriz de planilha (contas × meses) e produz a DRE canonica.
 *
 * Passos:
 *   1. Acha a linha de cabecalho: a que tem >= 2 celulas reconhecidas como mes.
 *   2. Acha a coluna de rotulo: a coluna a esquerda com mais texto nao-numerico.
 *   3. Para cada linha abaixo: rotulo → conta canonica (account-detector), valores por mes.
 *   4. Detecta linhas de grupo (valor = soma das N linhas seguintes) para nao contar duas vezes.
 *   5. Soma contas de entrada por mes, calcula subtotais e reconcilia com os subtotais da planilha.
 *
 * Nenhum nome de cliente aqui. Formatos pt-BR de numero e data.
 */

import { detectAccount } from './account-detector.js';
import {
  ACCOUNT_BY_KEY,
  computeSubtotals,
  emptyEntries,
  isSubtotalKey,
  type AccountKey,
  type CanonicalMonth,
  type EntryKey,
} from './dre-model.js';

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export interface DreLine {
  readonly rowIndex: number;
  readonly rawLabel: string;
  readonly key: AccountKey | null;
  readonly confidence: number;
  /** Valor por mes (indice alinhado a `months`); null = celula vazia. */
  readonly values: readonly (number | null)[];
  /** Linha de subtotal (ja calculada na planilha) — nao entra na soma. */
  readonly isSubtotal: boolean;
  /** Linha de grupo cujo valor e a soma das filhas seguintes — nao entra na soma. */
  readonly isGroupHeader: boolean;
  /** Chave herdada do grupo pai quando a linha nao foi reconhecida sozinha. */
  readonly inheritedFrom: string | null;
}

export interface ReconciliationItem {
  readonly key: AccountKey;
  readonly month: string;
  readonly reported: number;
  readonly computed: number;
  readonly diff: number;
}

export interface DreStatement {
  readonly fileName: string;
  readonly sheetName: string | null;
  /** Meses no formato YYYY-MM, na ordem das colunas. */
  readonly months: readonly string[];
  readonly lines: readonly DreLine[];
  /** Valores canonicos por mes (chave = YYYY-MM). */
  readonly canonical: Readonly<Record<string, CanonicalMonth>>;
  readonly reconciliation: readonly ReconciliationItem[];
  readonly warnings: readonly string[];
  readonly summary: {
    readonly months: number;
    readonly linesTotal: number;
    readonly linesMapped: number;
    readonly linesUnmapped: number;
    readonly unmappedLabels: readonly string[];
  };
  readonly importedAt: string;
}

// ---------------------------------------------------------------------------
// Numeros pt-BR / en
// ---------------------------------------------------------------------------

export function parseNumberCell(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (cell instanceof Date) return null;
  let s = String(cell).trim();
  if (s.length === 0) return null;
  if (/^[-–—]+$/.test(s)) return 0; // travessao = zero
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/r\$/i, '').replace(/\s+/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.length === 0 || /[^0-9.,%]/.test(s)) return null;
  s = s.replace(/%$/, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized: string;
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    normalized =
      lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    const tail = parts[parts.length - 1] ?? '';
    normalized = parts.length === 2 && tail.length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    const tail = parts[parts.length - 1] ?? '';
    normalized = parts.length === 2 && tail.length !== 3 ? s : s.replace(/\./g, '');
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

const MONTHS_PT: Readonly<Record<string, number>> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5,
  jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, sep: 9, out: 10,
  outubro: 10, oct: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12, dec: 12, feb: 2, apr: 4,
  may: 5, aug: 8,
};

export interface MonthParse {
  readonly month: number;
  readonly year: number | null;
}

function excelSerialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

export function parseMonthHeader(cell: unknown): MonthParse | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return { month: cell.getUTCMonth() + 1, year: cell.getUTCFullYear() };
  }
  if (typeof cell === 'number') {
    if (cell >= 30000 && cell <= 70000) {
      const d = excelSerialToDate(cell);
      return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
    }
    return null;
  }
  const raw = String(cell)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (raw.length === 0) return null;
  // Rejeita colunas de total/analise
  if (/^(total|acumulado|acum|media|av|ah|%|var|variacao|ytd|ano)\b/.test(raw)) return null;

  let m: RegExpMatchArray | null;
  // 2026-01 | 2026/01
  if ((m = raw.match(/^(\d{4})[-/](\d{1,2})$/))) {
    return { month: Number(m[2]), year: Number(m[1]) };
  }
  // 01/2026 | 1-26 | 01/26
  if ((m = raw.match(/^(\d{1,2})[-/](\d{2,4})$/))) {
    const month = Number(m[1]);
    if (month < 1 || month > 12) return null;
    return { month, year: normalizeYear(Number(m[2])) };
  }
  // 01/01/2026 | 31/01/2026 (data completa) — usa mes/ano
  if ((m = raw.match(/^\d{1,2}[-/](\d{1,2})[-/](\d{2,4})$/))) {
    const month = Number(m[1]);
    if (month < 1 || month > 12) return null;
    return { month, year: normalizeYear(Number(m[2])) };
  }
  // jan/26 | jan-2026 | jan 2026 | janeiro de 2026 | jan
  if ((m = raw.match(/^([a-z]{3,9})\.?(?:[\s/-]+(?:de\s+)?(\d{2,4}))?$/))) {
    const month = MONTHS_PT[m[1] ?? ''];
    if (month === undefined) return null;
    return { month, year: m[2] !== undefined ? normalizeYear(Number(m[2])) : null };
  }
  return null;
}

function normalizeYear(y: number): number {
  if (y < 100) return 2000 + y;
  return y;
}

function ym(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

export interface ParseDreOptions {
  readonly fileName: string;
  readonly sheetName?: string | null;
  /** Ano assumido quando o cabecalho traz so o nome do mes. Default: ano atual. */
  readonly assumedYear?: number;
}

interface HeaderInfo {
  readonly rowIndex: number;
  readonly monthCols: readonly { readonly col: number; readonly ym: string }[];
  readonly labelCol: number;
}

function findHeader(matrix: readonly (readonly unknown[])[], assumedYear: number, warnings: string[]): HeaderInfo | null {
  let best: HeaderInfo | null = null;
  const limit = Math.min(matrix.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? [];
    const parsed: { col: number; p: MonthParse }[] = [];
    for (let c = 0; c < row.length; c++) {
      const p = parseMonthHeader(row[c]);
      if (p !== null) parsed.push({ col: c, p });
    }
    if (parsed.length < 2) continue;
    // Resolve anos ausentes sequencialmente
    let year = parsed[0]?.p.year ?? assumedYear;
    let assumed = false;
    let prevMonth = 0;
    const monthCols = parsed.map(({ col, p }) => {
      if (p.year !== null) {
        year = p.year;
      } else {
        assumed = true;
        if (p.month < prevMonth) year += 1; // virou o ano (dez → jan)
      }
      prevMonth = p.month;
      return { col, ym: ym(year, p.month) };
    });
    if (assumed) warnings.push(`Cabecalho sem ano — assumido ${assumedYear} (ajuste na planilha se estiver errado).`);
    const firstMonthCol = monthCols[0]?.col ?? 0;
    const labelCol = findLabelCol(matrix, r, firstMonthCol);
    const info: HeaderInfo = { rowIndex: r, monthCols, labelCol };
    if (best === null || monthCols.length > best.monthCols.length) best = info;
  }
  return best;
}

function findLabelCol(matrix: readonly (readonly unknown[])[], headerRow: number, firstMonthCol: number): number {
  const scores: number[] = [];
  for (let c = 0; c < Math.max(1, firstMonthCol); c++) {
    let score = 0;
    for (let r = headerRow + 1; r < Math.min(matrix.length, headerRow + 60); r++) {
      const cell = matrix[r]?.[c];
      if (typeof cell === 'string' && cell.trim().length > 0 && parseNumberCell(cell) === null) score++;
    }
    scores[c] = score;
  }
  let bestCol = 0;
  let bestScore = -1;
  scores.forEach((s, c) => {
    if (s > bestScore) {
      bestScore = s;
      bestCol = c;
    }
  });
  return bestCol;
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.0005);
}

/**
 * Marca linhas de grupo: valor da linha i == soma das N linhas seguintes (N >= 2),
 * em todos os meses com valor. Evita contar o grupo e as filhas.
 */
function markGroupHeaders(lines: DreLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.isSubtotal) continue;
    const hasValues = line.values.some((v) => v !== null && v !== 0);
    if (!hasValues) continue;
    for (let n = 2; n <= 25 && i + n < lines.length; n++) {
      const children = lines.slice(i + 1, i + 1 + n);
      if (children.some((c) => c.isSubtotal || c.isGroupHeader)) break;
      let allMatch = true;
      let anyCompared = false;
      for (let m = 0; m < line.values.length; m++) {
        const target = line.values[m];
        if (target === null) continue;
        const sum = children.reduce((acc, c) => acc + (c.values[m] ?? 0), 0);
        anyCompared = true;
        if (!approxEqual(sum, target)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch && anyCompared) {
        lines[i] = { ...line, isGroupHeader: true };
        // A estrutura da planilha manda: toda filha pertence a conta do grupo
        // (ex.: "Vendas delivery" dentro de "Receita Bruta" e receita, nao despesa comercial).
        for (let k = 0; k < children.length; k++) {
          const child = children[k]!;
          if (line.key !== null && child.key !== line.key) {
            lines[i + 1 + k] = {
              ...child,
              key: line.key,
              confidence: child.key === null ? 0.6 : Math.min(child.confidence, 0.9),
              inheritedFrom: line.rawLabel,
            };
          }
        }
        break;
      }
    }
  }
}

export function parseDreMatrix(
  matrix: readonly (readonly unknown[])[],
  options: ParseDreOptions,
): DreStatement {
  const warnings: string[] = [];
  const assumedYear = options.assumedYear ?? new Date().getFullYear();
  const header = findHeader(matrix, assumedYear, warnings);
  if (header === null) {
    throw new Error(
      'Nao encontrei uma linha de cabecalho com meses (ex.: "jan/26", "01/2026", "Janeiro"). ' +
        'A DRE precisa ter as contas nas linhas e os meses nas colunas.',
    );
  }
  const months = header.monthCols.map((m) => m.ym);
  const dupes = months.filter((m, i) => months.indexOf(m) !== i);
  if (dupes.length > 0) warnings.push(`Meses repetidos no cabecalho: ${[...new Set(dupes)].join(', ')}.`);

  const lines: DreLine[] = [];
  for (let r = header.rowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rawLabel = String(row[header.labelCol] ?? '').trim();
    const values = header.monthCols.map((mc) => parseNumberCell(row[mc.col]));
    const hasAnyValue = values.some((v) => v !== null);
    if (rawLabel.length === 0 && !hasAnyValue) continue;
    if (rawLabel.length === 0) continue; // valores sem rotulo — ignorados
    if (!hasAnyValue) continue; // titulo de secao sem numeros
    const match = detectAccount(rawLabel);
    const key = match?.key ?? null;
    const isSubtotal = key !== null && (isSubtotalKey(key) || (match?.looksLikeTotal ?? false));
    lines.push({
      rowIndex: r,
      rawLabel,
      key,
      confidence: match?.confidence ?? 0,
      values,
      isSubtotal,
      isGroupHeader: false,
      inheritedFrom: null,
    });
  }
  markGroupHeaders(lines);

  // Soma por mes
  const canonical: Record<string, CanonicalMonth> = {};
  const reported: Record<string, Partial<Record<AccountKey, number>>> = {};
  months.forEach((month, mi) => {
    const entries = emptyEntries();
    const rep: Partial<Record<AccountKey, number>> = {};
    for (const line of lines) {
      const v = line.values[mi];
      if (v === null || v === undefined || line.key === null) continue;
      if (line.isSubtotal) {
        rep[line.key] = (rep[line.key] ?? 0) + v;
        continue;
      }
      if (line.isGroupHeader) continue;
      const def = ACCOUNT_BY_KEY.get(line.key);
      if (def === undefined || def.kind === 'subtotal') continue;
      const magnitude = def.kind === 'revenue' || def.kind === 'financial_income' ? v : Math.abs(v);
      entries[line.key as EntryKey] += magnitude;
    }
    canonical[month] = computeSubtotals(entries);
    reported[month] = rep;
  });

  // Reconciliacao: subtotal informado na planilha × calculado
  const reconciliation: ReconciliationItem[] = [];
  for (const month of months) {
    const rep = reported[month] ?? {};
    const calc = canonical[month]!;
    for (const key of Object.keys(rep) as AccountKey[]) {
      const reportedValue = rep[key];
      if (reportedValue === undefined) continue;
      const computed = calc[key];
      // subtotais de despesa costumam vir negativos na planilha — compara magnitude quando fizer sentido
      const cmp = key === 'despesas_operacionais' ? Math.abs(reportedValue) : reportedValue;
      if (!approxEqual(computed, cmp)) {
        reconciliation.push({ key, month, reported: cmp, computed, diff: computed - cmp });
      }
    }
  }
  if (reconciliation.length > 0) {
    warnings.push(
      `${reconciliation.length} subtotal(is) da planilha nao batem com o recalculado — veja "reconciliation". ` +
        'Pode haver linha nao classificada ou contada duas vezes.',
    );
  }

  const unmapped = lines.filter((l) => l.key === null);
  const summary = {
    months: months.length,
    linesTotal: lines.length,
    linesMapped: lines.length - unmapped.length,
    linesUnmapped: unmapped.length,
    unmappedLabels: unmapped.map((l) => l.rawLabel),
  };
  if (unmapped.length > 0) {
    warnings.push(`${unmapped.length} linha(s) nao classificada(s) ficaram FORA dos totais: ${summary.unmappedLabels.join('; ')}.`);
  }

  return {
    fileName: options.fileName,
    sheetName: options.sheetName ?? null,
    months,
    lines,
    canonical,
    reconciliation,
    warnings,
    summary,
    importedAt: new Date().toISOString(),
  };
}
