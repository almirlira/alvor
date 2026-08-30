/**
 * anthropic-direct-client-factory.ts
 *
 * Factory que cria um `VertexAnthropicClient` (a mesma interface usada pelo
 * VertexAnthropicAdapter) mas chamando a API direta da Anthropic via
 * `@anthropic-ai/sdk`, sem passar pelo Vertex AI.
 *
 * Por que reusa VertexAnthropicClient:
 *   - O VertexAnthropicAdapter (retry, backoff, timeout, grounding, audit)
 *     aceita qualquer implementacao de `VertexAnthropicClient`. Nao precisamos
 *     duplicar nenhuma dessas logicas.
 *   - Este factory apenas entrega um client com `messagesCreate` que faz a
 *     chamada direta e normaliza a resposta para `VertexMessagesResponse`.
 *
 * Politica:
 *   - Garantia "no training" esta nos termos comerciais da Anthropic (plano
 *     com DPA). Nao existe header por chamada — a garantia vive no contrato.
 *   - Este provider e EXCLUSIVO para dev/piloto. Em NODE_ENV=production
 *     o createLlmProvider rejeita 'anthropic-direct' (fail-closed).
 *
 * Auth:
 *   - API key lida de env ANTHROPIC_API_KEY. Nunca hard-coded.
 *   - Passada via `new Anthropic({ apiKey })` — sem SecretStore porque em
 *     dev/piloto nao ha SecretStore montado.
 *
 * Fix "other side closed" (2026-06-05):
 *   - Causa-raiz: SDK @anthropic-ai/sdk 0.97.1 usa o `fetch` global do
 *     Node.js 20, que por sua vez usa o undici embutido com keep-alive
 *     padrao de ~300s. A Anthropic fecha a conexao TCP-idle muito antes
 *     desse prazo. O undici tenta reusar a conexao morta, resultando em
 *     `SocketError: other side closed` / `fetch failed`.
 *   - Fix: injetar um undici.Agent com `keepAliveTimeout: 5_000` (5s) como
 *     dispatcher via `fetchOptions`. Conexoes ociosas expiram em 5s, antes
 *     de ficarem mortas do lado da Anthropic. Alem disso, `maxRetries: 4`
 *     no SDK (vs default 2) aumenta a janela de recuperacao automatica.
 *   - O caminho de teste com `sdkLoader` fake permanece intacto: quando
 *     sdkLoader fake e injetado, `agentLoader` tambem pode ser substituido
 *     via `options.agentLoader`. O default usa import dinamico de `undici`.
 *
 * Testes:
 *   - Injetar `sdkLoader` fake para zero chamada real.
 *   - Ver anthropic-direct-client-factory.test.ts
 */

import type {
  VertexAnthropicClient,
  VertexMessagesRequest,
  VertexMessagesResponse,
} from './vertex-anthropic-adapter.js';

/** Shape minimo do modulo `@anthropic-ai/sdk` que este factory usa. */
export interface AnthropicSdkModule {
  readonly Anthropic: new (opts: {
    readonly apiKey: string;
    readonly maxRetries?: number;
    readonly fetchOptions?: Record<string, unknown>;
  }) => AnthropicSdkClient;
}

/** Shape minimo do cliente Anthropic SDK. */
export interface AnthropicSdkClient {
  readonly messages: {
    create(
      args: {
        readonly model: string;
        readonly system: string;
        readonly messages: ReadonlyArray<{ readonly role: 'user'; readonly content: string }>;
        readonly max_tokens: number;
        /** Ausente na familia 4.7+ (removido da API; enviar retorna 400). */
        readonly temperature?: number;
        /** `output_config.effort` — so quando o modelo alvo suporta. */
        readonly output_config?: { readonly effort: string };
      },
      options?: { readonly signal?: AbortSignal },
    ): Promise<AnthropicSdkResponse>;
  };
}

export interface AnthropicSdkResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly stop_reason: string | null;
  readonly model: string;
}

/**
 * Shape minimo do undici.Agent que precisamos para configurar keep-alive.
 * Evita dependencia de tipos em `undici` no pacote @dre/ai.
 */
export interface UndiciAgentLike {
  // opaque — so usamos como dispatcher no fetchOptions
  readonly [key: string]: unknown;
}

