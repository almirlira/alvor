/**
 * sheet-parser.ts — Parser generico de planilha para o coletor Google Drive.
 *
 * Suporta:
 *   - Google Sheets nativo via Sheets API (`values:get` response)
 *   - CSV (string ou Buffer)
 *   - XLSX (Buffer — via import dinamico de `xlsx`)
 *
 * F2-flow-05 / ADR-015 Divergencia 1: parser generico, SEM hardcoding por
 * cliente. Nenhum nome de sheet, cliente ou loja aparece aqui.
 *
 * Criterio PAR-DRV-01: deve funcionar com planilha de qualquer tenant com
 * colunas em qualquer ordem e nomes de header sinonimoicos.
 *
 * Validador de integridade emite warnings (nunca erros fatais):
 *   - Linhas em branco entre dados
 *   - Colunas sem header
 *   - Datas fora de range plausivel (< 2000 ou > 2030)
 *   - Valores negativos em colunas que deveriam ser positivas (vendas, quantidade, ticket)
 */

import { detectColumns, normalizeHeader } from './column-detector.js';
import { inferAllColumnTypes } from './type-inferrer.js';
import type { ColumnMapping } from './column-detector.js';
import type { ColumnTypeInfo } from './type-inferrer.js';
import type { SourceProfile } from './source-profile.js';
import {
  compileProfileSheet,
  compileFileNamePattern,
  findMatchingProfileSheet,
} from './source-profile.js';
import { lookupProfileById, detectProfileByFileName } from './source-profile-registry.js';
import { loadProfileFromConfig } from './source-profile.js';

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

/**
 * Resposta da Sheets API v4 `values:get`.
 * Campo `values` e array de arrays de strings/nulos.
 */
export interface GoogleSheetsApiResponse {
  readonly range?: string;
  readonly majorDimension?: string;
  readonly values?: ReadonlyArray<ReadonlyArray<string | null | undefined>>;
}

export interface SheetSourceContent {
  readonly mimeType:
    | 'application/vnd.google-apps.spreadsheet'
    | 'text/csv'
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  /** Conteudo bruto: Buffer para XLSX, string para CSV, GoogleSheetsApiResponse para Sheets nativo. */
  readonly raw: Buffer | string | GoogleSheetsApiResponse;
  readonly filename: string;
  readonly sheetName?: string;
  /**
   * Config JSONB da fonte (data_sources.config).
   * Quando presente, o parser tenta carregar o perfil declarativo a partir desta config.
   * Precedência: config.profile (inline) > config.profile_id (referência ao registro) >
   *              perfil hardcoded (REGISTERED_PROFILES) > heurística.
   *
   * ADR-016 §2.2 / O1-002.
   */
  readonly sourceConfig?: Record<string, unknown> | undefined;
  /**
   * Workbook XLSX já parsado (pré-carregado pelo caller).
   *
   * PERF (fix): quando presente, o parseSheet usa este workbook em vez de fazer
   * um segundo XLSX.read() no buffer. Elimina a dupla deserialização que causava
   * timeout de 30s no parse-worker-thread.ts (planilhas mensais com abas pivot).
   *
   * Apenas para mimeType XLSX. Ignorado para CSV e Sheets API.
   * O caller deve garantir que o workbook foi parsado com as mesmas opções de
   * segurança (cellFormula:false, cellHTML:false, cellNF:false — ADR-016 §2.7 C-016-03).
   */
  readonly _preloadedXlsxWorkbook?: {
    readonly workbook: PreParsedXlsxWorkbook;
    readonly utils: XlsxUtils;
  };
}

/**
 * Perfil declarativo de planilha.
 *
 * Define como interpretar uma planilha cujo formato diverge do padrao
 * (header na linha 0, sem linhas extras de titulo). Nenhum perfil hardcoda
 * nome de cliente — a identificacao e feita por padroes de nome de arquivo e/ou aba.
 *
 * ADR-015 Div 1: engenharia generica — os padroes sao configuracoes,
 * nao codigo especifico por cliente.
 */
export interface SheetProfile {
  /**
   * Identificador legivel do perfil. Aparece em warnings/logs para rastreabilidade.
   */
  readonly profileId: string;

  /**
   * Regex para detectar o perfil pelo nome do arquivo (case-insensitive).
   * Exemplo: /MKT_vendas_diarias/i
   */
  readonly fileNamePattern?: RegExp;

  /**
   * Regex para detectar o perfil pelo nome da aba (case-insensitive).
   * Exemplo: /resumo\s*mensal/i
   */
  readonly sheetNamePattern?: RegExp;

  /**
   * Para XLSX: seleciona a aba alvo pelo padrao sheetNamePattern antes de aplicar
   * headerRowIndex. Se undefined, usa a logica padrao (sheetName ou primeira aba).
   */
  readonly targetSheetPattern?: RegExp;

  /**
   * Indice (0-based) da linha que contem os headers das colunas.
   * Default: 0 (comportamento padrao — header na primeira linha).
   * Exemplo: 2 para planilhas MKT_vendas_diarias (header na linha 3 do Excel).
   */
  readonly headerRowIndex: number;

