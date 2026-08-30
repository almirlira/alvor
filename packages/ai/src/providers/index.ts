/**
 * Providers — ponto de entrada do adapter LLM.
 *
 * Factory `createLlmProvider()` seleciona a implementacao concreta com
 * base em `LLM_PROVIDER` do ambiente:
 *
 *   - `vertex-anthropic` (producao) — Claude Opus 5 via Vertex AI
 *   - `mock` (dev local + testes) — determinista, nao chama rede
 *
 * Guard de producao:
 *   - Em `NODE_ENV=production`, `LLM_PROVIDER` TEM que ser
 *     `vertex-anthropic`. Qualquer outro valor e rejeitado (fail-closed).
 *   - O adapter de producao so instancia cliente se SecretStore entregar
 *     service account. Sem secret = erro claro no boot.
 */

import type { LlmProvider } from './provider-interface.js';
import { MockLlmProviderAdapter } from './mock-provider.js';
import {
  VertexAnthropicAdapter,
  type AdapterLogger,
  type SecretStore,
  type VertexClientFactory,
} from './vertex-anthropic-adapter.js';
import { createAnthropicDirectClientFactory } from './anthropic-direct-client-factory.js';

export {
  approximateTokenCount,
  type LlmGenerateOptions,
  type LlmProvider,
  type LlmProviderHealth,
  type LlmResponse,
  type LlmStreamChunk,
  type LlmUsage,
} from './provider-interface.js';

export { MockLlmProviderAdapter, type MockProviderOptions } from './mock-provider.js';

export {
  hasDefaultThinking,
  resolveMaxTokens,
  supportsEffort,
  supportsSamplingParams,
  THINKING_RESERVE_TOKENS,
  type LlmEffort,
} from './model-capabilities.js';

export {
  VertexAnthropicAdapter,
  VertexAdapterError,
  type VertexAnthropicAdapterOptions,
  type VertexAnthropicClient,
  type VertexClientFactory,
  type VertexMessagesRequest,
  type VertexMessagesResponse,
  type AdapterLogger,
  type SecretStore,
} from './vertex-anthropic-adapter.js';

export {
  createRealVertexClientFactory,
  type CreateRealVertexClientFactoryOptions,
  type VertexSdkModule,
  type VertexSdkClient,
  type VertexSdkResponse,
} from './vertex-client-factory.js';

export {
  createAnthropicDirectClientFactory,
  type CreateAnthropicDirectClientFactoryOptions,
  type AnthropicSdkModule,
  type AnthropicSdkClient,
  type AnthropicSdkResponse,
} from './anthropic-direct-client-factory.js';

/** Valores suportados de `LLM_PROVIDER`. */
export type LlmProviderName = 'vertex-anthropic' | 'mock' | 'anthropic-direct';

export interface CreateLlmProviderConfig {
  readonly provider?: LlmProviderName;
  readonly nodeEnv?: string;
  readonly vertex?: {
    readonly project: string;
    readonly region: string;
    readonly model: string;
    readonly secretStore: SecretStore;
    readonly secretName: string;
    readonly clientFactory: VertexClientFactory;
    readonly logger: AdapterLogger;
  };
  readonly mock?: {
    readonly fixedResponse?: string;
    readonly simulatedLatencyMs?: number;
  };
  /**
   * Config para 'anthropic-direct' — API direta da Anthropic (dev/piloto).
   * Exige NODE_ENV != 'production' (fail-closed).
   */
  readonly anthropicDirect?: {
    readonly apiKey: string;
    readonly model: string;
    readonly logger: AdapterLogger;
    readonly sdkLoader?: () => Promise<
      import('./anthropic-direct-client-factory.js').AnthropicSdkModule
    >;
  };
}

/**
 * Factory principal. Resolve o provider selecionado e aplica os guards
 * de producao.
 */
export function createLlmProvider(config: CreateLlmProviderConfig = {}): LlmProvider {
  const nodeEnv = config.nodeEnv ?? process.env['NODE_ENV'] ?? 'development';
  const providerEnv =
    config.provider ?? (process.env['LLM_PROVIDER'] as LlmProviderName | undefined);

  if (nodeEnv === 'production') {
    if (providerEnv !== 'vertex-anthropic') {
      throw new Error(
        `[LLM] fail-closed: em NODE_ENV=production, LLM_PROVIDER deve ser 'vertex-anthropic' ` +
          `(recebido: ${providerEnv ?? 'undefined'}). O provedor de producao exige contrato com garantia de nao-treinamento. ` +
          `Consulte a documentacao do provedor.`,
      );
    }
    if (config.vertex === undefined) {
      throw new Error(
        `[LLM] fail-closed: em producao e obrigatorio passar config.vertex ` +
          `(project, region, model, secretStore, secretName, clientFactory, logger). ` +
          `Consulte a documentacao do provedor.`,
      );
    }
    return new VertexAnthropicAdapter(config.vertex);
  }

  // Fora de producao: default para mock se nao especificado.
  const effective = providerEnv ?? 'mock';

  if (effective === 'vertex-anthropic') {
    if (config.vertex === undefined) {
      throw new Error(
        `[LLM] LLM_PROVIDER=vertex-anthropic exige config.vertex mesmo fora de producao.`,
      );
    }
    return new VertexAnthropicAdapter(config.vertex);
  }

  if (effective === 'anthropic-direct') {
    if (config.anthropicDirect === undefined) {
      throw new Error(
        `[LLM] LLM_PROVIDER=anthropic-direct exige config.anthropicDirect ` +
          `(apiKey, model, logger). Consulte .env.example.`,
      );
    }
    const { apiKey, model, logger, sdkLoader } = config.anthropicDirect;
    const directClientFactory = createAnthropicDirectClientFactory(
      sdkLoader !== undefined ? { sdkLoader } : {},
    );
    const client = directClientFactory({ apiKey });
    // Reusa VertexAnthropicAdapter com client ja instanciado via DI.
    // SecretStore mock retorna string vazia — o client ja esta pronto,
    // o adapter chama ensureClient() que invoca clientFactory({ ... })
    // ignorando os args de project/region/serviceAccountJson neste caso.
    return new VertexAnthropicAdapter({
      project: 'anthropic-direct',
      region: 'anthropic',
      model,
      secretStore: { get: () => Promise.resolve('{}') },
      secretName: 'n/a',
      clientFactory: () => client,
      logger,
      providerName: 'anthropic-direct',
    });
  }

  return new MockLlmProviderAdapter(config.mock ?? {});
}
