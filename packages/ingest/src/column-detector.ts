/**
 * column-detector.ts — Detector heuristico de colunas de planilha.
 *
 * Recebe headers (linha 1 normalizada: trim, lowercase, sem acento,
 * espaco virou underscore) e mapeia cada header para um CanonicalColumn
 * quando possivel, baseado em sinonimos.
 *
 * F2-flow-05 / ADR-015 Divergencia 1: engenharia generica, SEM hardcoding
 * por cliente. Nenhum nome de cliente, sheet ou loja pode aparecer aqui.
 *
 * Confianca:
 *   1.0   = match exato com sinonimo
 *   0.7–0.99 = match parcial (header contem sinonimo como substring)
 *   < 0.7  = ignorado (nao retornado em mappings)
 */

export type CanonicalColumn =
  | 'data'
  | 'vendas'
  | 'quantidade'
  | 'quantidade_delivery'
  | 'quantidade_balcao'
  | 'vlr_balcao'
  | 'vlr_delivery'
  | 'ticket_medio'
  | 'custo'
  | 'lucro'
  | 'cliente'
  | 'categoria'
  | 'produto'
  | 'canal';

export interface ColumnMapping {
  readonly headerIndex: number;
  readonly canonical: CanonicalColumn;
  readonly confidence: number;
}

export interface ColumnDetectionResult {
  readonly mappings: readonly ColumnMapping[];
  readonly unmapped: readonly string[];
}

/**
 * Tabela de sinonimos por canonical. Todos os sinonimos estao normalizados
 * (lowercase, sem acento, underscore no lugar de espaco). A normalizacao
 * dos headers de entrada e responsabilidade do caller (normalizeHeader).
 */
const SYNONYM_TABLE: Readonly<Record<CanonicalColumn, readonly string[]>> = {
  data: ['data', 'dt', 'date', 'dia', 'mes_ano', 'periodo'],
  vendas: ['vendas', 'faturamento', 'receita', 'revenue', 'sales', 'ticket_total'],
  // 'venda_total_bolos' e sinonimo especifico para planilhas MKT_vendas_diarias (perfil RESUMO_MENSAL).
  // Usa match partial — 'venda_total_bolos_qtd' contem 'venda_total_bolos'.
  quantidade: [
    'qtd',
    'qty',
    'quantidade',
    'pedidos',
    'n_pedidos',
    'transacoes',
    'venda_total_bolos',
    'total_bolos_vendidos',
  ],
  // Campos de canal de venda (delivery vs balcao) — usados para calcular pct_delivery.
  // Sinonimos exatos das colunas RESUMO MENSAL apos normalizacao:
  //   'QTDE DELIVERY' -> 'qtde_delivery'
  //   'QTDE BALCAO'   -> 'qtde_balcao'
  quantidade_delivery: ['qtde_delivery', 'qty_delivery', 'quantidade_delivery', 'qtd_delivery'],
  quantidade_balcao: ['qtde_balcao', 'qty_balcao', 'quantidade_balcao', 'qtd_balcao'],
  // Campos de faturamento por canal — usados como fallback de faturamento_real
  // quando as abas pivo (SABORES/COBERTURAS POR DIA) nao estiverem presentes.
  // O adapter soma vlr_balcao + vlr_delivery e emite como faturamento_real com
  // metadata.faturamento_source='resumo'. O pivot permanece fonte primaria.
  // Sinonimos exatos das colunas RESUMO MENSAL apos normalizacao:
  //   'VLR BALCAO'    -> 'vlr_balcao'
  //   'VLR DELIVERY'  -> 'vlr_delivery'
  vlr_balcao: ['vlr_balcao', 'valor_balcao', 'vl_balcao', 'val_balcao'],
  vlr_delivery: ['vlr_delivery', 'valor_delivery', 'vl_delivery', 'val_delivery'],
  ticket_medio: ['ticket_medio', 'ticket_med', 'avg_ticket'],
  custo: ['custo', 'cost', 'cogs', 'custo_total'],
  // 'lucro_bruto' e sinonimo especifico das planilhas MKT_vendas_diarias.
  lucro: ['lucro', 'profit', 'lucro_bruto', 'margem', 'margem_bruta'],
  cliente: ['cliente', 'customer', 'cpf', 'email'],
  categoria: ['categoria', 'category', 'segmento'],
  produto: ['produto', 'sku', 'item'],
  canal: ['canal', 'channel', 'origem'],
};

