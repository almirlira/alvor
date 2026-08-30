/**
 * VertexAnthropicAdapter — producao.
 *
 * **POLITICA VINCULANTE (B.20 D-013):** o Vertex AI Model Garden no projeto
 * `brainora-prod` opera sob DPA enterprise GCP com clausula "no training on
 * customer data". Esta e a UNICA forma autorizada de chamar LLM em producao.
 * Qualquer fallback para API direta da Anthropic exige re-aprovacao formal
 * do owner (ver ADR-010). A politica prende o PROVEDOR, nao o modelo — o
 * modelo oficial e Claude Opus 5 desde 2026-08-11 (B.60 D-056).
 *
 * Ancoragem:
 *   - ADR-008 (LLM hardening) — as camadas 1-4 rodam fora deste adapter
 *   - ADR-010 (provider LLM) — modelo/regiao default
 *   - B.22 D-019 — retencao de `llm_audit_log` = 180 dias
 *   - B.26 — decisao de adocao via Vertex
 *
 * Caracteristicas:
 *   - Auth por Google service account (`gcp-service-account-mktvibe-v2`)
 *     carregada via `SecretStore.get()`
 *   - Modelo default: `claude-opus-5` (desde 2026-08-11 — B.60 D-056;
 *     antes `claude-sonnet-4-6`). A POLITICA de DPA no-training e do
 *     PROVEDOR, nao do modelo — trocar de modelo dentro do mesmo contrato
 *     nao altera B.20 D-013.
 *   - Regiao default: `us-east5` (fallback: `us-central1`)
 *   - Retry com backoff exponencial em 429/5xx (max 3 tentativas)
 *   - Retry stop em 401/403 (erro de auth nao e retriable)
 *   - Timeout hard por chamada (default 30s, override em opts)
 *   - Log estruturado via logger injetado (`@mktvibe/observability`)
 *   - NAO grava audit log diretamente — caller e quem orquestra
 *     `LlmAuditLogger.record()`. Adapter retorna payload que alimenta
 *     o audit.
 *
 * Testes NUNCA chamam Vertex real — SDK e injetado via
 * `VertexClientFactory`, que em testes retorna um fake determinista.
 */

import { setTimeout as delay } from 'node:timers/promises';
import type { LlmMessages } from '../prompt-assembler.js';
import {
  type LlmEffort,
  resolveMaxTokens,
  supportsEffort,
  supportsSamplingParams,
} from './model-capabilities.js';
import {
  approximateTokenCount,
  type LlmGenerateOptions,
  type LlmProvider,
  type LlmProviderHealth,
  type LlmResponse,
  type LlmStreamChunk,
} from './provider-interface.js';

/** Logger duck-typed compativel com `@mktvibe/observability` Logger. */
export interface AdapterLogger {
  readonly info: (obj: unknown, msg?: string) => void;
  readonly warn: (obj: unknown, msg?: string) => void;
  readonly error: (obj: unknown, msg?: string) => void;
  readonly debug: (obj: unknown, msg?: string) => void;
}

/** SecretStore minimo (ADR-007). */
export interface SecretStore {
  get(name: string): Promise<string>;
}

/**
 * Abstracao minima do cliente Vertex/Anthropic — reflete apenas os metodos
 * que o adapter usa. Implementacao de producao sera um wrapper sobre
 * `@anthropic-ai/vertex-sdk`. Implementacao de teste e um fake.
 */
export interface VertexAnthropicClient {
  messagesCreate(req: VertexMessagesRequest): Promise<VertexMessagesResponse>;
}

export interface VertexMessagesRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: ReadonlyArray<{ readonly role: 'user'; readonly content: string }>;
  /** Teto TOTAL do request (resposta visivel + reserva de pensamento). */
  readonly max_tokens: number;
  /**
   * Omitido para a familia 4.7+ (Opus 4.7/4.8/5, Sonnet 5, Fable 5, Mythos),
   * que removeu os parametros de amostragem e responde 400 se receber.
   */
  readonly temperature?: number;
  /** `output_config.effort`. So vai quando o modelo alvo suporta. */
  readonly effort?: LlmEffort;
  readonly signal?: AbortSignal;
}

export interface VertexMessagesResponse {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly stop_reason: string;
  readonly model: string;
}

/**
 * Factory que instancia o cliente real. Injetavel para tests.
 * Recebe credenciais ja decrypted pelo SecretStore.
 */
export type VertexClientFactory = (args: {
  readonly project: string;
  readonly region: string;
  readonly serviceAccountJson: string;
}) => VertexAnthropicClient;

export interface VertexAnthropicAdapterOptions {
  readonly project: string;
  readonly region: string;
  readonly model: string;
  readonly secretStore: SecretStore;
  readonly secretName: string;
  readonly clientFactory: VertexClientFactory;
  readonly logger: AdapterLogger;
  /** Tentativas totais incluindo a primeira. Default 3. */
  readonly maxAttempts?: number;
  /** Backoff base em ms. Default 200ms. */
  readonly backoffBaseMs?: number;
  /** Timeout default por chamada. Default 30000ms. */
  readonly defaultTimeoutMs?: number;
  /** Jitter habilitado. Default true. Testes usam false para determinismo. */
  readonly jitter?: boolean;
  /**
   * Override do nome do provider para telemetria. Default 'vertex-anthropic'.
   * Usado por 'anthropic-direct' para reaproveitamento do adapter sem
   * mudar o contrato LlmProvider.name.
   */
  readonly providerName?: string;
}

