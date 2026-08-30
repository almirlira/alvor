/**
 * @dre/ai — hardening de LLM do ALVOR.
 *
 * Cinco camadas entre o dado do cliente e a resposta do modelo. Nenhuma
 * resposta chega a tela sem passar por todas:
 *
 *   1. ContextBuilder  — aplica o escopo do papel do usuario antes de montar
 *                        o prompt: o modelo so ve o que aquele papel pode ver.
 *   2. PromptAssembler — separa system de user e entrega o dado do cliente em
 *                        blocos `<<<DATA>>>` delimitados, cada um com a sua
 *                        referencia citavel.
 *   3. InputSanitizer  — limpa padroes adversariais no conteudo que veio de
 *                        fonte externa (uma planilha pode conter instrucoes).
 *   4. OutputValidator — o guardiao: todo numero na resposta precisa de fonte
 *                        declarada, com valor batendo dentro de 0,5%. Sem
 *                        fonte, fora da tolerancia ou de outro cliente, a
 *                        resposta e rejeitada.
 *   5. LlmAuditLogger  — registra cada chamada (modelo, tokens, hashes,
 *                        veredito do guardiao) para auditoria posterior.
 *
 * O provedor e injetado, nunca instanciado aqui: em teste roda um mock e
 * nenhuma chamada real acontece.
 *
 * Politica de provedor: so e aceito provedor com contrato que garanta que o
 * dado do cliente nao entra em treinamento de modelo.
 */

export {
  ContextBuilder,
  type ActiveRole,
  type ContextRequest,
  type ContextRepository,
  type ConversationHints,
  type DataItemEntity,
  type FallbackReason,
  type IntentScope,
  type Membership,
  type SanitizedContext,
  type ScopedDataItem,
} from './context-builder.js';

export {
  PromptAssembler,
  type AssembleOptions,
  type LlmMessage,
  type LlmMessages,
} from './prompt-assembler.js';

export {
  checkKnowledgeCitations,
  KB_REF_RE,
  type KnowledgeBlock,
  type KnowledgeCheckResult,
} from './knowledge-citation-checker.js';

export {
  sanitizeExternalPayload,
  INJECTION_PATTERNS,
  MAX_ITEM_CHARS,
  ANOMALY_THRESHOLD_CHARS,
  type SanitizeResult,
} from './input-sanitizer.js';

export {
  validateLlmOutput,
  GROUNDING_TOLERANCE,
  type SourceRef,
  type SourceClassification,
  type RejectionReason,
  type ValidationResult,
} from './output-validator.js';

export {
  LlmAuditLogger,
  type AuditDb,
  type AuditLogEntry,
  type AuditPayload,
} from './llm-audit-logger.js';

// Providers
export {
  createLlmProvider,
  createRealVertexClientFactory,
  createAnthropicDirectClientFactory,
  MockLlmProviderAdapter,
  VertexAnthropicAdapter,
  VertexAdapterError,
  approximateTokenCount,
  hasDefaultThinking,
  resolveMaxTokens,
  supportsEffort,
  supportsSamplingParams,
  THINKING_RESERVE_TOKENS,
  type LlmEffort,
  type CreateLlmProviderConfig,
  type LlmProvider,
  type LlmProviderName,
  type LlmProviderHealth,
  type LlmResponse,
  type LlmStreamChunk,
  type LlmGenerateOptions,
  type LlmUsage,
  type VertexAnthropicAdapterOptions,
  type VertexAnthropicClient,
  type VertexClientFactory,
  type VertexMessagesRequest,
  type VertexMessagesResponse,
  type AdapterLogger,
  type SecretStore,
  type MockProviderOptions,
  type CreateRealVertexClientFactoryOptions,
  type VertexSdkModule,
  type VertexSdkClient,
  type VertexSdkResponse,
  type CreateAnthropicDirectClientFactoryOptions,
  type AnthropicSdkModule,
  type AnthropicSdkClient,
  type AnthropicSdkResponse,
} from './providers/index.js';
