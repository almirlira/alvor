/**
 * LlmProvider — interface comum de acesso a modelos LLM.
 *
 * **POLITICA VINCULANTE:** qualquer implementacao concreta desta
 * interface OBRIGA contrato DPA "no training" com o provider. Nenhum adapter
 * que nao satisfaca essa condicao pode ser registrado no factory.
 *
 * Decisao de provider oficial: Vertex AI Model Garden no
 * projeto `brainora-prod`. Modelo oficial: **Claude Opus 5** desde 2026-08-11
 *; antes era Claude Sonnet 4.6. A interface e provider-agnostic
 * por design — trocar de provider no futuro significa escrever um novo
 * adapter, nao mudar os callers; trocar de MODELO e so configuracao.
 *
 * O adapter NUNCA bypassa as camadas 1-5 do:
 *   - ContextBuilder ja aplicou scope antes de chamar `assemble()`
 *   - PromptAssembler ja separou system/user e injetou refs
 *   - InputSanitizer ja limpou payload externo
 *   - OutputValidator roda DEPOIS de `generate()` no caller
 *   - LlmAuditLogger grava cada chamada com provider_name, model_version, region
 */

import type { LlmMessages } from '../prompt-assembler.js';
import type { LlmEffort } from './model-capabilities.js';

/** Estado de saude do provider para health-check. */
export type LlmProviderHealth =
  | { readonly status: 'ok'; readonly detail?: string }
  | { readonly status: 'degraded'; readonly detail: string }
  | { readonly status: 'unavailable'; readonly detail: string };

export interface LlmGenerateOptions {
  /** Override de modelo por-chamada. Default vem do adapter. */
  readonly model?: string;
  /**
   * Temperatura. Default conservador (0.2) para grounding estavel.
   * IGNORADA em modelos da familia 4.7+ (Opus 4.7/4.8/5, Sonnet 5, Fable 5,
   * Mythos), que removeram os parametros de amostragem — o adapter descarta
   * o campo antes de montar o request. Ver providers/model-capabilities.ts.
   */
  readonly temperature?: number;
  /**
   * Teto de tokens da resposta **visivel**. Em modelos que pensam por padrao,
   * o adapter soma automaticamente a reserva de pensamento antes de enviar —
   * o caller nunca precisa reservar espaco para isso.
   */
  readonly maxOutputTokens?: number;
  /**
   * Profundidade de raciocinio (`output_config.effort`). Enviado apenas para
   * modelos que suportam; descartado silenciosamente nos demais.
   */
  readonly effort?: LlmEffort;
  /** Timeout hard por chamada (ms). */
  readonly timeoutMs?: number;
  /** Cancelamento cooperativo. */
  readonly signal?: AbortSignal;
}

export interface LlmUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export interface LlmResponse {
  /** Texto bruto do modelo — ainda passa pelo OutputValidator. */
  readonly text: string;
  readonly usage: LlmUsage;
  readonly model: string;
  readonly provider: string;
  readonly region: string;
  /** Latencia medida pelo adapter em ms. */
  readonly latencyMs: number;
  /** `stop`, `max_tokens`, `error` etc. */
  readonly finishReason: string;
}

/** Chunk incremental para streaming. */
export interface LlmStreamChunk {
  readonly deltaText: string;
  readonly done: boolean;
}

/**
 * Contrato minimo de um provider LLM. Implementacoes concretas:
 *   - VertexAnthropicAdapter (producao)
 *   - MockLlmProviderAdapter (dev local + testes)
 */
export interface LlmProvider {
  /** Nome estavel para telemetria (ex: "vertex-anthropic", "mock"). */
  readonly name: string;

  /** Gera resposta sincrona (non-streaming). */
  generate(messages: LlmMessages, opts?: LlmGenerateOptions): Promise<LlmResponse>;

  /** Streaming incremental. Adapter pode fallback para generate+chunk unico. */
  stream(messages: LlmMessages, opts?: LlmGenerateOptions): AsyncIterable<LlmStreamChunk>;

  /**
   * Estimativa de tokens do payload inteiro. NAO precisa ser exato —
   * aproximacao via tamanho de string e suficiente para rate limiting
   * e telemetria. Chamadas reais ao tokenizer do provider sao opcionais.
   */
  countTokens(messages: LlmMessages): Promise<number>;

  /** Health check leve. Nao faz chamada completa ao modelo. */
  health(): Promise<LlmProviderHealth>;
}

/**
 * Aproximacao universal de contagem de tokens: ~4 caracteres por token
 * em ingles/portugues para modelos baseados em BPE. Suficiente para
 * telemetria e rate limit; adapters concretos podem sobrescrever com
 * chamada real ao tokenizer se precisarem de precisao.
 */
export function approximateTokenCount(messages: LlmMessages): number {
  let chars = messages.system.content.length;
  for (const m of messages.user) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}
