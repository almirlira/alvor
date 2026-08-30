/**
 * Output validator — Camada 4 do ADR-008.
 *
 * Grounding check com tolerancia de ±0,5% (B.22 D-018).
 *
 * Para cada numero citado no output do LLM:
 *   1. o numero tem que ter marcador de fonte (ex: [ref:kpi_snapshot#123])
 *   2. a fonte citada tem que existir em `sourceRefs`
 *   3. o valor tem que corresponder ao valor da fonte, dentro da margem de 0,5%
 *
 * Se qualquer regra falhar, a resposta e rejeitada com `rejectionReason`.
 * Callers devem persistir o resultado em `llm_audit_log` com
 * `hallucination_check_passed` apropriado.
 *
 * ## Regime DEFAULT-DENY (ADR-008 Camada 4, refino 2026-06-03 EVO-1 + EVO-2 + P-CELL 2026-06-05)
 *
 * Todo numero e KPI por padrao — exige [ref:]. A unica isencao e casar
 * EXATAMENTE um padrao incidental da lista FECHADA:
 *   P-ANO / P-DATA / P-DATA-EXT / P-ORD / P-LISTA / P-HORA / P-DUR / P-PERIODO / P-CELL
 *
 * P-CONT (contagem estrutural por verbo) foi REMOVIDO (EVO-1).
 * Contagem de lojas/unidades exige [ref:entities#count] como qualquer KPI.
 *
 * REMOVIDO:
 *   - ESTRUTURA_VERBS (whitelist de verbos estruturais)
 *   - VERB_ENDING_RE (heuristica de terminacao verbal)
 *   - STRUCT_UNIT (unidades estruturais de rede)
 *   - P-CONT (contagem estrutural por verbo)
 *   - Excecao por magnitude (n<=50)
 *   - P-UNIT-DENOM (denominador monetario "R$ 1") — revertido EVO-2 (gate seguranca)
 *
 * EVO-2 (2026-06-03 gate seguranca):
 *   - P-UNIT-DENOM REVERTIDO: "R$ 1 bilhao/milhao" escapava sem fonte.
 *     ROAS "para cada R$ 1 investido" deve citar [ref:] — trade-off aceito.
 *   - ABSOLUTE_TOLERANCE_FLOOR restrito a magnitude >= 1: fracoes/razoes <1
 *     usam somente tolerancia relativa 0,5% (evita casamento de KPI fracionario).
 *   - Fix-P-ANO-GLOBAL: replace de rawDigit usa split/join (global) para
 *     evitar isencao de intervalo indevida quando rawDigit aparece 2x na janela.
 *
 * INV-VAL-1 / Security 2026-06-03:
 *   Guardas NEGATIVAS tem prioridade absoluta (avaliadas antes de qualquer padrao).
 *   Avaliacao e POR TOKEN (janela imediata), nunca por sentenca (SEC-08/SEC-09).
 *   Ramo cross-tenant INTOCADO e antes do filtro (SEC-05).
 */

/** Tolerancia para grounding check — B.22 D-018 (ADR-008 Secao 8). */
export const GROUNDING_TOLERANCE = 0.005;

/** Classificacao de sensibilidade do dado para scope de papel. */
export type SourceClassification = 'public' | 'pii' | 'financial' | 'audit';

/**
 * Referencia rastreavel a uma linha do banco do tenant. Cada `<<<DATA>>>`
 * block injetado em prompt carrega um `SourceRef` que o LLM DEVE citar
 * quando usar aquele dado na resposta.
 */
export interface SourceRef {
  readonly id: string;
  readonly tenantId: string;
  readonly table: string;
  readonly rowId: string;
  readonly value: number;
  readonly classification: SourceClassification;
}

export type RejectionReason =
  | 'number-without-source'
  | 'number-not-in-sources'
  | 'number-out-of-tolerance'
  | 'cross-tenant-reference';

export interface ValidationResult {
  readonly passed: boolean;
  readonly numbersFound: number;
  readonly numbersValidated: number;
  readonly rejectionReason: RejectionReason | null;
  readonly rejectionDetail: string | null;
}

// Regex captura numero (int/decimal, ptBR ou en) opcionalmente seguido de unidade.
// Ex: "R$ 12.345,67", "1234.56", "45%", "1.2K", "1200000", "-76,06%"
// Ordem das alternativas importa: tentamos primeiro a forma longa com separadores,
// depois a forma plana, para nao capturar "120" de "1200000".
//
// Fix-NEG (2026-06-03): grupo 1 aceita sinal "-" opcional para capturar numeros negativos
// como "-76,06%" integralmente. A lookbehind (?<![a-zA-Z_0-9]) ainda bloqueia capturas
// dentro de identificadores (ex: "a-76" nao captura "-76") porque o char antes do "-"
// seria alfanum, fazendo a lookbehind falhar — o "-" nao e capturado, mas os digitos
// apos ele ainda sao (como numero positivo), o que e o comportamento correto e seguro.
const NUMBER_RE =
  /(?<![a-zA-Z_0-9])(?:R\$\s*)?(-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?)\s*(%|k|K|mil)?(?![0-9a-zA-Z_])/g;

