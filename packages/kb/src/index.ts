/**
 * @dre/kb
 *
 * Public API: types + runtime components (knowledge_repository, rule_engine, insight_composer).
 * NO LLM. NO tenant data. NO pgvector. Deterministic V1.
 *
 * Data/IA agent fills content/; compiler generates dist/knowledge_base.json;
 * this module exposes the runtime for consumers (chat-service, report-generator — Passo 6, gated).
 */

export * from './types.js';
export { KnowledgeRepository } from './runtime/knowledge-repository.js';
export { RuleEngine } from './runtime/rule-engine.js';
export { InsightComposer } from './runtime/insight-composer.js';
export { runDiagnostic } from './runtime/diagnostic.js';
