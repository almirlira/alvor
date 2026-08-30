/**
 * @dre/ai
 *
 * Hardening LLM do mktvibe-v2 (ADR-008).
 *
 * **POLITICA VINCULANTE (B.20 D-013):** qualquer provider LLM adotado pelo
 * mktvibe-v2 OBRIGA contrato empresarial com DPA "no training". Nenhuma
 * modalidade gratuita ou sem garantia contratual de que os dados do cliente
 * nao entram em treinamento e aceita. Security-Engineer tem autoridade de
 * veto. Ver ADR-008 §header e docs/.../decisoes-locais.md B.20 D-013.
 *
 * Este package entrega o ESQUELETO hardening em F1 (F1-031 + F1-032):
 *
 *   1. ContextBuilder — aplica scope de papel antes de montar prompt
 *      (fecha R-029, ADR-008 Camada 1)
 *   2. PromptAssembler — separacao estrutural system/user, blocos
 *      `<<<DATA>>>` com source_ref (ADR-008 Camada 2, fecha R-031 parte 1)
 *   3. InputSanitizer — remove padroes adversariais de conteudo externo
 *      (ADR-008 Camada 3, fecha R-031 parte 2)
 *   4. OutputValidator — grounding check com tolerancia de ±0,5% (B.22 D-018)
 *      (ADR-008 Camada 4)
 *   5. LlmAuditLogger — grava `llm_audit_log` estruturado (ADR-008 item 8,
 *      schema ADR-003)
 *   6. Eval suite `llm-authz-boundary` — 11 cenarios que provam as camadas
 *      acima bloqueiam corretamente; gate de CI informational em F1,
 *      bloqueante em F2 (F1-032 + ADR-008 item 7)
 *
 * **F1 nao chama LLM real.** Integracao com provider fica para F2 quando o
 * provider final for escolhido (politica B.20 D-013 vinculante).
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

// Providers (F2 / ADR-010 / B.26 — Claude Sonnet 4.6 via Vertex AI + anthropic-direct piloto)
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