// Regex captura marcador de fonte: [ref:id] | [ref:table#rowId] | (ref:id)
const SOURCE_REF_RE = /\[ref:([^\]]+)\]/g;

// Detecta formato ptBR de milhar puro: "100.000", "1.200.000" (grupos de 3 apos ponto)
// Sem parte decimal (que seria "100.000,50" — ja tratada por lastComma > lastDot).
const PTBR_THOUSANDS_ONLY_RE = /^\d{1,3}(\.\d{3})+$/;

/**
 * Converte um match textual num numero normalizado (float).
 * Suporta ptBR (1.234,56 e 1.234) e en (1,234.56).
 *
 * Fix-NEG (2026-06-03): preserva sinal "-" inicial para numeros negativos.
 * O "-" e extraido antes do processamento de separadores e reaplico ao resultado.
 * Isso permite que "-76,06" seja parseado como -76.06 (e nao +76.06), de modo que
 * a comparacao de grounding com fontes de valor negativo funcione corretamente.
 */
function parseNumber(raw: string, suffix: string | undefined): number {
  let cleaned = raw.replace(/R\$\s*/, '').trim();

  // Fix-NEG: preservar sinal negativo antes de processar separadores.
  const negative = cleaned.startsWith('-');
  if (negative) cleaned = cleaned.slice(1);

  // Decide separador decimal pelo ultimo simbolo presente.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma === -1 && lastDot === -1) {
    // inteiro puro — nenhum separador
  } else if (lastComma > lastDot) {
    // ptBR: . = milhar, , = decimal — ex: "1.234,56"
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma === -1 && PTBR_THOUSANDS_ONLY_RE.test(cleaned)) {
    // ptBR milhar sem decimal — ex: "100.000", "1.200.000"
    // Todos os pontos sao separadores de milhar (grupos de exatamente 3 digitos).
    cleaned = cleaned.replace(/\./g, '');
  } else {
    // en: , = milhar, . = decimal — ex: "1,234.56"
    cleaned = cleaned.replace(/,/g, '');
  }

  let value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return Number.NaN;

  // Reaplicar sinal negativo apos normalizacao de separadores.
  if (negative) value = -value;

  if (suffix === 'k' || suffix === 'K' || suffix === 'mil') value *= 1000;
  // % nao multiplica — a comparacao contra a fonte acontece no mesmo espaco.

  return value;
}

/**
 * Absolute tolerance floor para display rounding (2026-06-03 Fix-ROUND).
 *
 * Valores monetarios pequenos (ex: CPC R$ 0,12) sao exibidos arredondados
 * para 2 casas decimais por convencao pt-BR. Isso pode gerar desvio relativo
 * maior que 0.5% (ex: 0.1249 arredondado para 0.12 = 3.9% relativo).
 *
 * A tolerancia absoluta de 0.005 (meio centavo em R$) complementa a tolerancia
 * relativa: se a diferenca absoluta for <= 0.005, o valor e considerado dentro
 * do limite de display rounding sem ampliar o flanco de alucinacao.
 * (Um valor fabricado dificilmente cai a menos de R$ 0,005 do valor real por acaso.)
 */
const ABSOLUTE_TOLERANCE_FLOOR = 0.005;

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  const absDiff = Math.abs(a - b);
  // Fix-ROUND: desvio absoluto <= meio centavo = display rounding convencional.
  // Restricao dimensional: o piso absoluto so vale quando a magnitude e >= 1.
  // Para valores fracionarios (razoes, indices, percentuais como fracao <1),
  // usar APENAS a tolerancia relativa de 0,5% — evita casamento indevido de
  // KPIs fracionarios fabricados (ex: fonte 0,03 vs output 0,035 = 16% de desvio).
  const magnitude = Math.max(Math.abs(a), Math.abs(b));
  if (magnitude >= 1 && absDiff <= ABSOLUTE_TOLERANCE_FLOOR) return true;
  const base = Math.max(magnitude, 1e-9);
  return absDiff / base <= tolerance;
}

// ---------------------------------------------------------------------------
// isIncidentalNumber — DEFAULT-DENY EVO-1 (ADR-008 Camada 4, 2026-06-03).
//
// REGRA D-DENY: todo numero e KPI por padrao e EXIGE [ref:].
// isIncidentalNumber so retorna true se:
//   (A) TODAS as guardas negativas passam (nenhuma dispara), E
//   (B) o token casa EXATAMENTE um padrao incidental da lista FECHADA:
//       P-ANO / P-DATA / P-DATA-EXT / P-ORD / P-LISTA / P-HORA /
//       P-DUR / P-PERIODO / P-CELL
//
// P-CONT REMOVIDO (EVO-1): contagem de lojas/unidades exige [ref:entities#count].
// Nao ha excecao por magnitude. Nao ha whitelist de verbos.
// A ausencia de match incidental e KPI (default-deny).
//
// P-CELL (2026-06-05): isenta inteiro de posicao de tabela markdown 1..20.
//   Condicoes obrigatorias (todas): passou GN-*; borda | de celula confirmada;
//   1 <= n <= 20; celula original sem [ref:] proprio (verificado via rawSentence).
//   Nao e heuristica de magnitude — e classe fechada e enumeravel (I-7).
//
// INV-VAL-1 / Security 2026-06-03:
//   Guardas NEGATIVAS tem prioridade absoluta (avaliadas antes de qualquer padrao).
//   Avaliacao e POR TOKEN (janela imediata), nunca por sentenca (SEC-08/SEC-09).
//   Ramo cross-tenant INTOCADO e antes do filtro (SEC-05).
// ---------------------------------------------------------------------------