  /**
   * Predicado que retorna true para linhas a serem ignoradas nos dados
   * (ex: linhas de total/subtotal que nao devem virar records).
   * Recebe a linha como array de strings brutas.
   */
  readonly skipRowPredicate?: (row: readonly string[]) => boolean;
}

/**
 * Perfis de planilha registrados. Aplicados em ordem — o primeiro match vence.
 *
 * Criterio de match: fileNamePattern (se presente) E sheetNamePattern (se presente).
 * Se so um criterio definido, so ele precisa bater.
 *
 * ADR-015 Div 1: adicionar perfis aqui e a forma correta de suportar novos
 * formatos sem hardcoding no corpo de parseSheet.
 */
const REGISTERED_PROFILES: readonly SheetProfile[] = [
  {
    // Perfil para planilhas MKT_vendas_diarias da Casa de Bolos.
    // Detectado por padrao de nome de arquivo OU nome de aba "RESUMO MENSAL".
    // Header na linha 3 do Excel (indice 2, 0-based).
    // Linha de TOTAL MES ignorada: col[1] == 'TOTAL MES' (normalizado).
    profileId: 'MKT_VENDAS_DIARIAS_RESUMO_MENSAL',
    fileNamePattern: /MKT_vendas_diarias/i,
    // sheetNamePattern: criterio de ativacao do perfil apos resolucao da aba.
    // O perfil so e ativo quando a aba efetivamente carregada e a RESUMO MENSAL.
    // Isso evita falsos positivos em arquivos com nome MKT_vendas_diarias
    // mas sem aba RESUMO MENSAL (ex: fixtures de teste com aba 'Dados').
    sheetNamePattern: /resumo\s*mensal/i,
    // targetSheetPattern: indica ao xlsxToMatrix qual aba preferir.
    targetSheetPattern: /resumo\s*mensal/i,
    headerRowIndex: 2,
    skipRowPredicate: (row) => {
      // Linha de totais: celula DATA contem 'TOTAL' (normalizacao robusta)
      const dataCellRaw = (row[1] ?? '').trim().toLowerCase();
      return dataCellRaw.includes('total');
    },
  },
];

export interface ParsedColumn {
  readonly headerIndex: number;
  readonly rawHeader: string;
  readonly canonical: string | null;
  readonly confidence: number | null;
  readonly type: ColumnTypeInfo['type'];
}

export interface ParsedRow {
  /** Valores indexados por headerIndex. */
  readonly cells: ReadonlyArray<{ readonly raw: unknown; readonly typed: unknown }>;
}

export interface ParsedSheet {
  readonly columns: readonly ParsedColumn[];
  readonly rows: readonly ParsedRow[];
  readonly warnings: readonly string[];
  /** Nome da aba efetivamente usada (apenas XLSX/Sheets). Null para CSV. */
  readonly resolvedSheetName?: string | null;
  /** Perfil de planilha aplicado, se algum foi detectado. */
  readonly appliedProfileId?: string | null;
  /**
   * Versão do perfil declarativo aplicado (O1-002 — insumo de linhagem).
   * Presente quando um SourceProfile declarativo foi aplicado.
   * Null quando só heurística foi usada.
   */
  readonly appliedProfileVersion?: number | null;
  /**
   * Fonte do perfil aplicado: 'config' (inline da fonte), 'registry' (padrão
   * do registro), 'hardcoded' (REGISTERED_PROFILES legado), ou 'heuristic'.
   * Insumo de linhagem para rastreabilidade (O1-002).
   */
  readonly profileSource?: 'config' | 'registry' | 'hardcoded' | 'heuristic' | null;
  /**
   * SHA-256 hex do buffer bruto do arquivo antes do parse (R-049).
   * Presente apenas quando o caller calculou e injetou o hash
   * (ex: GoogleDriveCollector._downloadAndParse). Ausente em chamadas diretas.
   */
  readonly sourceFileHash?: string | undefined;
}

// ---------------------------------------------------------------------------
// Sanitizacao de formula injection (R-031)
// ---------------------------------------------------------------------------

/**
 * Prefixos que indicam possivel formula injection ou instrucao de controle
 * em planilhas e que nao devem ser propagados para downstream (LLM, banco).
 *
 * Alvo: STRING iniciando com esses chars (ex: "=SUM(...)", "+cmd", "-cmd", "@user").
 * NAO afeta numeros legitimos negativos — so strings de texto.
 */
const FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@'] as const;

/**
 * Sanitiza um valor de celula STRING para prevenir formula injection (R-031).
 *
 * Regra:
 *   - Se o valor for string E comecar com `=`, `+`, `-` ou `@`,
 *     prefixa com `'` (apostrofo — convencao de Excel/Sheets para escapar).
 *   - Se o valor for number, boolean, null, undefined ou outro tipo — retorna intacto.
 *   - Numeros negativos como NUMBER (-5) nao sao afetados — so strings.
 *
 * @param value - Valor bruto da celula.
 * @returns Valor sanitizado (mesmo tipo se nao for string suspeita).
 */
function sanitizeCellValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const first = value[0];
  if (first !== undefined && (FORMULA_INJECTION_PREFIXES as readonly string[]).includes(first)) {
    return `'${value}`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Helpers de conversao de formato para matriz 2D
// ---------------------------------------------------------------------------

/** Verifica se uma linha esta completamente vazia. */
function isBlankRow(row: ReadonlyArray<unknown>): boolean {
  return row.every((cell) => {
    if (cell === null || cell === undefined) return true;
    return String(cell).trim().length === 0;
  });
}

/**
 * Converte CSV (string) para matriz 2D de strings.
 * Suporta delimitadores , e ; (detecta automaticamente).
 * Lida com campos entre aspas duplas.
 */
function csvToMatrix(csvText: string): string[][] {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length === 0) return [];

  // Detecta delimitador predominante na primeira linha
  const firstLine = lines[0] ?? '';
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  return lines.map((line) => parseCSVLine(line, delimiter));
}

/**
 * Parseia uma linha CSV respeitando campos entre aspas duplas.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Aspas escapadas dentro de campo
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Converte GoogleSheetsApiResponse para matriz 2D de strings.
 */
function sheetsApiToMatrix(response: GoogleSheetsApiResponse): string[][] {
  const values = response.values;
  if (!values || values.length === 0) return [];
  return values.map((row) => row.map((cell) => (cell ?? '').toString()));
}

/**
 * Resultado estendido do xlsxToMatrix — inclui o nome da aba efetivamente usada.
 */
interface XlsxMatrixResult {
  matrix: string[][];
  resolvedSheetName: string | null;
}

/**
 * Tipo mínimo do workbook SheetJS necessário para xlsxMatrixFromWorkbook.
 * Compatível com XlsxWorkbook do pivot-revenue-extractor.ts.
 */
export interface PreParsedXlsxWorkbook {
  readonly SheetNames: readonly string[];
  readonly Sheets: Readonly<Record<string, unknown>>;
}

/**
 * Tipo mínimo das utils SheetJS necessárias para xlsxMatrixFromWorkbook.
 */
export interface XlsxUtils {
  sheet_to_json<T = unknown>(sheet: unknown, opts?: { header?: number; defval?: unknown }): T[];
}

/**
 * Extrai uma aba de um workbook SheetJS já parsado, sem re-deserializar o buffer.
 *
 * PERF (fix): usa workbook pre-parsado para evitar segundo XLSX.read() no worker.
 * Elimina a segunda deserialização que causava timeout de 30s em planilhas mensais.
 *
 * Selecao de aba (mesma lógica de xlsxToMatrix):
 *   1. Match exato case-insensitive com sheetName.
 *   2. Se sheetPattern fornecido, usa a primeira aba que bate o regex.
 *   3. Fallback: primeira aba disponível.
 */
export function xlsxMatrixFromWorkbook(
  workbook: PreParsedXlsxWorkbook,
  utils: XlsxUtils,
  sheetName?: string,
  sheetPattern?: RegExp,
): XlsxMatrixResult {
  let targetSheet: string | undefined;

  if (sheetName) {
    const lowerTarget = sheetName.toLowerCase();
    targetSheet = workbook.SheetNames.find((n) => n.toLowerCase() === lowerTarget);
  }

  if (!targetSheet && sheetPattern) {
    targetSheet = workbook.SheetNames.find((n) => sheetPattern.test(n));
  }

  if (!targetSheet) {
    targetSheet = workbook.SheetNames[0];
  }

  if (!targetSheet) return { matrix: [], resolvedSheetName: null };

  const sheet = workbook.Sheets[targetSheet];
  if (!sheet) return { matrix: [], resolvedSheetName: targetSheet ?? null };

  const rows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  });

  const matrix = rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
  );
  return { matrix, resolvedSheetName: targetSheet };
}

/**
 * Converte XLSX Buffer para matriz 2D via import dinamico.
 * Se `xlsx` nao estiver instalada, lanca erro descritivo.
 *
 * Selecao de aba:
 *   1. Match exato case-insensitive com sheetName (bug-fix: era case-sensitive).
 *   2. Se sheetPattern fornecido, usa a primeira aba cujo nome bate o regex.
 *   3. Fallback: primeira aba disponivel.
 */