/**
 * Remove acentos de uma string e converte para lowercase com underscores.
 * Permite reutilizar sinonimos mesmo em planilhas com acentuacao variada.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacriticos
    .replace(/\s+/g, '_') // espacos -> underscore
    .replace(/[^a-z0-9_]/g, '') // remove caracteres especiais restantes
    .replace(/_+/g, '_') // colapsa underscores multiplos
    .replace(/^_|_$/g, ''); // remove underscores de borda
}

/**
 * Detecta o melhor canonical para um header normalizado.
 * Retorna null se nenhum canonical atingir confianca >= 0.7.
 *
 * Estrategia de scoring:
 *   1.0         = match exato com qualquer sinonimo
 *   0.85 + len  = header contem sinonimo como substring (tiebreak por comprimento do sinonimo)
 *   0.75 + len  = sinonimo contem header como substring (tiebreak por comprimento do sinonimo)
 *   null        = sem match suficiente
 *
 * Desempate: quando dois canonicos tem a mesma confianca de base (ex: 0.85),
 * o que tem o sinonimo mais longo vence (sinonimo mais longo = match mais especifico).
 * Ex: "vendas_diarias" matches "vendas" (len=6) para 'vendas' e "dia" (len=3) para 'data'.
 * Vence 'vendas' por sinonimo mais longo.
 */
function bestMatchForHeader(
  normalizedHeader: string,
): { canonical: CanonicalColumn; confidence: number } | null {
  // score = confianca base * 1000 + comprimento_do_sinonimo (para desempate)
  let bestScore = -1;
  let bestResult: { canonical: CanonicalColumn; confidence: number } | null = null;

  for (const [canonical, synonyms] of Object.entries(SYNONYM_TABLE) as Array<
    [CanonicalColumn, readonly string[]]
  >) {
    let confidence: number | null = null;
    let matchLen = 0;

    // Match exato
    for (const synonym of synonyms) {
      if (normalizedHeader === synonym) {
        confidence = 1.0;
        matchLen = synonym.length;
        break;
      }
    }

    // Match parcial: header contem sinonimo como substring
    if (confidence === null) {
      for (const synonym of synonyms) {
        if (synonym.length >= 3 && normalizedHeader.includes(synonym)) {
          if (synonym.length > matchLen) {
            confidence = 0.85;
            matchLen = synonym.length;
          }
        }
      }
    }

    // Match parcial inverso: sinonimo contem header como substring
    if (confidence === null) {
      for (const synonym of synonyms) {
        if (normalizedHeader.length >= 3 && synonym.includes(normalizedHeader)) {
          if (synonym.length > matchLen) {
            confidence = 0.75;
            matchLen = synonym.length;
          }
        }
      }
    }

    if (confidence !== null) {
      const score = confidence * 1000 + matchLen;
      if (score > bestScore) {
        bestScore = score;
        bestResult = { canonical, confidence };
      }
    }
  }

  return bestResult;
}

/**
 * Detecta colunas de uma lista de headers.
 *
 * @param headers - Headers da linha 1 da planilha (strings brutas, sem normalizacao previa).
 * @returns mappings (headers mapeados para canonical com confianca) + unmapped (sem mapeamento).
 *
 * Garantia: um canonical aparece no maximo uma vez em mappings — se dois headers
 * mapeiam para o mesmo canonical, apenas o de maior confianca e retido
 * (desempate: menor headerIndex para estabilidade).
 */
export function detectColumns(headers: readonly string[]): ColumnDetectionResult {
  // Fase 1: calcular melhor match para cada header
  const candidates: Array<{ headerIndex: number; canonical: CanonicalColumn; confidence: number }> =
    [];

  for (let i = 0; i < headers.length; i++) {
    const rawHeader = headers[i];
    if (rawHeader === undefined) continue;
    const normalized = normalizeHeader(rawHeader);
    if (normalized.length === 0) continue;

    const match = bestMatchForHeader(normalized);
    if (match !== null) {
      candidates.push({ headerIndex: i, ...match });
    }
  }

  // Fase 2: desduplicar por canonical — manter apenas o de maior confianca
  // (desempate: menor headerIndex)
  const best = new Map<CanonicalColumn, { headerIndex: number; confidence: number }>();

  for (const candidate of candidates) {
    const existing = best.get(candidate.canonical);
    if (
      existing === undefined ||
      candidate.confidence > existing.confidence ||
      (candidate.confidence === existing.confidence && candidate.headerIndex < existing.headerIndex)
    ) {
      best.set(candidate.canonical, {
        headerIndex: candidate.headerIndex,
        confidence: candidate.confidence,
      });
    }
  }

  // Fase 3: montar resultados
  const mappedIndexes = new Set<number>();
  const mappings: ColumnMapping[] = [];

  for (const [canonical, info] of best.entries()) {
    mappings.push({
      headerIndex: info.headerIndex,
      canonical,
      confidence: info.confidence,
    });
    mappedIndexes.add(info.headerIndex);
  }

  mappings.sort((a, b) => a.headerIndex - b.headerIndex);

  const unmapped: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h !== undefined && !mappedIndexes.has(i)) {
      unmapped.push(h);
    }
  }

  return { mappings, unmapped };
}