// KPI metric nouns — substantivos numericamente atribuiveis que sinalizam KPI.
const KPI_METRIC_NOUNS =
  /\b(faturamento|receita|ticket\s*m[eé]dio|alcance|cpm|roas|roi|cac|ltv|investimento|retorno)\b/i;

/**
 * Retorna true se o numero capturado e "incidental" e NAO deve exigir fonte.
 *
 * DEFAULT-DENY EVO-1: retorna false (KPI) por padrao.
 * So retorna true se o token casa exatamente um padrao incidental FECHADO
 * apos passarem TODAS as guardas negativas.
 *
 * Lista FECHADA: P-ANO, P-DATA, P-ORD, P-LISTA, P-HORA, P-DUR, P-PERIODO, P-CELL.
 * P-CONT REMOVIDO — contagem de lojas exige [ref:entities#count].
 *
 * @param rawDigit grupo 1 do match (apenas os digitos + separadores)
 * @param suffix   grupo 2 do match (%, k, K, mil ou undefined)
 * @param fullMatch texto completo do match (incluindo eventual "R$ ")
 * @param sentence  sentenca completa em que o match foi encontrado (refs ja removidos)
 * @param matchIndex posicao do inicio do fullMatch dentro de `sentence`
 * @param rawSentence sentenca original com refs intactos (usada por P-CELL — condicao 4)
 */