/** Shape minimo do modulo undici necessario para criar o Agent. */
export interface UndiciModule {
  readonly Agent: new (opts: {
    readonly keepAliveTimeout?: number;
    readonly keepAliveMaxTimeout?: number;
    readonly keepAliveTimeoutThreshold?: number;
    readonly connections?: number;
    readonly pipelining?: number;
  }) => UndiciAgentLike;
}

export interface CreateAnthropicDirectClientFactoryOptions {
  /**
   * Loader do SDK. Default: `await import('@anthropic-ai/sdk')`.
   * Testes injetam um fake para zero dependencia de rede.
   */
  readonly sdkLoader?: () => Promise<AnthropicSdkModule>;

  /**
   * Loader do modulo undici para configurar o dispatcher HTTP.
   * Default: `await import('undici')`.
   * Testes injetam null/undefined para desabilitar o dispatcher customizado.
   * Quando retorna null, o SDK usa o fetch global padrao (sem dispatcher customizado).
   */
  readonly agentLoader?: () => Promise<UndiciModule | null>;

  /**
   * Numero de retries do SDK Anthropic (default: 4).
   * Aumentado de 2 (SDK default) para dar mais margem de recuperacao de
   * erro de conexao dentro do proprio SDK, antes que o adapter externo retente.
   */
  readonly sdkMaxRetries?: number;

  /**
   * Timeout de keep-alive em ms para o undici.Agent (default: 5_000ms).
   * Conexoes ociosas expiram em 5s, eliminando o risco de reusar conexao
   * TCP que a Anthropic fechou no lado do servidor.
   */
  readonly keepAliveTimeoutMs?: number;
}

/**
 * Retorna uma funcao que cria um `VertexAnthropicClient` usando a API
 * direta da Anthropic. A funcao retornada aceita `{ apiKey, model }` — sem
 * project/region/serviceAccountJson (nao aplicaveis a este caminho).
 *
 * Fix "other side closed": injeta um undici.Agent com keepAliveTimeout curto
 * via `fetchOptions.dispatcher` no SDK, eliminando reuso de conexoes mortas.
 */
export function createAnthropicDirectClientFactory(
  options: CreateAnthropicDirectClientFactoryOptions = {},
): (args: { readonly apiKey: string }) => VertexAnthropicClient {
  const sdkLoader = options.sdkLoader ?? defaultSdkLoader;
  const agentLoader = options.agentLoader ?? defaultAgentLoader;
  const sdkMaxRetries = options.sdkMaxRetries ?? 4;
  const keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? 5_000;

  // Cache do modulo SDK — pago uma vez por processo.
  let sdkPromise: Promise<AnthropicSdkModule> | undefined;
  // Cache do agente undici — criado uma vez, compartilhado entre requests.
  // O agent gerencia o pool de conexoes com keepAliveTimeout curto.
  let agentPromise: Promise<UndiciAgentLike | null> | undefined;

  /**
   * Carrega o undici.Agent com keepAliveTimeout configurado.
   * Retorna null se o undici nao estiver disponivel (graceful degradation).
   */
  const getAgent = async (): Promise<UndiciAgentLike | null> => {
    if (agentPromise !== undefined) return agentPromise;
    agentPromise = (async (): Promise<UndiciAgentLike | null> => {
      try {
        const mod = await agentLoader();
        if (mod === null) return null;
        return new mod.Agent({
          // keepAliveTimeout: conexoes ociosas expiram em 5s (vs default ~300s)
          // Anthropic fecha conexoes TCP ociosas antes de 60s — 5s garante
          // que nunca reutilizamos uma conexao que o servidor ja fechou.
          keepAliveTimeout: keepAliveTimeoutMs,
          keepAliveMaxTimeout: keepAliveTimeoutMs * 2,
          // keepAliveTimeoutThreshold: margem de seguranca antes do timeout
          // (default 1000ms — mantemos o default)
          keepAliveTimeoutThreshold: 1_000,
          // pipelining: 0 = sem pipeline (uma request por conexao ativa)
          // Evita ambiguidade de multiplas requests na mesma conexao.
          pipelining: 1,
        });
      } catch {
        // undici nao disponivel — SDK usa fetch global padrao
        return null;
      }
    })();
    return agentPromise;
  };

  return (args: { readonly apiKey: string }): VertexAnthropicClient => {
    let clientPromise: Promise<AnthropicSdkClient> | undefined;

    const getClient = async (): Promise<AnthropicSdkClient> => {
      if (clientPromise !== undefined) return clientPromise;
      clientPromise = (async (): Promise<AnthropicSdkClient> => {
        if (sdkPromise === undefined) sdkPromise = sdkLoader();
        const [mod, agent] = await Promise.all([sdkPromise, getAgent()]);
        const Ctor = mod.Anthropic;
        if (typeof Ctor !== 'function') {
          throw new Error(
            "[anthropic-direct-client-factory] '@anthropic-ai/sdk' nao exporta Anthropic — " +
              'verifique a versao do SDK instalado (esperado >=0.91.1).',
          );
        }

        // Monta fetchOptions com o dispatcher undici quando disponivel.
        // dispatcher e uma extensao undici do RequestInit — seguro passar
        // via Record<string, unknown> porque o SDK repassa ao fetch global.
        const fetchOptions: Record<string, unknown> | undefined =
          agent !== null ? { dispatcher: agent } : undefined;

        return new Ctor({
          apiKey: args.apiKey,
          // maxRetries aumentado: 4 tentativas dentro do SDK, cada uma com
          // backoff exponencial de 0.5-8s. Combinado com os 3 retries do
          // VertexAnthropicAdapter, temos ate 12 tentativas no total antes
          // de desistir — robusto contra falhas transitorias de rede.
          maxRetries: sdkMaxRetries,
          ...(fetchOptions !== undefined ? { fetchOptions } : {}),
        });
      })();
      return clientPromise;
    };

    const client: VertexAnthropicClient = {
      messagesCreate: async (req: VertexMessagesRequest): Promise<VertexMessagesResponse> => {
        const sdk = await getClient();
        const opts: { signal?: AbortSignal } = {};
        if (req.signal !== undefined) {
          opts.signal = req.signal;
        }
        const resp = await sdk.messages.create(
          {
            model: req.model,
            system: req.system,
            messages: req.messages,
            max_tokens: req.max_tokens,
            // Campos condicionais: o adapter ja decidiu o que este modelo
            // aceita (ver model-capabilities.ts). Enviar `temperature:
            // undefined` explicito quebraria a validacao do SDK, entao o
            // campo so entra no objeto quando existe.
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.effort !== undefined ? { output_config: { effort: req.effort } } : {}),
          },
          opts,
        );
        return normalizeResponse(resp);
      },
    };

    return client;
  };
}

