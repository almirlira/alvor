/**
 * dre-reader.ts — Buffer (XLSX/CSV) → DreStatement + KPIs.
 *
 * Escolha da aba: nome que bate /dre|resultado|demonstra/i; senao a primeira
 * aba em que o parser encontra um cabecalho de meses.
 * SheetJS com formulas desligadas (mesma politica do CROSS, C-016-03).
 */

import { parseDreMatrix, type DreStatement } from './dre-profile.js';
import { computeMonthKpis, type MonthKpis } from './dre-kpis.js';

export interface DreImport {
  readonly statement: DreStatement;
  readonly kpis: readonly MonthKpis[];
}

interface XlsxModule {
  read(data: Buffer | string, opts: Record<string, unknown>): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json<T = unknown>(sheet: unknown, opts?: Record<string, unknown>): T[];
  };
}

async function loadXlsx(): Promise<XlsxModule> {
  const mod = (await import('xlsx')) as unknown as XlsxModule & { default?: XlsxModule };
  return mod.default ?? mod;
}

export interface ReadDreOptions {
  readonly fileName: string;
  readonly assumedYear?: number;
}

export async function readDreFromBuffer(buffer: Buffer, options: ReadDreOptions): Promise<DreImport> {
  const XLSX = await loadXlsx();
  const isCsv = /\.csv$/i.test(options.fileName);
  const workbook = isCsv
    ? XLSX.read(buffer.toString('utf-8'), { type: 'string', cellFormula: false, cellHTML: false, cellNF: false, cellDates: true })
    : XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellNF: false, cellDates: true });

  const preferred = workbook.SheetNames.filter((n) => /dre|resultado|demonstra/i.test(n));
  const order = [...preferred, ...workbook.SheetNames.filter((n) => !preferred.includes(n))];

  const errors: string[] = [];
  for (const sheetName of order) {
    const sheet = workbook.Sheets[sheetName];
    if (sheet === undefined) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    try {
      const statement = parseDreMatrix(matrix, {
        fileName: options.fileName,
        sheetName,
        ...(options.assumedYear !== undefined ? { assumedYear: options.assumedYear } : {}),
      });
      return { statement, kpis: computeMonthKpis(statement) };
    } catch (err) {
      errors.push(`${sheetName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Nenhuma aba pode ser lida como DRE. ${errors.join(' | ')}`);
}