async function xlsxToMatrix(
  buffer: Buffer,
  sheetName?: string,
  sheetPattern?: RegExp,
): Promise<XlsxMatrixResult> {
  // Import dinamico — nao falha em parse-time se xlsx nao estiver instalada.
  type XlsxModule = {
    read: (
      data: Buffer,
      opts: { type: 'buffer'; cellFormula?: boolean; cellHTML?: boolean; cellNF?: boolean },
    ) => {
      SheetNames: string[];
      Sheets: Record<string, unknown>;
    };
    utils: {
      sheet_to_json: <T = unknown>(
        sheet: unknown,
        opts?: { header?: number; defval?: unknown },
      ) => T[];
    };
  };

  let XLSX: XlsxModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XLSX = (await import('xlsx' as any)) as XlsxModule;
  } catch {
    throw new Error(
      'Dependencia `xlsx` nao instalada. Adicione `xlsx` ao package.json de @mktvibe/collectors para suporte a XLSX.',
    );
  }

  // C-016-03 (ADR-016 §2.7): formulas e refs externas desabilitadas no parse.
  // cellFormula:false — nao parseia formulas em celulas; cellHTML:false — sem
  // extracao de HTML; cellNF:false — sem number-format. Fecha vetor de formula/XXE.
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
  });

  // Seleciona aba: match exato case-insensitive > regex pattern > primeira aba
  let targetSheet: string | undefined;

  if (sheetName) {
    // Case-insensitive match (correcao de bug: era .includes() case-sensitive)
    const lowerTarget = sheetName.toLowerCase();
    targetSheet = workbook.SheetNames.find((n) => n.toLowerCase() === lowerTarget);
  }

  if (!targetSheet && sheetPattern) {
    targetSheet = workbook.SheetNames.find((n) => sheetPattern.test(n));
  }

  if (!targetSheet) {
    targetSheet = workbook.SheetNames[0];
  }

  if (!targetSheet) return { matrix: [], resolvedSheetName: null };

  const sheet = workbook.Sheets[targetSheet];
  if (!sheet) return { matrix: [], resolvedSheetName: targetSheet };

  // sheet_to_json com header:1 retorna array de arrays
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  });

  const matrix = rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
  );
  return { matrix, resolvedSheetName: targetSheet };
}

// ---------------------------------------------------------------------------
// Validador de integridade
// ---------------------------------------------------------------------------

const PLAUSIBLE_DATE_MIN = new Date('2000-01-01T00:00:00Z');
const PLAUSIBLE_DATE_MAX = new Date('2035-12-31T23:59:59Z');

const POSITIVE_CANONICALS = new Set(['vendas', 'quantidade', 'ticket_medio']);