/** Erro estruturado com codigo HTTP para decisao de retry. */
export class VertexAdapterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly retriable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VertexAdapterError';
  }
}

export class VertexAnthropicAdapter implements LlmProvider {
  public readonly name: string;

  private readonly project: string;
  private readonly region: string;
  private readonly model: string;
  private readonly secretStore: SecretStore;
  private readonly secretName: string;
  private readonly clientFactory: VertexClientFactory;
  private readonly logger: AdapterLogger;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly jitter: boolean;

  private client: VertexAnthropicClient | undefined;

  constructor(options: VertexAnthropicAdapterOptions) {
    this.name = options.providerName ?? 'vertex-anthropic';
    this.project = options.project;
    this.region = options.region;
    this.model = options.model;
    this.secretStore = options.secretStore;
    this.secretName = options.secretName;
    this.clientFactory = options.clientFactory;
    this.logger = options.logger;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 200;
    // 120s default (era 60s ate 2026-08-11). Baseline medido em 2.060 chamadas
    // reais com Sonnet 4.6: media 8,4s, p95 23,6s, max 43,3s — 60s ja era
    // apertado no pior caso. Modelos que pensam antes de responder (Opus 5 e
    // familia) gastam tempo extra ANTES do primeiro token, entao o teto sobe
    // para 120s. O timeout continua sendo a rede de seguranca, nao o normal.
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.jitter = options.jitter ?? true;
  }

  async generate(messages: LlmMessages, opts?: LlmGenerateOptions): Promise<LlmResponse> {
    const client = await this.ensureClient();
    const model = opts?.model ?? this.model;
    const temperature = opts?.temperature ?? 0.2;
    const visibleTokens = opts?.maxOutputTokens ?? 2048;
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;

    // Traducao intencao-do-caller -> request aceito pelo modelo alvo.
    // O caller declara `temperature`, `maxOutputTokens` (visivel) e `effort`;
    // o que de fato vai no request depende da geracao do modelo configurado
    // em `ANTHROPIC_MODEL` / `VERTEX_MODEL`. Ver model-capabilities.ts.
    //
    //   - familia 4.7+ REMOVEU temperature/top_p/top_k: enviar = HTTP 400
    //   - Opus 5 e familia pensam por padrao e o pensamento sai do mesmo
    //     `max_tokens` da resposta: sem reserva, o usuario recebe texto
    //     truncado ou vazio
    const request: VertexMessagesRequest = {
      model,
      system: messages.system.content,
      messages: messages.user.map((m) => ({ role: 'user' as const, content: m.content })),
      max_tokens: resolveMaxTokens(model, visibleTokens),
      ...(supportsSamplingParams(model) ? { temperature } : {}),
      ...(opts?.effort !== undefined && supportsEffort(model) ? { effort: opts.effort } : {}),
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    };

    const started = Date.now();
    const response = await this.callWithRetry(client, request, timeoutMs);
    const latencyMs = Date.now() - started;

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    // Resposta sem nenhum texto NAO pode seguir em silencio. Acontece quando o
    // classificador de seguranca recusa (`stop_reason: refusal`) ou quando o
    // teto de tokens acabou antes do primeiro token visivel. O validador de
    // grounding aprovaria texto vazio (nao ha numero para conferir) e o usuario
    // receberia uma bolha em branco. Logamos como erro para virar evidencia no
    // audit; quem monta a mensagem ao usuario trata `finishReason`.
    if (text.trim().length === 0) {
      this.logger.error(
        {
          provider: this.name,
          model: response.model,
          region: this.region,
          finishReason: response.stop_reason,
          tokensOut: response.usage.output_tokens,
          maxTokensEnviado: request.max_tokens,
        },
        'llm.generate.empty_text',
      );
    }

    const result: LlmResponse = {
      text,
      usage: {
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
      },
      model: response.model,
      provider: this.name,
      region: this.region,
      latencyMs,
      finishReason: response.stop_reason,
    };

    this.logger.info(
      {
        provider: this.name,
        model: result.model,
        region: this.region,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        latencyMs: result.latencyMs,
        finishReason: result.finishReason,
      },
      'llm.generate.ok',
    );

    return result;
  }

  async *stream(messages: LlmMessages, opts?: LlmGenerateOptions): AsyncIterable<LlmStreamChunk> {
    // F2 minimo: fallback para generate + 1 chunk.
    // Streaming nativo entra em followup quando chat IA (F2-009) precisar.
    const full = await this.generate(messages, opts);
    yield { deltaText: full.text, done: true };
  }

  countTokens(messages: LlmMessages): Promise<number> {
    return Promise.resolve(approximateTokenCount(messages));
  }

