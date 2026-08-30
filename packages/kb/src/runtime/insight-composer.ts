/**
 * InsightComposer — assembles structured insights from triggered rules.
 *
 * NO LLM. NO interpolation of tenant values into text fields (C-018-12).
 * Fields hypotheses/recommendations/caveats are LITERAL COPIES of curated blocks.
 * Numbers live ONLY in evidence[] — never in text fields.
 *
 * The LLM (Passo 6, gated) receives this structured output and verbalises it.
 */

import type {
  DiagnosticInput,
  DiagnosticOutput,
  Insight,
  InsightEvidence,
  InsightHypothesis,
  InsightRecommendation,
  StrengthLevel,
  ProblemType,
  RecommendationType,
} from '../types.js';
import type { TriggeredRule } from './rule-engine.js';
import type { KnowledgeRepository } from './knowledge-repository.js';

export class InsightComposer {
  constructor(private readonly repo: KnowledgeRepository) {}

  compose(input: DiagnosticInput, triggeredRules: ReadonlyArray<TriggeredRule>): DiagnosticOutput {
    const maxRecs = input.constraints?.max_recommendations ?? 5;

    // Group triggered rules by primary problem_type
    const grouped = groupByProblemType(triggeredRules);

    const insights: Insight[] = [];
    let insightIdx = 0;

    for (const [problemType, rules] of grouped) {
      // Use the highest-severity rule as the "anchor" for this insight
      const anchor = rules[0];
      if (anchor === undefined) continue;

      const rule = anchor.rule;

      // evidence[] — numbers ONLY, from input.metrics, zero text from KB (C-018-12)
      const evidenceKpiIds = new Set<string>([
        ...(rule.conditions.all ?? []).map((c) => c.metric),
        ...(rule.conditions.any ?? []).map((c) => c.metric),
      ]);
      const evidence: InsightEvidence[] = [];
      for (const m of input.metrics) {
        if (!evidenceKpiIds.has(m.kpi_id)) continue;
        // exactOptionalPropertyTypes: only spread optional fields when defined
        const ev: InsightEvidence = {
          kpi_id: m.kpi_id,
          current_value: m.current_value,
          ...(m.previous_value !== undefined ? { previous_value: m.previous_value } : {}),
          ...(m.delta_percent !== undefined ? { delta_percent: m.delta_percent } : {}),
        };
        evidence.push(ev);
      }

      // hypotheses — LITERAL COPY from curated rule (C-018-12, no interpolation)
      const hypotheses: InsightHypothesis[] = (rule.hypotheses ?? []).map((h) => ({
        text: h.text,
        confidence: h.confidence,
      }));

      // recommendations — LITERAL COPY from curated rule, then playbook actions
      const ruleRecs: InsightRecommendation[] = (rule.recommendations ?? []).map((r) => ({
        priority: 'medium' as const,
        type: 'investigate' as RecommendationType,
        text: r,
      }));

      // related playbooks
      const playbooks = this.repo.findPlaybooksForProblemTypes([problemType]);
      const playbookRecs: InsightRecommendation[] = [];
      for (const pb of playbooks) {
        for (const action of pb.actions) {
          playbookRecs.push({
            priority: action.priority,
            type: action.type,
            text: action.text,
          });
        }
      }

      // Merge and limit recommendations (high priority first)
      const allRecs = [...playbookRecs, ...ruleRecs];
      allRecs.sort((a, b) => {
        const ORDER = { high: 0, medium: 1, low: 2 } as const;
        return ORDER[a.priority] - ORDER[b.priority];
      });
      const recommendations = allRecs.slice(0, maxRecs);

      // caveats — LITERAL COPY (C-018-12)
      const caveats: string[] = [...(rule.caveats ?? [])];
      // Add playbook guardrails as caveats (C-018-11: guardrails propagated)
      for (const pb of playbooks) {
        for (const g of pb.guardrails ?? []) {
          if (!caveats.includes(g)) caveats.push(g);
        }
      }

      // next_data_to_check — from curated evidence_to_check
      const next_data_to_check = [...(rule.evidence_to_check ?? [])];

      // triggered_rules — ids of all rules in this group
      const triggered_rules = rules.map((r) => r.rule.id);

      // related_concepts — by kpi context
      const kpiIds = evidence.map((e) => e.kpi_id);
      const related_concepts = this.repo.findConceptsForKpis(kpiIds).map((c) => c.id);

      // related_playbooks
      const related_playbooks = playbooks.map((pb) => pb.id);

      // severity and confidence: take the worst/best of the group
      const severity = pickSeverity(rules.map((r) => r.severity));
      const confidence = pickConfidence(rules.map((r) => r.confidence));

      const insight: Insight = {
        id: `insight_${String(insightIdx).padStart(3, '0')}`,
        severity,
        confidence,
        problem_type: problemType,
        title: rule.title,
        summary: rule.summary,
        evidence,
        triggered_rules,
        related_concepts,
        related_playbooks,
        hypotheses,
        recommendations,
        caveats,
        next_data_to_check,
      };

      insights.push(insight);
      insightIdx++;
    }

    return {
      analysis_id: input.analysis_id,
      knowledge_base_version: this.repo.version,
      insights,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByProblemType(
  rules: ReadonlyArray<TriggeredRule>,
): Map<ProblemType, TriggeredRule[]> {
  const map = new Map<ProblemType, TriggeredRule[]>();
  for (const r of rules) {
    const pt = r.rule.problem_type[0];
    if (pt === undefined) continue;
    let group = map.get(pt);
    if (group === undefined) {
      group = [];
      map.set(pt, group);
    }
    group.push(r);
  }
  return map;
}

function pickSeverity(severities: readonly StrengthLevel[]): StrengthLevel {
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}

function pickConfidence(confidences: readonly StrengthLevel[]): StrengthLevel {
  if (confidences.includes('high')) return 'high';
  if (confidences.includes('medium')) return 'medium';
  return 'low';
}
