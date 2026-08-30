/**
 * Real Vertex client factory — wraps `@anthropic-ai/vertex-sdk` into the
 * `VertexAnthropicClient` contract consumed by `VertexAnthropicAdapter`.
 *
 * Por que isso existe separado do adapter:
 *   - O adapter recebe um `VertexClientFactory` por DI para que os testes
 *     possam passar um fake determinista sem bater em Vertex real.
 *   - O factory real precisa do SDK oficial (`@anthropic-ai/vertex-sdk`),
 *     que e uma dependencia opcional em dev: se o dev roda com
 *     `LLM_PROVIDER=mock`, ele nao precisa ter o SDK instalado.
 *   - Por isso usamos `await import(...)` dinamico: so carrega o SDK se
 *     o caller realmente pedir o factory real. Se faltar o pacote, o erro
 *     e explicito e acontece no momento do boot do provider, nao no tc.
 *
 * Politica: o DPA "no training" e inerente ao
 * contrato GCP enterprise usado em `brainora-prod`. Nao existe header por
 * requisicao que liga/desliga treinamento — a garantia vive no contrato
 * comercial. O unico papel do factory e instanciar corretamente o client
 * com a service account certa.
 *
 * Service account:
 *   - Esperamos o JSON string cru entregue pelo SecretStore
 *   - Passamos `credentials` inline via GoogleAuth (google-auth-library)
 *   - NAO persistimos a SA em disco permanente
 */

import type {
  VertexAnthropicClient,
  VertexClientFactory,
  VertexMessagesRequest,
  VertexMessagesResponse,
} from './vertex-anthropic-adapter.js';

/**
 * Shape minimo do modulo exportado por `@anthropic-ai/vertex-sdk`.
 * So usamos `AnthropicVertex` (classe padrao). O SDK tem tipos mais
 * ricos, mas aqui a gente reflete so o que o factory toca.
 */
export interface VertexSdkModule {
  readonly AnthropicVertex: new (opts: {
    readonly projectId: string;
    readonly region: string;
    readonly googleAuth?: unknown;
  }) => VertexSdkClient;
}

/** Shape minimo do cliente do SDK. */
export interface VertexSdkClient {
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
    ): Promise<VertexSdkResponse>;
  };
}

export interface VertexSdkResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly stop_reason: string;
  readonly model: string;
}

/**
 * Shape minimo do modulo `google-auth-library`.
 * So usamos a classe `GoogleAuth`.
 */
export interface GoogleAuthModule {
  readonly GoogleAuth: new (opts: {
    readonly credentials: Record<string, unknown>;
    readonly projectId: string;
    readonly scopes: string;
  }) => unknown;
}

/**
 * Opcoes do loader. Em producao usamos os defaults (dynamic imports reais);
 * em testes podemos injetar loaders fake para evitar dependencias externas.
 */
export interface CreateRealVertexClientFactoryOptions {
  /**
   * Loader do SDK. Default: `await import('@anthropic-ai/vertex-sdk')`.
   * Testes podem injetar um mock que retorna uma classe fake.
   */
  readonly sdkLoader?: () => Promise<VertexSdkModule>;
  /**
   * Loader do google-auth-library. Default: `await import('google-auth-library')`.
   * Testes podem injetar um mock para evitar dependencia real.
   */
  readonly googleAuthLoader?: () => Promise<GoogleAuthModule>;
}

/**
 * Cria o factory real. Retorna uma funcao compativel com
 * `VertexClientFactory` — exatamente o tipo que o `VertexAnthropicAdapter`
 * espera. Lazy: so carrega o SDK quando o factory for invocado.
 */