function normalizeResponse(resp: AnthropicSdkResponse): VertexMessagesResponse {
  const content = resp.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => ({ type: 'text' as const, text: c.text ?? '' }));
  return {
    content,
    usage: {
      input_tokens: resp.usage.input_tokens,
      output_tokens: resp.usage.output_tokens,
    },
    stop_reason: resp.stop_reason ?? 'end_turn',
    model: resp.model,
  };
}

async function defaultSdkLoader(): Promise<AnthropicSdkModule> {
  try {
    const mod = (await import(/* @vite-ignore */ '@anthropic-ai/sdk' as string)) as unknown;
    if (mod === null || typeof mod !== 'object') {
      throw new Error("modulo '@anthropic-ai/sdk' carregou vazio");
    }
    return mod as AnthropicSdkModule;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[anthropic-direct-client-factory] nao foi possivel carregar '@anthropic-ai/sdk': ${detail}. ` +
        'Instale o SDK (`pnpm add @anthropic-ai/sdk -w`) ou use LLM_PROVIDER=mock em dev.',
    );
  }
}

/**
 * Carrega o modulo `undici` para criar o Agent com keepAliveTimeout curto.
 * Retorna null se o undici nao estiver disponivel — o SDK usa fetch global.
 *
 * Usa dynamic import para nao adicionar `undici` como dependencia hard do
 * pacote @dre/ai. Em Node.js 18+, o undici e embutido no runtime mas
 * nao exportado como 'undici' — importamos como modulo instalado pelo
 * consumidor (a api) que tem undici via dependencias de pg/fastify.
 */
async function defaultAgentLoader(): Promise<UndiciModule | null> {
  try {
    // undici pode estar disponivel como dependencia do projeto api (via pg, fastify, etc.)
    const mod = (await import(/* @vite-ignore */ 'undici' as string)) as unknown;
    if (mod === null || typeof mod !== 'object') return null;
    const rec = mod as Record<string, unknown>;
    if (typeof rec['Agent'] !== 'function') return null;
    return mod as UndiciModule;
  } catch {
    // undici nao disponivel — graceful degradation (SDK usa fetch global)
    return null;
  }
}