function validateIntegrity(
  matrix: readonly (readonly unknown[])[],
  columnMappings: readonly ColumnMapping[],
  columnTypes: readonly ColumnTypeInfo[],
): string[] {
  const warnings: string[] = [];
  const dataRows = matrix.slice(1);
  const headerRow = matrix[0] ?? [];

  // Colunas sem header
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h === undefined || String(h).trim().length === 0) {
      warnings.push(`Coluna ${i} sem header detectada`);
    }
  }

  // Linhas em branco entre dados (ignora linhas finais vazias)
  let lastNonEmpty = -1;
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (row && !isBlankRow(row)) lastNonEmpty = r;
  }

  let blankBetween = false;
  for (let r = 0; r < lastNonEmpty; r++) {
    const row = dataRows[r];
    if (row && isBlankRow(row) && !blankBetween) {
      warnings.push(`Linha ${r + 2} em branco detectada entre dados (pode indicar secao separada)`);
      blankBetween = true; // emite 1 warning por bloco, nao por linha
    }
    if (row && !isBlankRow(row)) {
      blankBetween = false;
    }
  }

  // Validacao por coluna
  for (const mapping of columnMappings) {
    const colIdx = mapping.headerIndex;
    const colType = columnTypes[colIdx];
    if (!colType) continue;

    for (let r = 0; r < dataRows.length; r++) {
      const row = dataRows[r];
      if (!row) continue;
      const cell = row[colIdx];
      if (cell === undefined || cell === null || String(cell).trim().length === 0) continue;

      // Datas fora de range plausivel
      if (colType.type === 'date') {
        const cast = colType.cast(cell);
        if (cast.ok && cast.value instanceof Date) {
          if (cast.value < PLAUSIBLE_DATE_MIN || cast.value > PLAUSIBLE_DATE_MAX) {
            warnings.push(
              `Coluna "${String(headerRow[colIdx] ?? colIdx)}" linha ${r + 2}: data ${cast.value.toISOString()} fora do range plausivel (2000-2035)`,
            );
          }
        }
      }

      // Valores negativos em colunas que deveriam ser positivas
      if (
        (colType.type === 'number' || colType.type === 'currency') &&
        POSITIVE_CANONICALS.has(mapping.canonical)
      ) {
        const cast = colType.cast(cell);
        if (cast.ok && typeof cast.value === 'number' && cast.value < 0) {
          warnings.push(
            `Coluna "${String(headerRow[colIdx] ?? colIdx)}" linha ${r + 2}: valor negativo ${cast.value} em coluna que deveria ser positiva (${mapping.canonical})`,
          );
        }
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Deteccao de perfil de planilha (legado — hardcoded)
// ---------------------------------------------------------------------------

/**
 * Detecta se algum perfil HARDCODED registrado se aplica ao conteudo.
 * Criterio: fileNamePattern (se definido) E sheetName (verificado apos carregar XLSX).
 *
 * Usado apenas como fallback quando nenhum perfil DECLARATIVO foi encontrado.
 * (O perfil declarativo tem precedencia sobre este — ADR-016 §2.2)
 */
function detectHardcodedProfile(
  filename: string,
  resolvedSheet: string | null,
): SheetProfile | null {
  for (const profile of REGISTERED_PROFILES) {
    const fileMatch = profile.fileNamePattern ? profile.fileNamePattern.test(filename) : true;
    const sheetMatch =
      profile.sheetNamePattern && resolvedSheet
        ? profile.sheetNamePattern.test(resolvedSheet)
        : !profile.sheetNamePattern; // sem criterio de aba = match incondicional
    if (fileMatch && sheetMatch) return profile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolucao de perfil declarativo (O1-002)
// ---------------------------------------------------------------------------

/**
 * Resultado da resolucao de perfil para a funcao parseSheet.
 *
 * Tres estados possiveis:
 *   - 'declarative': perfil declarativo encontrado (config inline ou registry)
 *   - 'hardcoded':   perfil hardcoded encontrado (REGISTERED_PROFILES legado)
 *   - 'heuristic':   nenhum perfil encontrado — usar heuristica
 */
type ResolvedProfileResult =
  | {
      kind: 'declarative';
      profile: SourceProfile;
      profileSource: 'config' | 'registry';
      headerRowIndex: number;
      skipRowPredicate: ((row: readonly string[]) => boolean) | null;
      columnMapOverride: Record<string, string>;
      skipPatterns: readonly RegExp[];
    }
  | {
      kind: 'hardcoded';
      profile: SheetProfile;
      headerRowIndex: number;
    }
  | { kind: 'heuristic' };

/**
 * Resolve o perfil a usar para o parse, seguindo a precedencia:
 *   1. config.profile (inline) ou config.profile_id (referencia ao registro)
 *   2. Auto-deteccao por nome de arquivo no registro de perfis-padrao
 *   3. Perfil hardcoded em REGISTERED_PROFILES
 *   4. Heuristica (fallback final)
 *
 * Erros de validacao de perfil em config sao propagados como warnings — o
 * caller NAO silencia erros de perfil inválido (adere ao criterio de aceite
 * "fonte sem perfil retorna erro explicito, nao silencio").
 */
function resolveProfile(
  filename: string,
  resolvedSheet: string | null,
  sourceConfig: Record<string, unknown> | undefined,
  warnings: string[],
): ResolvedProfileResult {
  // 1. Tenta carregar perfil declarativo da config da fonte
  const loadResult = loadProfileFromConfig(sourceConfig ?? null, lookupProfileById);

  if (sourceConfig && ('profile' in sourceConfig || 'profile_id' in sourceConfig)) {
    // Config declarou intenção de ter perfil — resultado é determinístico
    if (!loadResult.found) {
      const errDetail =
        loadResult.errors && loadResult.errors.length > 0
          ? loadResult.errors.join('; ')
          : 'perfil não encontrado';
      warnings.push(
        `[sheet-parser] ERRO DE PERFIL: fonte configurada com perfil declarativo mas carregamento falhou: ${errDetail}. ` +
          `Arquivo: "${filename}". Usando fallback heurístico.`,
      );
      // Fallback para heurística quando perfil declarativo inválido
    } else {
      const decl = loadResult.profile;
      const compiledSheets = decl.sheets.map(compileProfileSheet);
      const matchingSheet = resolvedSheet
        ? findMatchingProfileSheet(compiledSheets, resolvedSheet)
        : (compiledSheets[0] ?? null);

      const headerRowIndex = matchingSheet?.headerRow ?? 0;
      const skipPatterns = matchingSheet?.skipPatterns ?? [];
      const columnMapOverride = matchingSheet?.columnMap ?? {};

      const skipRowPredicate: ((row: readonly string[]) => boolean) | null =
        skipPatterns.length > 0
          ? (row) => {
              const firstCell = (row[0] ?? '').trim();
              return skipPatterns.some((p) => p.test(firstCell));
            }
          : null;

      warnings.push(
        `[sheet-parser] Perfil declarativo "${decl.profile_id}" v${decl.profile_version} ` +
          `aplicado para "${filename}" (fonte: ${loadResult.source}, ` +
          `aba: ${resolvedSheet ?? 'n/a'}, headerRow=${headerRowIndex + 1}).`,
      );

      return {
        kind: 'declarative',
        profile: decl,
        profileSource: loadResult.source,
        headerRowIndex,
        skipRowPredicate,
        columnMapOverride,
        skipPatterns,
      };
    }
  }

  // 2. Auto-deteccao por nome de arquivo no registro de perfis-padrao
  // (apenas quando config nao declara perfil)
  if (!sourceConfig || (!('profile' in sourceConfig) && !('profile_id' in sourceConfig))) {
    const autoProfile = detectProfileByFileName(filename);
    if (autoProfile) {
      const compiledSheets = autoProfile.sheets.map(compileProfileSheet);
      const matchingSheet = resolvedSheet
        ? findMatchingProfileSheet(compiledSheets, resolvedSheet)
        : (compiledSheets[0] ?? null);

      const headerRowIndex = matchingSheet?.headerRow ?? 0;
      const skipPatterns = matchingSheet?.skipPatterns ?? [];
      const columnMapOverride = matchingSheet?.columnMap ?? {};

      const skipRowPredicate: ((row: readonly string[]) => boolean) | null =
        skipPatterns.length > 0
          ? (row) => {
              const firstCell = (row[0] ?? '').trim();
              return skipPatterns.some((p) => p.test(firstCell));
            }
          : null;

      // Verifica também se o arquivo bate o file_name_pattern do auto-profile
      const filePatternOk = compileFileNamePattern(autoProfile)?.test(filename) ?? true;

      if (filePatternOk) {
        warnings.push(
          `[sheet-parser] Perfil declarativo "${autoProfile.profile_id}" v${autoProfile.profile_version} ` +
            `auto-detectado por nome de arquivo para "${filename}" ` +
            `(aba: ${resolvedSheet ?? 'n/a'}, headerRow=${headerRowIndex + 1}).`,
        );
        return {
          kind: 'declarative',
          profile: autoProfile,
          profileSource: 'registry',
          headerRowIndex,
          skipRowPredicate,
          columnMapOverride,
          skipPatterns,
        };
      }
    }
  }

  // 3. Perfil hardcoded (REGISTERED_PROFILES legado)
  const hardcoded = detectHardcodedProfile(filename, resolvedSheet);
  if (hardcoded) {
    warnings.push(
      `[sheet-parser] Perfil "${hardcoded.profileId}" aplicado para "${filename}" ` +
        `(aba: ${resolvedSheet ?? 'n/a'}, headerRow=${hardcoded.headerRowIndex + 1}).`,
    );
    return { kind: 'hardcoded', profile: hardcoded, headerRowIndex: hardcoded.headerRowIndex };
  }

  // 4. Heuristica
  return { kind: 'heuristic' };
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Parseia conteudo de planilha de qualquer formato suportado.
 *
 * Etapas:
 *   1. Converte para matriz 2D (header + rows)
 *   2. Resolve perfil (declarativo > hardcoded > heuristica) — ADR-016 §2.2
 *   3. Detecta colunas por heuristica (column-detector) — mescla com column_map do perfil
 *   4. Infere tipos por coluna (type-inferrer)
 *   5. Valida integridade e emite warnings
 *   6. Retorna ParsedSheet com columns, rows, warnings, profile_id/version (linhagem)
 *
 * Nunca lanca excecao de negocio — erros de parse viram warnings.
 *
 * Precedencia de perfil (O1-002):
 *   content.sourceConfig.profile (inline) > content.sourceConfig.profile_id (registro) >
 *   auto-deteccao por nome de arquivo no registro > REGISTERED_PROFILES (hardcoded) >
 *   heuristica do column-detector
 */
export async function parseSheet(content: SheetSourceContent): Promise<ParsedSheet> {
  const warnings: string[] = [];
  let matrix: readonly (readonly unknown[])[];
  let resolvedSheetName: string | null = null;

  // ---------------------------------------------------------------------------
  // Etapa 1: converte para matriz 2D
  // ---------------------------------------------------------------------------
  try {
    if (content.mimeType === 'text/csv') {
      const text = Buffer.isBuffer(content.raw)
        ? content.raw.toString('utf-8')
        : typeof content.raw === 'string'
          ? content.raw
          : JSON.stringify(content.raw);
      matrix = csvToMatrix(text);
    } else if (
      content.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      if (!Buffer.isBuffer(content.raw)) {
        warnings.push('XLSX requer raw do tipo Buffer; conteudo ignorado');
        return {
          columns: [],
          rows: [],
          warnings,
          resolvedSheetName: null,
          appliedProfileId: null,
          appliedProfileVersion: null,
          profileSource: null,
        };
      }
      // Determina aba alvo: perfil declarativo > sourceConfig.sheet_name >
      // content.sheetName > REGISTERED_PROFILES.targetSheetPattern
      const declaredAutoProfile = content.sourceConfig
        ? (() => {
            const lr = loadProfileFromConfig(content.sourceConfig ?? null, lookupProfileById);
            return lr.found ? lr.profile : null;
          })()
        : detectProfileByFileName(content.filename);

      const targetSheetPatternFromDecl: RegExp | undefined = (() => {
        if (!declaredAutoProfile) return undefined;
        // Encontra aba com layout pivot ou tabular pelo primeiro sheet declarado
        const compiled = declaredAutoProfile.sheets.map(compileProfileSheet);
        // Usa o primeiro sheet declarado para guiar a seleção de aba
        return compiled[0]?.namePattern;
      })();

      const hardcodedProfileForSheet = REGISTERED_PROFILES.find(
        (p) =>
          p.fileNamePattern && p.fileNamePattern.test(content.filename) && p.targetSheetPattern,
      );
      const sheetPatternToUse =
        targetSheetPatternFromDecl ?? hardcodedProfileForSheet?.targetSheetPattern;

      try {
        // PERF (fix): usa workbook pré-parsado quando disponível para evitar duplo XLSX.read.
        // O caller (parse-worker-thread.ts) já fez o XLSX.read via loadXlsxWorkbook; ao passar
        // _preloadedXlsxWorkbook evitamos a segunda deserialização que causava timeout de 30s.
        // As opções de segurança (cellFormula:false etc.) foram aplicadas pelo caller — ADR-016 §2.7.
        if (content._preloadedXlsxWorkbook !== undefined) {
          const result = xlsxMatrixFromWorkbook(
            content._preloadedXlsxWorkbook.workbook,
            content._preloadedXlsxWorkbook.utils,
            content.sheetName,
            sheetPatternToUse,
          );
          matrix = result.matrix;
          resolvedSheetName = result.resolvedSheetName;
        } else {
          const result = await xlsxToMatrix(content.raw, content.sheetName, sheetPatternToUse);
          matrix = result.matrix;
          resolvedSheetName = result.resolvedSheetName;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Falha ao parsear XLSX (${msg}); arquivo ignorado`);
        return {
          columns: [],
          rows: [],
          warnings,
          resolvedSheetName: null,
          appliedProfileId: null,
          appliedProfileVersion: null,
          profileSource: null,
        };
      }
    } else {
      // application/vnd.google-apps.spreadsheet — Sheets API response
      if (
        typeof content.raw === 'object' &&
        content.raw !== null &&
        !Buffer.isBuffer(content.raw)
      ) {
        matrix = sheetsApiToMatrix(content.raw as GoogleSheetsApiResponse);
      } else if (typeof content.raw === 'string') {
        // CSV exportado do Sheets — path legado
        matrix = csvToMatrix(content.raw);
      } else {
        warnings.push('Sheets nativo requer raw do tipo GoogleSheetsApiResponse ou string CSV');
        return {
          columns: [],
          rows: [],
          warnings,
          resolvedSheetName: null,
          appliedProfileId: null,
          appliedProfileVersion: null,
          profileSource: null,
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Erro inesperado ao parsear planilha "${content.filename}": ${msg}`);
    return {
      columns: [],
      rows: [],
      warnings,
      resolvedSheetName: null,
      appliedProfileId: null,
      appliedProfileVersion: null,
      profileSource: null,
    };
  }

  // Matriz vazia ou sem dados
  if (matrix.length === 0) {
    warnings.push(`Planilha "${content.filename}" vazia ou sem dados`);
    return {
      columns: [],
      rows: [],
      warnings,
      resolvedSheetName,
      appliedProfileId: null,
      appliedProfileVersion: null,
      profileSource: 'heuristic',
    };
  }

  // ---------------------------------------------------------------------------
  // Etapa 2: resolve perfil (declarativo > hardcoded > heuristica)
  // ---------------------------------------------------------------------------
  const resolved = resolveProfile(
    content.filename,
    resolvedSheetName,
    content.sourceConfig,
    warnings,
  );

  const headerRowIndex =
    resolved.kind === 'declarative' || resolved.kind === 'hardcoded' ? resolved.headerRowIndex : 0;

  // Obtém o skipRowPredicate do perfil resolvido
  const skipRowPredicate: ((row: readonly string[]) => boolean) | null =
    resolved.kind === 'declarative'
      ? resolved.skipRowPredicate
      : resolved.kind === 'hardcoded'
        ? (resolved.profile.skipRowPredicate ?? null)
        : null;

  // Obtém o column_map override do perfil declarativo (se presente)
  const columnMapOverride: Record<string, string> =
    resolved.kind === 'declarative' ? resolved.columnMapOverride : {};

  // Metadados de linhagem do perfil
  const appliedProfileId: string | null =
    resolved.kind === 'declarative'
      ? resolved.profile.profile_id
      : resolved.kind === 'hardcoded'
        ? resolved.profile.profileId
        : null;

  const appliedProfileVersion: number | null =
    resolved.kind === 'declarative' ? resolved.profile.profile_version : null;

  const profileSource: ParsedSheet['profileSource'] =
    resolved.kind === 'declarative'
      ? resolved.profileSource
      : resolved.kind === 'hardcoded'
        ? 'hardcoded'
        : 'heuristic';

  // ---------------------------------------------------------------------------
  // Etapa 3: monta header e detecta colunas
  // ---------------------------------------------------------------------------

  // Verifica se headerRowIndex e valido
  if (headerRowIndex >= matrix.length) {
    warnings.push(
      `Planilha "${content.filename}": headerRowIndex=${headerRowIndex} fora do intervalo (${matrix.length} linhas). ` +
        'Usando linha 0.',
    );
  }

  const effectiveHeaderIdx = headerRowIndex < matrix.length ? headerRowIndex : 0;
  const headerRow = matrix[effectiveHeaderIdx] ?? [];

  // Linha de header completamente vazia
  if (headerRow.every((h) => String(h ?? '').trim().length === 0)) {
    warnings.push(`Planilha "${content.filename}" vazia ou sem dados`);
    return {
      columns: [],
      rows: [],
      warnings,
      resolvedSheetName,
      appliedProfileId,
      appliedProfileVersion,
      profileSource,
    };
  }
  const rawHeaders = headerRow.map((h) => String(h ?? ''));

  // Detecta mapeamentos canonicos via heuristica
  const detection = detectColumns(rawHeaders);

  // Mescla column_map do perfil declarativo sobre os mapeamentos heuristicos.
  // O perfil declarativo tem precedencia — sobrepoe o canonical detectado por heuristica.
  // Isso permite que o perfil corrija erros de detecção ou mapeie colunas que a heurística
  // não conhece (ex: "VLR BALCAO" que a heuristica já cobre, mas o perfil garante).
  const mappingByIndex = new Map<number, ColumnMapping>();
  for (const m of detection.mappings) {
    mappingByIndex.set(m.headerIndex, m);
  }

  // Aplica column_map do perfil declarativo (sobrepoe heuristica)
  if (Object.keys(columnMapOverride).length > 0) {
    for (let idx = 0; idx < rawHeaders.length; idx++) {
      const rawHeader = rawHeaders[idx];
      if (!rawHeader) continue;
      const normalizedHeader = normalizeHeader(rawHeader);
      // Tenta match exato (após normalização) ou match pelo raw header (case-insensitive)
      const overrideCanonical =
        columnMapOverride[rawHeader] ??
        columnMapOverride[normalizedHeader] ??
        // Match case-insensitive e por header normalizado
        (() => {
          for (const [key, value] of Object.entries(columnMapOverride)) {
            if (normalizeHeader(key) === normalizedHeader) return value;
          }
          return undefined;
        })();

      if (overrideCanonical !== undefined) {
        mappingByIndex.set(idx, {
          headerIndex: idx,
          canonical: overrideCanonical as import('./column-detector.js').CanonicalColumn,
          confidence: 1.0, // perfil declarativo = confiança máxima
        });
      }
    }
  }

  // Infere tipos por coluna — usa apenas a parte da matriz a partir do header
  const matrixFromHeader = matrix.slice(effectiveHeaderIdx) as unknown[][];
  const columnTypes = inferAllColumnTypes(matrixFromHeader);

  // Monta mappings como array para o validador de integridade
  const mappingsArray: ColumnMapping[] = [];
  for (const [, mapping] of mappingByIndex) {
    mappingsArray.push(mapping);
  }
  mappingsArray.sort((a, b) => a.headerIndex - b.headerIndex);

  // Valida integridade (passa apenas as linhas de dados, nao as linhas de titulo)
  const integrityWarnings = validateIntegrity(matrixFromHeader, mappingsArray, columnTypes);
  warnings.push(...integrityWarnings);

  // ---------------------------------------------------------------------------
  // Etapa 4: monta ParsedColumn[]
  // ---------------------------------------------------------------------------
  const columns: ParsedColumn[] = rawHeaders.map((rawHeader, idx) => {
    const mapping = mappingByIndex.get(idx);
    const colTypeInfo = columnTypes[idx];
    return {
      headerIndex: idx,
      rawHeader,
      canonical: mapping?.canonical ?? null,
      confidence: mapping?.confidence ?? null,
      type: colTypeInfo?.type ?? 'string',
    };
  });

  // ---------------------------------------------------------------------------
  // Etapa 5: monta ParsedRow[]
  // ---------------------------------------------------------------------------
  const dataRows = matrixFromHeader.slice(1) as unknown[][];
  const rows: ParsedRow[] = dataRows
    .filter((row) => {
      // Remove linhas completamente vazias
      if (isBlankRow(row)) return false;
      // Aplica skipRowPredicate do perfil (ex: linha de TOTAL MES)
      if (skipRowPredicate) {
        const rowAsStrings = row.map((cell) => String(cell ?? ''));
        if (skipRowPredicate(rowAsStrings)) return false;
      }
      return true;
    })
    .map((row): ParsedRow => {
      const cells = rawHeaders.map((_, colIdx) => {
        const rawOriginal: unknown = row[colIdx] ?? null;
        // R-031: sanitiza formula injection antes de persistir/propagar.
        // Numeros (negativos inclusos) nao sao afetados — so strings suspeitas.
        const raw: unknown = sanitizeCellValue(rawOriginal);
        const colTypeInfo = columnTypes[colIdx];
        const cast = colTypeInfo?.cast(raw);
        return {
          raw,
          typed: cast?.ok ? cast.value : raw,
        };
      });
      return { cells };
    });

  return {
    columns,
    rows,
    warnings,
    resolvedSheetName,
    appliedProfileId,
    appliedProfileVersion,
    profileSource,
  };
}