export function isIncidentalNumber(
  rawDigit: string,
  suffix: string | undefined,
  fullMatch: string,
  sentence: string,
  matchIndex: number,
  rawSentence?: string,
): boolean {
  // =========================================================================
  // (A) GUARDAS NEGATIVAS — prioridade absoluta.
  // Avaliadas ANTES de qualquer padrao incidental.
  // Primeira que disparar retorna false (KPI) imediatamente.
  // =========================================================================

  // GN-PCT-SUF: sufixo de metrica/volume explicito (%, k, K, mil).
  if (suffix !== undefined) return false;

  // GN-MOEDA: prefixo monetario (R$, US$, $, €, BRL, EUR) no fullMatch.
  if (/^(?:R\$|US\$|\$|€|BRL|EUR)\s*/i.test(fullMatch)) return false;

  // GN-MILHAR: separador de milhar ou decimal no rawDigit — KPI financeiro.
  // "100.000" = ptBR milhar; "3,2" = decimal — ambos sao KPI.
  if (rawDigit.includes('.') || rawDigit.includes(',')) return false;

  // Janelas de contexto em torno do match.
  const winStart = Math.max(0, matchIndex - 30);
  const winEnd = Math.min(sentence.length, matchIndex + fullMatch.length + 30);
  const window30 = sentence.slice(winStart, winEnd);
  const afterToken = sentence.slice(
    matchIndex + fullMatch.length,
    matchIndex + fullMatch.length + 20,
  );
  const beforeToken = sentence.slice(Math.max(0, matchIndex - 20), matchIndex);

  // GN-MOEDA-EXT: moeda por extenso adjacente ("reais", "mil reais").
  if (/\b(reais|mil\s+reais)\b/i.test(window30)) return false;

  // GN-METRICA: substantivo de KPI nomeado na janela ±30.
  //
  // Fix-ANO-PRE-METRICA (2026-06-03): anos gregorians (4 digitos, [1900..2099])
  // sao dimensoes temporais — nao sao valores de KPI mesmo quando aparecem em
  // sentencas com substantivos de metrica ("faturamento para julho de 2026").
  // Pular GN-METRICA para anos: a guarda P-ANO mais adiante valida o contexto
  // sintático (ANO_OPEN/ANO_CLOSE) para garantir que e realmente um ano e nao um
  // volume (ex: "faturamos 2024 unidades" → ANO_OPEN nao casa → default-deny).
  const isLikelyYear =
    rawDigit.length === 4 &&
    !rawDigit.includes('.') &&
    !rawDigit.includes(',') &&
    !rawDigit.startsWith('-') &&
    Number.parseInt(rawDigit, 10) >= 1900 &&
    Number.parseInt(rawDigit, 10) <= 2099;
  if (!isLikelyYear && KPI_METRIC_NOUNS.test(window30)) return false;

  // GN-LABEL: atribuicao "label: N" — ":" imediatamente antes do token.
  // Fix-DATE-COLON (2026-06-03): nao dispara quando afterToken começa com "/"
  // — nesse caso o numero faz parte de um intervalo de datas ("Periodo: 01/03/2026"),
  // nao um valor KPI atribuido por rotulo. P-DATA ainda verifica /\d+\/$/ em
  // beforeToken OU /^\/\d+/ em afterToken; a borda esquerda da data fica sem
  // prefixo de digito quando o numero abre o intervalo apos ":", mas o afterToken
  // "/03/2026" e suficiente para P-DATA isentar corretamente.
  //
  // Fix-ISO-DATE-COLON (2026-06-03 gate-seguranca): nao dispara quando afterToken
  // começa com "-\d{2}" — o numero apos ":" faz parte de data ISO YYYY-MM-DD
  // (ex: "Periodo analisado: 2026-04-30"). Sem essa excecao, GN-LABEL bloquearia
  // o ano 2026 antes de P-ANO verificar Fix-ISO-DATE-YEAR, causando rejeicao indevida.
  if (/:\s*$/.test(beforeToken) && !/^\//.test(afterToken) && !/^-\d{2}/.test(afterToken))
    return false;

  // =========================================================================
  // (B) PADROES INCIDENTAIS — lista FECHADA (EVO-1).
  // So chegam aqui tokens que passaram TODAS as guardas acima.
  // Se nenhum padrao casa => false (KPI, default-deny).
  //
  // NOTA EVO-1: P-CONT removido. Contagem de lojas/unidades/filiais NÃO e
  // mais incidental por verbo. Exige [ref:entities#count] como qualquer KPI.
  // =========================================================================

  const n = Number.parseInt(rawDigit, 10);
  if (!Number.isFinite(n)) return false;

  // =========================================================================
  // P-ANO: ano gregoriano — 4 digitos exatos, [1900..2099].
  //
  // Hardening 8.5.1: isenta SOMENTE quando borda esquerda E borda direita
  // confirmam posicao sintatica incidental (guarda de contexto positivo).
  //
  // Borda esquerda incidental (ANO_OPEN): token imediatamente antes e
  //   preposicao/conector temporal, "(", "/" adjacente, ou segundo ano na janela.
  // Borda direita de fechamento (ANO_CLOSE): proximo token nao-espaco e
  //   pontuacao/conjuncao/preposicao/fim/outro-ano — NUNCA substantivo de volume.
  //
  // Casos preservados:
  //   "em 2026" — "em " ∈ ANO_OPEN, "." ∈ ANO_CLOSE
  //   "de 2026" — "de " ∈ ANO_OPEN, "." ∈ ANO_CLOSE
  //   "e 2026"  — "e " ∈ ANO_OPEN, "." ∈ ANO_CLOSE
  //   "2024 com 2025" — segundo ano na janela → intervalo
  //   "de 2019 unidades" — "de " abre, mas "unidades" reprova borda direita
  //   "Faturamos 2024" — "Faturamos " ∉ ANO_OPEN → KPI
  // =========================================================================
  if (n >= 1900 && n <= 2099 && rawDigit.length === 4) {
    // "/" adjacente → parte de data → isenta sempre
    if (/\/$/.test(beforeToken) || /^\//.test(afterToken)) return true;

    // Fix-ISO-DATE-YEAR (2026-06-03): ano em data ISO com hifen (ex: "2026-04-30").
    // Apos stripMarkdownEmphasis o "-MM-DD" fica colado ao ano. Se afterToken comecar
    // com "-\d{2}" (componente de mes ou dia), o token e parte de data ISO → isenta.
    // Guarda de seguranca: rawDigit deve ser ano gregoriano (4 digitos, 1900..2099),
    // o que ja e garantido por este bloco P-ANO.
    if (/^-\d{2}/.test(afterToken)) return true;

    // Segundo ano [1900..2099] na janela ±30 → intervalo → isenta
    // Fix-P-ANO-GLOBAL (2026-06-03): usar replace com flag global para remover
    // TODAS as ocorrencias de rawDigit na janela, senao "2024 (ver pagina 2024)"
    // deixava uma copia na janela e disparava isencao de intervalo indevida.
    const windowNoSelf = window30.split(rawDigit).join(' ');
    if (/\b(1[9]\d{2}|20\d{2})\b/.test(windowNoSelf)) return true;

    // Borda esquerda: token imediatamente antes deve ser ANO_OPEN
    const ANO_OPEN =
      /\b(em|de|desde|at[eé]|entre|para|no|na|num|numa|e|[eé]|ano|exerc[ií]cio|safra|temporada)\s+$|^\($|^\s*\($|,\s*$/i;
    if (!ANO_OPEN.test(beforeToken)) return false;

    // Borda direita: rejeita SOMENTE se seguido imediatamente por substantivo de
    // volume/resultado (palavras que indicam que o numero e quantidade, nao ano).
    // Verbos, adverbios, preposicoes, conjuncoes e pontuacao sao OK — o furo que
    // queremos fechar e "de 2019 unidades" / "Vendemos 2023 produtos", nao
    // "em 2023 ja atingiu" ou "de 2025 foi analisado".
    //
    // VOLUME_NOUN: substantivos de quantidade/negocio que traem que o numero e volume.
    const afterTrimmed = afterToken.replace(/^\s+/, '');
    const VOLUME_NOUN =
      /^(unidades?|produtos?|clientes?|pedidos?|itens?|lojas?|filiais?|franqueadas?|proprias?|reais?|vendas?|receitas?|faturamentos?|usuarios?|pessoas?|visitas?)\b/i;
    if (VOLUME_NOUN.test(afterTrimmed)) return false;
    // Qualquer outra coisa apos o ano (pontuacao, verbo, adverbio, conjuncao,
    // preposicao, fim de string) → borda direita ok → isenta
    return true;
  }

  // P-DATA: parte de data calendario — numero de 1-2 digitos com "/" adjacente.
  //
  // Fix-MONTHYEAR (2026-06-03): alarga a deteccao de borda esquerda para aceitar
  // tambem abreviacoes mes/ano como "jun/26", "mar/26", "dez/25" onde o char
  // imediatamente antes de "/" e uma letra (nao um digito).
  // A forma original (/\d+\/$/) cobria "01/", "30/" etc.
  // A forma nova (/[a-zA-Z]+\/$/) cobre "jun/", "mar/" etc.
  // Ambas as formas sao seguras: o NUMBER_RE nunca captura "/26" (lookbehind
  // bloqueia inicio apos digito/letra), entao o unico modo de capturar "26" em
  // "jun/26" e o contexto de slash antes.
  //
  // Fix-ISO-DATE (2026-06-03): datas ISO com hifen (YYYY-MM-DD ou MM-DD) aparecem
  // no texto apos stripMarkdownEmphasis preservar os hifens. Tokens como "04" e "30"
  // de "2026-04-30" precisam ser isentados quando ha hifen adjacente indicando
  // componente de data ISO. Condicao: rawDigit.length <= 2 E (borda esquerda = \d+-
  // OU borda direita = -\d+).
  //
  // Fix-ISO-DATE-HYPHEN-RESTRICT (2026-06-03 gate-seguranca R-046):
  // A borda de hifen (sem "/") so e valida como componente de data ISO quando ha
  // um ano gregoriano (YYYY-MM) na janela de ±30 chars. Sem essa restricao, pares
  // de 2 digitos colados por hifen sem ano (ex: "margem 12-34", "churn 8-15",
  // "taxa 20-45") escapavam sem fonte por serem confundidos com partes de data.
  // A barra "/" (formato DD/MM/AAAA) permanece irrestrita — e estruturalmente segura.
  //
  // Seguranca: hifen como separador de KPI composto (ex: "ROAS-2,5") e bloqueado
  // por GN-MILHAR (rawDigit contem separador) ou GN-PCT-SUF (sufixo presente)
  // antes de chegar aqui.
  if (rawDigit.length <= 2) {
    // Borda "/": datas DD/MM/AAAA — segura, irrestrita.
    const isSlashDatePart = /(?:\d+|[a-zA-Z]+)\/$/.test(beforeToken) || /^\/\d+/.test(afterToken);

    // Borda "-": componente de data ISO — restrita a janelas com ano gregoriano.
    // Exige YYYY-MM adjacente na window30 (ex: "2026-04" ou "04-30" como sub-token de "2026-04-30").
    const hasIsoYearInWindow = /\b(?:19|20)\d{2}-\d{2}/.test(window30);
    const isHyphenDatePart =
      hasIsoYearInWindow && (/\d{2}-$/.test(beforeToken) || /^-\d{2}\b/.test(afterToken));

    if (isSlashDatePart || isHyphenDatePart) return true;
  }

  // P-ORD: ordinal — sufixo ordinal colado apos o match (ptBR ou en).
  //
  // Fix-ORD-PTBR-SYMBOL (2026-06-03): adiciona indicadores ordinais ptBR
  // (U+00BA = "º" masculino, U+00AA = "ª" feminino) ao ORDINAL_SUFFIX.
  // O LLM formata rankings como "1º", "2º", "3º" em tabelas markdown —
  // esses numerais ordinais nao sao KPIs e nao exigem [ref:].
  // Sem esse fix, "1º" capturava rawDigit=1, afterToken="º | ...",
  // e o validador rejeitava com number-out-of-tolerance (o 1 nao bate
  // com nenhuma source quando a unica ref da sentenca tem value=367157).
  const ORDINAL_SUFFIX = /^[aoºª](?:\s|$|[|.,;:!?])/;
  const ORDINAL_SUFFIX_EN = /^(?:st|nd|rd|th)(?:\s|$|[.,;:!?])/;
  if (ORDINAL_SUFFIX.test(afterToken) || ORDINAL_SUFFIX_EN.test(afterToken)) return true;

  // P-NUMLIST: marcador de lista numerada — "N." no inicio da sentenca.
  //
  // Fix-NUMLIST (2026-06-03): markdown gera listas como "1. Texto", "2. Texto".
  // O numero de lista e estrutural e nao e KPI. Isentar quando:
  //   - afterToken começa com ". " ou ".\t" (ponto+espaco = separador de item), OU
  //   - afterToken == "." exatamente (o separador de sentenca quebrou "1. Texto" em
  //     "1." + "Texto" — o fragmento "1." fica sozinho como sentenca de 2 chars),
  //   - beforeToken e vazio ou so whitespace (o numero esta no inicio da sentenca/linha),
  //   - n <= 99 (listas praticamente nunca tem mais de 99 itens; acima = volume suspeito).
  //
  // Nao isentar "26. unidades" (VOLUME_NOUN ja fecha esse caso antes de P-ORD).
  // Nao isentar numeros com separador (GN-MILHAR ja fecha antes de chegar aqui).
  if (/^\s*$/.test(beforeToken) && n <= 99 && (/^\.\s/.test(afterToken) || afterToken === '.'))
    return true;

  // P-LISTA: indicador de lista/estrutura textual — prefixo colado + magnitude <= 100.
  //
  // Hardening 8.5.4: magnitudes > 100 com prefixo de lista sao VOLUME disfarcado
  // ("item 500", "fase 1200", "top 840") → KPI. Limite 100 cobre top-N de marketing,
  // etapas de campanha e paginacao reais sem abrir flanco a valores de volume.
  const LIST_PREFIX = /\b(top|etapa|p[aá]gina|passo|fase|item)\s*$/i;
  if (LIST_PREFIX.test(beforeToken) && n <= 100) return true;

  // P-HORA: hora — token seguido de "h", "hs", ":MM", "horas" ou "min".
  const HORA_AFTER = /^(?:h(?:s|\b)|:\d{2}|\s*horas?|\s*min(?:utos?)?)/i;
  if (HORA_AFTER.test(afterToken)) return true;

  // P-DUR: duracao de periodo — token seguido de dias/semanas/meses/horas/minutos.
  //
  // Hardening 8.5.2: so isenta se houver quantificador temporal FECHADO na janela
  // ±20 ANTES do numero. Sem o quantificador, "N dias/meses" e VOLUME economico.
  //
  // DUR_QUANT (classe fechada): ultimos/proximos/primeiros/ha/durante/
  //   passados/periodo de/prazo de/ao longo de/em/nos/nas/a cada/por
  const DURATION_WORDS = /^\s*(dias?|semanas?|meses?|horas?|minutos?)\b/i;
  if (DURATION_WORDS.test(afterToken)) {
    // NOTA: \\b nao casa com chars Unicode acentuados (ú, ó, etc.) em JS.
    // Usamos (?:^|\\s) como borda esquerda para termos que podem iniciar com acento.
    //
    // Fix-DUR-APPROX (2026-06-03): o simbolo ~ (aprox) pode aparecer entre o
    // quantificador temporal e o numero ("periodo de ~3 meses", "em ~30 dias").
    // A ancora final muda de \s*$ para \s*[~≈]?\s*$ para capturar esses casos.
    // Nao amplia o conjunto de quantificadores — so adiciona tolerancia ao simbolo.
    // Fix-DUR-ACUM (2026-06-03): adiciona "acumulado/acumulados" e "total de"
    // ao DUR_QUANT para cobrir "Acumulado 12 meses" e "Total de 30 dias"
    // — construcoes comuns em headers de secao de relatorio financeiro.
    const DUR_QUANT =
      /(?:^|\s)([uú]ltim[oa]s?|[pP]r[oó]xim[oa]s?|[pP]rimeir[oa]s?|h[aá]|durante|passad[oa]s?|per[ií]odo\s+de|prazo\s+de|ao\s+longo\s+de|\bnos?|\bnas?|a\s+cada|\bpor|acumulad[oa]s?|total\s+de)\s*[~≈]?\s*$/i;
    // "em" sozinho tambem e quantificador temporal para P-DUR ("Em 30 dias")
    const DUR_QUANT_EM = /\bem\s*[~≈]?\s*$/i;
    if (DUR_QUANT.test(beforeToken) || DUR_QUANT_EM.test(beforeToken)) return true;
    // Sem quantificador temporal → default-deny (KPI)
    return false;
  }

  // P-PERIODO: ordinal temporal de trimestre/semestre/bimestre.
  //
  // Hardening 8.5.3: isenta SOMENTE na forma ORDINAL de periodo.
  //   - O numero deve ter sufixo ordinal (P-ORD ja cobriu) OU estar colado a
  //     unidade de periodo como ordinal OU borda esquerda PER_OPEN.
  //   - A forma "N em <mes>" NUNCA isenta.
  //   - Nome de mes sozinho nao e mais gatilho.
  //
  // Chegamos aqui somente se P-ORD NAO casou (sem sufixo colado).
  // So isenta se: n ∈ [1..4], borda esquerda ∈ PER_OPEN, e unidade de periodo
  // aparece logo apos (colada ou em ±5 chars).
  if (n >= 1 && n <= 4) {
    const PER_OPEN = /\b(no|na|do|da|o|a|para\s+o|para\s+a|at[eé]\s+o)\s*$/i;
    const PER_UNIT = /^\s*(trimestre|semestre|bimestre)\b/i;
    if (PER_OPEN.test(beforeToken) && PER_UNIT.test(afterToken)) return true;
  }

  // P-CELL: posicao de tabela markdown — inteiro nu 1..20 isolado em celula.
  //
  // P-CELL (2026-06-05 gate-seguranca, ADR-008 Camada 4):
  // Isenta numero de posicao de ranking quando TODAS as 4 condicoes valem:
  //   1. Passou TODAS as GN-* (garantido por estar aqui — prioridade absoluta).
  //   2. Borda de celula confirmada: beforeToken termina em "|" (0+ espacos)
  //      E afterToken comeca com (0+ espacos) + "|".
  //   3. Magnitude de posicao: n inteiro, 1 <= n <= 20.
  //      Teto 20 impede volume disfarcado (I-5); classe FECHADA e enumeravel (I-7).
  //   4. Celula sem [ref:] proprio: a sentenca original nao contem "| N [ref:"
  //      (padrao que indica que o inteiro N esta na mesma celula que um [ref:]).
  //      Detectado por busca de padrao, sem usar offsets do string stripped
  //      (evita desalinhamento causado pela remocao dos refs do stripped).
  //
  // Nao e excecao por magnitude generica — nao reabre flanco de contagem (I-5).
  // GN-METRICA (substantivo KPI na janela) continua bloqueando antes deste padrao.
  if (n >= 1 && n <= 20) {
    const isCellLeft = /\|\s*$/.test(beforeToken);
    const isCellRight = /^\s*\|/.test(afterToken);
    if (isCellLeft && isCellRight) {
      // Condicao 4: rejeitar se rawSentence contem "| <n> [ref:" — padrao que
      // indica que este inteiro esta em celula com [ref:] proprio (dado, nao posicao).
      // Celulas de posicao puras sao "| n |"; celulas de dado sao "| n [ref:...]".
      if (rawSentence !== undefined) {
        const cellWithRef = new RegExp(`\\|\\s*${n}\\s+\\[ref:[^\\]]+\\]`);
        if (cellWithRef.test(rawSentence)) return false; // dado, nao posicao
      }
      return true;
    }
  }

  // Nenhum padrao incidental casou — default-deny (EVO-1 + hardening 8.5).
  return false;
}

/**
 * Remove marcadores de enfase markdown (*_, **__, _) do texto, preservando
 * o conteudo interno e os blocos [ref:...].
 *
 * Fix-MD (2026-06-03): marcadores de enfase adjacentes a conectores temporais
 * (ex: "em **2026**", "**julho de 2026**") quebravam a guarda ANO_OPEN porque
 * o "**" entre o conector e o numero impedia o match de /\b(em|de)\s+$/.
 * A solucao mais simples e segura e fazer strip de enfase antes da extracao de
 * numeros, mantendo o texto semantico intacto e sem tocar em [ref:...].
 *
 * Abordagem: substituir marcadores de negrito e italico por espacos, preservando
 * o conteudo interno. Os blocos [ref:...] nao sao afetados porque as regexes de
 * enfase excluem "[" e "]" do grupo de captura.
 *
 * Aplicado APENAS a sentenceForNumbers (para extracao de numeros).
 * O cross-tenant check e a deteccao de refsInSentence usam a sentenca original.
 */
function stripMarkdownEmphasis(text: string): string {
  return (
    text
      // **texto** → " texto " (negrito duplo asterisco)
      .replace(/\*\*([^*[\]]+)\*\*/g, (_match, inner: string) => ` ${inner} `)
      // *texto* → " texto " (italico asterisco simples)
      .replace(/\*([^*[\]]+)\*/g, (_match, inner: string) => ` ${inner} `)
      // __texto__ → " texto " (negrito sublinhado duplo)
      .replace(/__([^_[\]]+)__/g, (_match, inner: string) => ` ${inner} `)
      // _texto_ → " texto " (italico sublinhado simples)
      .replace(/_([^_[\]]+)_/g, (_match, inner: string) => ` ${inner} `)
  );
}

/**
 * Valida o output do LLM contra um conjunto de `sourceRefs` declarados no
 * prompt. Retorna `passed: false` com `rejectionReason` na primeira violacao.
 *
 * @param output texto cru da resposta do LLM
 * @param sourceRefs refs que o ContextBuilder injetou no prompt
 * @param expectedTenantId tenant do request — referencias a outros tenants rejeitam
 */
export function validateLlmOutput(
  output: string,
  sourceRefs: readonly SourceRef[],
  expectedTenantId: string,
  tolerance: number = GROUNDING_TOLERANCE,
): ValidationResult {
  // 1. Cross-tenant sanity — nenhum ref citado pode apontar a tenant diferente.
  // NOTA SEGURANCA: este bloco permanece ANTES do filtro de incidentais (INV-VAL-1 /
  // Security 2026-06-03 SEC-05: a calibracao de numeros incidentais NAO pode tocar
  // o ramo cross-tenant).
  const citedRefIds = new Set<string>();
  for (const m of output.matchAll(SOURCE_REF_RE)) {
    const refId = m[1];
    if (refId !== undefined) citedRefIds.add(refId);
  }
  for (const refId of citedRefIds) {
    const ref = sourceRefs.find((r) => r.id === refId);
    if (ref && ref.tenantId !== expectedTenantId) {
      return {
        passed: false,
        numbersFound: 0,
        numbersValidated: 0,
        rejectionReason: 'cross-tenant-reference',
        rejectionDetail: `ref ${refId} belongs to tenant ${ref.tenantId}, expected ${expectedTenantId}`,
      };
    }
  }

  // 2. Para cada numero no output, checar fonte + grounding.
  // A heuristica F1: cada numero DEVE ter um [ref:...] dentro dos 80 chars
  // seguintes ou em qualquer posicao da mesma sentenca (separadas por . ou \n).
  const sentences = output.split(/(?<=[.\n])\s+/);
  let found = 0;
  let validated = 0;

  for (const sentence of sentences) {
    // Para a contagem de numeros: removemos blocos [ref:...] da sentenca
    // para nao contar digitos dentro do proprio ID do ref (UUIDs contem
    // digitos que gerariam falsos positivos "numero sem fonte"). Os refs
    // ainda sao detectados por uma busca separada na sentenca original.
    //
    // Fix-MD (2026-06-03): aplicar stripMarkdownEmphasis ANTES de remover refs,
    // para que marcadores ** e _ adjacentes a conectores temporais (ex: "em **2026**")
    // nao quebrem as guardas de contexto positivo de P-ANO/P-DATA.
    // O strip e aplicado APENAS aqui — o cross-tenant check e refsInSentence
    // usam `sentence` original, garantindo que SEC-05 permanece intocado.
    const sentenceForNumbers = stripMarkdownEmphasis(sentence).replace(SOURCE_REF_RE, '');
    const numbersInSentence: Array<{ value: number; raw: string }> = [];
    for (const m of sentenceForNumbers.matchAll(NUMBER_RE)) {
      const rawDigit = m[1];
      if (rawDigit === undefined) continue;
      const value = parseNumber(rawDigit, m[2]);
      if (!Number.isFinite(value)) continue;
      // DEFAULT-DENY EVO-1: isIncidentalNumber implementa INV-VAL-1.
      // Guardas negativas (R$, %, separador, metrica, label) tem prioridade absoluta.
      // So isenta se casa padrao incidental FECHADO (P-ANO..P-CELL).
      // P-CONT removido: contagem de lojas exige ref como qualquer KPI.
      // `sentence` (original, com refs) passado como rawSentence para P-CELL condicao 4.
      if (isIncidentalNumber(rawDigit, m[2], m[0], sentenceForNumbers, m.index ?? 0, sentence))
        continue;
      numbersInSentence.push({ value, raw: rawDigit });
    }
    if (numbersInSentence.length === 0) continue;

    const refsInSentence: string[] = [];
    for (const m of sentence.matchAll(SOURCE_REF_RE)) {
      const refId = m[1];
      if (refId !== undefined) refsInSentence.push(refId);
    }

    for (const num of numbersInSentence) {
      found += 1;
      if (refsInSentence.length === 0) {
        return {
          passed: false,
          numbersFound: found,
          numbersValidated: validated,
          rejectionReason: 'number-without-source',
          rejectionDetail: `number ${num.raw} has no [ref:...] marker in the same sentence`,
        };
      }
      // Existe alguma ref na sentenca cujo valor case com num dentro da tolerancia?
      const match = refsInSentence
        .map((id) => sourceRefs.find((r) => r.id === id))
        .find(
          (ref): ref is SourceRef =>
            ref !== undefined && withinTolerance(ref.value, num.value, tolerance),
        );

      if (!match) {
        // Alguma ref existe mas nenhuma bate. Distingue not-in-sources vs out-of-tolerance.
        const anyRefFound = refsInSentence.some((id) => sourceRefs.some((r) => r.id === id));
        if (!anyRefFound) {
          return {
            passed: false,
            numbersFound: found,
            numbersValidated: validated,
            rejectionReason: 'number-not-in-sources',
            rejectionDetail: `refs ${refsInSentence.join(',')} not in sourceRefs for number ${num.raw}`,
          };
        }
        return {
          passed: false,
          numbersFound: found,
          numbersValidated: validated,
          rejectionReason: 'number-out-of-tolerance',
          rejectionDetail: `number ${num.raw} (${num.value}) outside ${tolerance * 100}% of any cited ref`,
        };
      }
      validated += 1;
    }
  }

  return {
    passed: true,
    numbersFound: found,
    numbersValidated: validated,
    rejectionReason: null,
    rejectionDetail: null,
  };
}
