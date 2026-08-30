/**
 * runDiagnostic — top-level entry point (spec §25 pseudocode).
 * Wires KnowledgeRepository + RuleEngine + InsightComposer.
 * NO LLM. NO tenant data written to KB. Deterministic.
 */

import type { DiagnosticInput, DiagnosticOutput } from '../types.js';
import { KnowledgeRepository } from './knowledge-repository.js';
import { RuleEngine } from './rule-engine.js';
import { InsightComposer } from './insight-composer.js';

export function runDiagnostic(input: DiagnosticInput, kbPath?: string): DiagnosticOutput {
  const repo = new KnowledgeRepository(kbPath);
  const engine = new RuleEngine(repo);
  const composer = new InsightComposer(repo);

  const triggeredRules = engine.evaluate(input);
  return composer.compose(input, triggeredRules);
}
