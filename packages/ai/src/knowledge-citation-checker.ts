/**
 * Knowledge Citation Checker.3, Passo 6 fio 1.
 *
 * Segunda camada de grounding: verifica que cada marcador `[kb:ID]` citado
 * pelo LLM pertence ao conjunto de blocos de conhecimento EFETIVAMENTE
 * injetados no prompt — nao basta existir na base; tem que ter sido injetado,
 * senao o LLM "lembrou" um id de treinamento.
 *
 * ## Separacao estrutural
 *
 * O namespace `[kb:ID]` e distinto do `[ref:ID]` do output-validator.
 * `KB_REF_RE` nao casa `[ref:...]` e `SOURCE_REF_RE` do output-validator nao
 * casa `[kb:...]`. As duas camadas sao independentes e compostas em serie pelo
 * caller.
 *
 * ## O que este modulo NAO faz
 *
 * - Nao inspeciona numeros (responsabilidade do output-validator, INTOCADO).
 * - Nao faz NLP, embeddings ou RAG — set-membership simples de ids.
 * - Nao altera nem importa `output-validator.ts`.
 *
 * ## Contrato de interface (fixo — Backend programa contra isto)
 *
 * ```
 * export interface KnowledgeBlock { kbId: string; body: string }
 * export interface KnowledgeCheckResult {
 *   passed: boolean;
 *   reason?: 'unknown_kb_id' | 'ok';
 *   citedKbIds: string[];
 * }
 * export function checkKnowledgeCitations(
 *   text: string,
 *   injectedKbIds: string[],
 * ): KnowledgeCheckResult
 * ```
 *
 * ## Controles cobertos
 *
 * -: zero diff em output-validator.ts (este modulo e arquivo NOVO)
 * -: KB_REF_RE e SOURCE_REF_RE nao colidem por design
 * -: [kb:ID] nao-injetado => passed: false, razao 'unknown_kb_id'
 */

/**
 * Bloco de conhecimento curado — trecho da base marketing-kb a ser injetado
 * no prompt via PromptAssembler no bloco <<<KNOWLEDGE>>>.
 *
 * `kbId` e o identificador unico do item na base (ex: "kpi.roas", "4p.promocao",
 * "rule.ctr_down_cpc_up"). `body` e o texto curado a ser injetado.
 *
 * Invariantes:
 *   - `body` nunca contem numero apresentavel como metrica do cliente.
 *   - `body` nunca contem delimitadores `<<<DATA>>>` / `<<<KNOWLEDGE>>>`.
 *   - `kbId` nao colide com ids do `sourceRefs` de dado de tenant.
 */
export interface KnowledgeBlock {
  readonly kbId: string;
  readonly body: string;
}

/**
 * Resultado da verificacao de citacoes de conhecimento.
 *
 * `passed: true`  — todos os `[kb:ID]` citados pertencem ao conjunto injetado.
 * `passed: false` — pelo menos um `[kb:ID]` nao foi injetado (unknown_kb_id).
 *
 * `citedKbIds` lista TODOS os ids extraidos do texto, inclusive os invalidos,
 * para rastreabilidade no llm_audit_log.
 */
export interface KnowledgeCheckResult {
  readonly passed: boolean;
  /** Razao da falha ou confirmacao de sucesso. Undefined quando passed e true. */
  readonly reason?: 'unknown_kb_id' | 'ok';
  /** Todos os ids [kb:...] encontrados no texto — para audit log. */
  readonly citedKbIds: readonly string[];
}

/**
 * Regex que captura marcadores `[kb:ID]` no output do LLM.
 *
 * ## Separacao de namespace
 *
 * Esta regex captura SOMENTE `[kb:...]` — nunca `[ref:...]`.
 * O `SOURCE_REF_RE` do output-validator captura SOMENTE `[ref:...]` — nunca `[kb:...]`.
 * Os dois namespaces sao mutuamente exclusivos por construcao textual:
 *   - `[kb:` inicia com a letra "k" apos "[", impossivel de ser `[ref:`.
 *   - `[ref:` inicia com a letra "r" apos "[", impossivel de ser `[kb:`.
 *
 * Formato esperado: `[kb:IDENTIFICADOR]` onde IDENTIFICADOR e uma string
 * alfanumerica com pontos e hifens (ex: "kpi.roas", "4p.promocao",
 * "rule.ctr_down_cpc_up", "playbook.cac_alto").
 */
export const KB_REF_RE = /\[kb:([^\]]+)\]/g;

/**
 * Verifica que todos os marcadores `[kb:ID]` no texto do LLM foram EFETIVAMENTE
 * injetados no prompt como blocos `<<<KNOWLEDGE>>>`.
 *
 * Algoritmo (set-membership simples, anti-overengineering Addendum A.5):
 *   1. Extrai todos os `[kb:ID]` do texto via KB_REF_RE.
 *   2. Para cada ID extraido, verifica pertencimento ao set de `injectedKbIds`.
 *   3. Primeiro ID fora do set => passed: false, reason: 'unknown_kb_id'.
 *   4. Todos no set (ou nenhum citado) => passed: true, reason: 'ok'.
 *
 * ## Por que "injetado" e a condicao correta
 *
 * Nao basta que o ID exista na base de conhecimento — o LLM poderia ter
 * "lembrado" um id de treinamento sem o trecho ter sido injetado neste
 * request especifico. Exigir injecao efetiva impede esse vetor.
 *
 * ## Comportamento com texto sem [kb:] (sem conhecimento injetado)
 *
 * Se `injectedKbIds` esta vazio e o texto nao cita nenhum `[kb:]`, retorna
 * `passed: true` — nao ha violacao. Se `injectedKbIds` esta vazio mas o
 * texto cita `[kb:X]`, retorna `passed: false` (o LLM inventou uma citacao).
 *
 * @param text Texto cru da resposta do LLM.
 * @param injectedKbIds IDs dos blocos KnowledgeBlock efetivamente injetados
 *   pelo PromptAssembler neste request.
 */
export function checkKnowledgeCitations(
  text: string,
  injectedKbIds: readonly string[],
): KnowledgeCheckResult {
  const injectedSet = new Set(injectedKbIds);
  const citedKbIds: string[] = [];

  // Extrair todos os [kb:ID] do texto.
  for (const match of text.matchAll(KB_REF_RE)) {
    const kbId = match[1];
    if (kbId !== undefined) {
      citedKbIds.push(kbId);
    }
  }

  // Set-membership: primeiro ID fora do conjunto injetado => falha.
  for (const kbId of citedKbIds) {
    if (!injectedSet.has(kbId)) {
      return {
        passed: false,
        reason: 'unknown_kb_id',
        citedKbIds,
      };
    }
  }

  return {
    passed: true,
    reason: 'ok',
    citedKbIds,
  };
}