  async health(): Promise<LlmProviderHealth> {
    try {
      await this.ensureClient();
      return { status: 'ok', detail: `${this.name} ready in ${this.region}` };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { status: 'unavailable', detail };
    }
  }

  // -----------------------------------------------------------------

  private async ensureClient(): Promise<VertexAnthropicClient> {
    if (this.client !== undefined) {
      return this.client;
    }
    let serviceAccountJson: string;
    try {
      serviceAccountJson = await this.secretStore.get(this.secretName);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { provider: this.name, secretName: this.secretName, detail },
        'llm.provider.secret_unavailable',
      );
      throw new VertexAdapterError(
        `SecretStore nao entregou '${this.secretName}': ${detail}. ` +
          `Fail-closed: adapter '${this.name}' nao pode instanciar cliente sem service account ` +
          `(B.20 D-013 + ADR-007).`,
        undefined,
        false,
        err,
      );
    }
    if (serviceAccountJson.length === 0) {
      throw new VertexAdapterError(
        `SecretStore retornou service account vazia para '${this.secretName}'. Fail-closed.`,
        undefined,
        false,
      );
    }
    this.client = this.clientFactory({
      project: this.project,
      region: this.region,
      serviceAccountJson,
    });
    return this.client;
  }

  private async callWithRetry(
    client: VertexAnthropicClient,
    request: VertexMessagesRequest,
    timeoutMs: number,
  ): Promise<VertexMessagesResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.callOnce(client, request, timeoutMs);
      } catch (err) {
        lastError = err;
        const classified = this.classifyError(err);
        if (!classified.retriable || attempt === this.maxAttempts) {
          this.logger.error(
            {
              provider: this.name,
              attempt,
              statusCode: classified.statusCode,
              retriable: classified.retriable,
              error: classified.message,
            },
            'llm.generate.error',
          );
          throw classified;
        }
        const backoff = this.computeBackoff(attempt);
        this.logger.warn(
          {
            provider: this.name,
            attempt,
            nextBackoffMs: backoff,
            statusCode: classified.statusCode,
          },
          'llm.generate.retry',
        );
        await delay(backoff);
      }
    }
    // Inalcancavel — loop sempre retorna ou lanca antes.
    throw lastError instanceof Error ? lastError : new Error('unreachable');
  }

  private async callOnce(
    client: VertexAnthropicClient,
    request: VertexMessagesRequest,
    timeoutMs: number,
  ): Promise<VertexMessagesResponse> {
    const timer = new AbortController();
    const timeoutHandle = setTimeout(() => timer.abort(), timeoutMs);
    try {
      // Se o caller passou um signal, combinamos com o timeout interno.
      // Simplificacao: o adapter prioriza o proprio timeout e ignora o
      // merge com caller signal — o caller pode usar `opts.timeoutMs`.
      const reqWithSignal: VertexMessagesRequest = {
        ...request,
        signal: timer.signal,
      };
      return await client.messagesCreate(reqWithSignal);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private classifyError(err: unknown): VertexAdapterError {
    if (err instanceof VertexAdapterError) {
      return err;
    }
    const statusCode = this.extractStatusCode(err);
    const message = this.extractMessage(err);

    // 401/403: erro de auth — NAO retriable (B.20 D-013 + ADR-007).
    if (statusCode === 401 || statusCode === 403) {
      return new VertexAdapterError(
        `auth rejeitada (${statusCode}): ${message}`,
        statusCode,
        false,
        err,
      );
    }
    // 429: rate limit — retriable.
    if (statusCode === 429) {
      return new VertexAdapterError(`rate limited (429): ${message}`, statusCode, true, err);
    }
    // 5xx: servidor — retriable.
    if (statusCode !== undefined && statusCode >= 500 && statusCode < 600) {
      return new VertexAdapterError(`upstream ${statusCode}: ${message}`, statusCode, true, err);
    }
    // 4xx nao-auth: request invalido — NAO retriable.
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return new VertexAdapterError(
        `client error ${statusCode}: ${message}`,
        statusCode,
        false,
        err,
      );
    }
    // Erros de rede/timeout/abort: retriable conservador.
    if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
      return new VertexAdapterError(`timeout/abort: ${message}`, undefined, true, err);
    }
    return new VertexAdapterError(`unknown: ${message}`, statusCode, true, err);
  }

  private extractMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err !== null && typeof err === 'object') {
      const rec = err as Record<string, unknown>;
      const m = rec['message'];
      if (typeof m === 'string') return m;
    }
    return String(err);
  }

  private extractStatusCode(err: unknown): number | undefined {
    if (err === null || typeof err !== 'object') return undefined;
    const rec = err as Record<string, unknown>;
    const candidate = rec['status'] ?? rec['statusCode'] ?? rec['code'];
    if (typeof candidate === 'number') return candidate;
    return undefined;
  }

  private computeBackoff(attempt: number): number {
    const base = this.backoffBaseMs * Math.pow(2, attempt - 1);
    if (!this.jitter) return base;
    const jit = Math.floor(Math.random() * this.backoffBaseMs);
    return base + jit;
  }
}