export function createRealVertexClientFactory(
  options: CreateRealVertexClientFactoryOptions = {},
): VertexClientFactory {
  const sdkLoader = options.sdkLoader ?? defaultSdkLoader;
  const googleAuthLoader = options.googleAuthLoader ?? defaultGoogleAuthLoader;

  // Cache dos modulos — evita pagar import repetido em cold-start de worker.
  let sdkPromise: Promise<VertexSdkModule> | undefined;
  let googleAuthPromise: Promise<GoogleAuthModule> | undefined;

  return (args: {
    readonly project: string;
    readonly region: string;
    readonly serviceAccountJson: string;
  }): VertexAnthropicClient => {
    const credentials = parseServiceAccount(args.serviceAccountJson);
    let clientPromise: Promise<VertexSdkClient> | undefined;

    const getClient = async (): Promise<VertexSdkClient> => {
      if (clientPromise !== undefined) return clientPromise;
      clientPromise = (async (): Promise<VertexSdkClient> => {
        if (sdkPromise === undefined) sdkPromise = sdkLoader();
        if (googleAuthPromise === undefined) googleAuthPromise = googleAuthLoader();

        const [mod, authMod] = await Promise.all([sdkPromise, googleAuthPromise]);

        const Ctor = mod.AnthropicVertex;
        if (typeof Ctor !== 'function') {
          throw new Error(
            "[vertex-client-factory] '@anthropic-ai/vertex-sdk' nao exporta AnthropicVertex — " +
              'verifique a versao do SDK instalado.',
          );
        }

        const GoogleAuth = authMod.GoogleAuth;
        if (typeof GoogleAuth !== 'function') {
          throw new Error(
            "[vertex-client-factory] 'google-auth-library' nao exporta GoogleAuth — " +
              'verifique a versao da biblioteca instalada.',
          );
        }

        // O SDK espera uma INSTANCIA de GoogleAuth, nao um objeto cru.
        // Passar objeto cru causa TypeError: this._auth.getClient is not a function.
        const googleAuth = new GoogleAuth({
          credentials,
          projectId: args.project,
          scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        return new Ctor({
          projectId: args.project,
          region: args.region,
          googleAuth,
        });
      })();
      return clientPromise;
    };

    const client: VertexAnthropicClient = {
      messagesCreate: async (req: VertexMessagesRequest): Promise<VertexMessagesResponse> => {
        const sdk = await getClient();
        const options: { readonly signal?: AbortSignal } = {};
        if (req.signal !== undefined) {
          (options as { signal?: AbortSignal }).signal = req.signal;
        }
        const resp = await sdk.messages.create(
          {
            model: req.model,
            system: req.system,
            messages: req.messages,
            max_tokens: req.max_tokens,
            // Condicionais — ver comentario equivalente em
            // anthropic-direct-client-factory.ts e model-capabilities.ts.
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.effort !== undefined ? { output_config: { effort: req.effort } } : {}),
          },
          options,
        );
        return normalizeResponse(resp);
      },
    };
    return client;
  };
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('service account JSON nao e object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[vertex-client-factory] falha parseando service account JSON: ${detail}. ` +
        'Esperado JSON valido de service account GCP.',
    );
  }
}

function normalizeResponse(resp: VertexSdkResponse): VertexMessagesResponse {
  const content = resp.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => ({ type: 'text' as const, text: c.text ?? '' }));
  return {
    content,
    usage: {
      input_tokens: resp.usage.input_tokens,
      output_tokens: resp.usage.output_tokens,
    },
    stop_reason: resp.stop_reason,
    model: resp.model,
  };
}

async function defaultSdkLoader(): Promise<VertexSdkModule> {
  try {
    // Dynamic import: o typecheck ignora porque e expressao string.
    const mod = (await import(/* @vite-ignore */ '@anthropic-ai/vertex-sdk' as string)) as unknown;
    if (mod === null || typeof mod !== 'object') {
      throw new Error("modulo '@anthropic-ai/vertex-sdk' carregou vazio");
    }
    return mod as VertexSdkModule;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[vertex-client-factory] nao foi possivel carregar '@anthropic-ai/vertex-sdk': ${detail}. ` +
        'Instale o SDK (`pnpm add @anthropic-ai/vertex-sdk -w`) ou use LLM_PROVIDER=mock ' +
        'em dev.',
    );
  }
}

async function defaultGoogleAuthLoader(): Promise<GoogleAuthModule> {
  try {
    const mod = (await import(/* @vite-ignore */ 'google-auth-library' as string)) as unknown;
    if (mod === null || typeof mod !== 'object') {
      throw new Error("modulo 'google-auth-library' carregou vazio");
    }
    return mod as GoogleAuthModule;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[vertex-client-factory] nao foi possivel carregar 'google-auth-library': ${detail}. ` +
        'Instale a biblioteca (`pnpm add google-auth-library -w`) ou use LLM_PROVIDER=mock ' +
        'em dev.',
    );
  }
}
