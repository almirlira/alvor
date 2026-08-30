/**
 * model-capabilities.ts — o que cada geracao de modelo Claude aceita no request.
 *
 * Motivacao (Etapa 1 do plano 2026-08-11-plano-ia-opus5-padrao-ouro):
 * a familia Claude 4.7+ (Opus 4.7/4.8/5, Sonnet 5, Fable 5, Mythos) **removeu**
 * os parametros de amostragem. Enviar `temperature` para `claude-opus-5`
 * retorna HTTP 400 e derruba a chamada inteira. Como o modelo e configuravel
 * por env (`ANTHROPIC_MODEL` / `VERTEX_MODEL`), o adapter precisa decidir em
 * runtime o que pode mandar — nao da para deixar isso na mao de cada caller.
 *
 * Este modulo e a UNICA fonte de verdade sobre capacidade de modelo. Os tres
 * callers de LLM da API (chat-ia, reports, analyzer) nao precisam saber nada
 * disso: eles declaram intencao (`temperature`, `maxOutputTokens`, `effort`) e
 * o `VertexAnthropicAdapter` traduz para o que o modelo alvo aceita.
 *
 * Referencia: documentacao oficial Anthropic (migration guide), consultada em
 * 2026-08-11 — secoes "Migrating to Opus 4.7" (remocao de sampling params) e
 * "Migrating to Claude Opus 5" (pensamento ligado por padrao).
 */

/** Normaliza o id do modelo para casamento estavel (Vertex usa o id "puro",
 *  Bedrock prefixa com `anthropic.`). */
function normalize(model: string): string {
  return model.toLowerCase().trim();
}

/**
 * Familia 4.7+ — `temperature`, `top_p` e `top_k` foram REMOVIDOS e retornam
 * 400. Cobre Opus 4.7 / 4.8 / 5, Sonnet 5, Fable 5 e Mythos.
 *
 * Cuidado com o casamento: `opus-4-5` NAO pode casar com `opus-5`. Por isso os
 * alternativos sao ancorados com a geracao completa.
 */
const NO_SAMPLING_PARAMS_RE = /(opus-4-7|opus-4-8|opus-5|sonnet-5|fable-5|mythos)/;

/**
 * Modelos que aceitam `output_config.effort` (GA, sem header beta).
 * Opus 4.5 em diante e Sonnet 4.6 em diante.
 */
const SUPPORTS_EFFORT_RE =
  /(opus-4-5|opus-4-6|opus-4-7|opus-4-8|opus-5|sonnet-4-6|sonnet-5|fable-5|mythos)/;

/**
 * Modelos que **pensam por padrao** quando o request omite `thinking`.
 * O texto do pensamento nao volta na resposta, mas os tokens dele saem do
 * mesmo `max_tokens` da resposta visivel — sem reserva, a resposta ao usuario
 * chega truncada ou vazia.
 */
const DEFAULT_THINKING_RE = /(opus-5|sonnet-5|fable-5|mythos)/;

/**
 * Reserva de tokens para o pensamento, somada ao teto pedido pelo caller
 * quando o modelo pensa por padrao. O caller continua declarando quanto quer
 * de resposta VISIVEL; a reserva e transparente para ele.
 *
 * 4.000 e dimensionado para as tarefas do CROSS (consulta com dados prontos no
 * prompt, effort `low`), com folga sobre o observado. Ajustar aqui, nunca nos
 * callers.
 */
export const THINKING_RESERVE_TOKENS = 4_000;

/** `true` quando o modelo aceita `temperature`/`top_p`/`top_k`. */
export function supportsSamplingParams(model: string): boolean {
  return !NO_SAMPLING_PARAMS_RE.test(normalize(model));
}

/** `true` quando o modelo aceita `output_config.effort`. */
export function supportsEffort(model: string): boolean {
  return SUPPORTS_EFFORT_RE.test(normalize(model));
}

/** `true` quando o modelo pensa por padrao e consome `max_tokens` com isso. */
export function hasDefaultThinking(model: string): boolean {
  return DEFAULT_THINKING_RE.test(normalize(model));
}

/**
 * Teto de tokens efetivo a enviar no request: o que o caller pediu de resposta
 * visivel, mais a reserva de pensamento quando o modelo pensa por padrao.
 */
export function resolveMaxTokens(model: string, requestedVisibleTokens: number): number {
  return hasDefaultThinking(model)
    ? requestedVisibleTokens + THINKING_RESERVE_TOKENS
    : requestedVisibleTokens;
}

/** Niveis validos de `output_config.effort`. */
export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
