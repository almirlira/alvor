/**
 * RuleEngine — deterministic evaluation of diagnostic_rule conditions
 * over a DiagnosticInput payload.
 *
 * Scope V1 (data-model §9):
 *   Operators: increased | decreased | stable | above_target | below_target |
 *              missing | present | greater_than | less_than
 *   Comparisons: previous_period | target (ONLY)
 *   Severity: heuristic 3-band (low/medium/high) by abs(delta) × funnel-weight
 *   Confidence: counting heuristic (spec §16.5)
 *
 * DEFERIDO: same_period_last_year, benchmark, segment_average,
 *            fine-grained multiplicative weights (spec §16.4 full).
 */

import type {
  DiagnosticInput,
  DiagnosticRule,
  MetricInput,
  StrengthLevel,
  RuleCondition,
} from '../types.js';
import type { KnowledgeRepository } from './knowledge-repository.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface TriggeredRule {
  readonly rule: DiagnosticRule;
  readonly severity: StrengthLevel;
  readonly confidence: StrengthLevel;
  /** Metrics that directly satisfied the conditions. */
  readonly matched_metrics: readonly string[];
}

// ---------------------------------------------------------------------------
// Heuristic severity weights by funnel stage (spec §16.4 simplified)
// FUNNEL_WEIGHT by stage is available for future use when KpiItem context
// is passed to computeSeverity. For V1, we infer weight from kpi_id.
// ---------------------------------------------------------------------------

function funnelWeightForKpi(kpiId: string): number {
  // Heuristic: infer from kpi_id substring (deterministic; no LLM)
  if (/conversion|cpa|cac|sales|revenue|roas|margin|ltv/.test(kpiId)) return 1.5;
  if (/retention|churn|repeat|ltv/.test(kpiId)) return 1.4;
  if (/lead|checkout|cart/.test(kpiId)) return 1.2;
  if (/session|click|cpc|cpl/.test(kpiId)) return 1.0;
  if (/impression|reach|frequency|cpm|ctr/.test(kpiId)) return 0.8;
  return 1.0;
}

function computeSeverity(
  matchedMetrics: readonly string[],
  input: Pick<DiagnosticInput, 'metrics'>,
): StrengthLevel {
  const metricMap = buildMetricMap(input.metrics);
  let maxScore = 0;

  for (const kpiId of matchedMetrics) {
    const m = metricMap.get(kpiId);
    if (m === undefined) continue;
    const absDelta = Math.abs(m.delta_percent ?? 0);
    const w = funnelWeightForKpi(kpiId);
    const score = absDelta * w;
    if (score > maxScore) maxScore = score;
  }

  if (maxScore >= 30) return 'high';
  if (maxScore >= 10) return 'medium';
  return 'low';
}

function computeConfidence(
  matchedMetrics: readonly string[],
  _input: Pick<DiagnosticInput, 'metrics'>,
): StrengthLevel {
  // spec §16.5 heuristic:
  // high = 3+ consistent KPIs + revenue/conversion data present
  // medium = 2 KPIs
  // low = 1 signal or incomplete data
  const hasRevenueOrConversion = matchedMetrics.some((id) =>
    /conversion|revenue|roas|cac|ltv|sales/.test(id),
  );
  const count = matchedMetrics.length;

  if (count >= 3 && hasRevenueOrConversion) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Metric normalisation
// ---------------------------------------------------------------------------

function buildMetricMap(metrics: readonly MetricInput[]): Map<string, MetricInput> {
  const map = new Map<string, MetricInput>();
  for (const m of metrics) {
    map.set(m.kpi_id, m);
  }
  return map;
}

function inferDeltaPercent(m: MetricInput): number {
  if (m.delta_percent !== undefined) return m.delta_percent;
  if (m.previous_value !== undefined && m.previous_value !== 0) {
    return ((m.current_value - m.previous_value) / Math.abs(m.previous_value)) * 100;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(cond: RuleCondition, metricMap: Map<string, MetricInput>): boolean {
  const metric = metricMap.get(cond.metric);

  // missing / present operators
  if (cond.operator === 'missing') return metric === undefined;
  if (cond.operator === 'present') return metric !== undefined;

  if (metric === undefined) return false;

  const delta = inferDeltaPercent(metric);
  const threshold = cond.threshold_percent ?? 5; // default 5%

  switch (cond.operator) {
    case 'increased':
      return delta >= threshold;
    case 'decreased':
      return delta <= -threshold;
    case 'stable':
      return Math.abs(delta) < threshold;
    case 'above_target': {
      if (metric.target_value === undefined) return false;
      const tv = cond.threshold_value ?? 0;
      return metric.current_value > metric.target_value + tv;
    }
    case 'below_target': {
      if (metric.target_value === undefined) return false;
      const tv = cond.threshold_value ?? 0;
      return metric.current_value < metric.target_value - tv;
    }
    case 'greater_than': {
      const tv = cond.threshold_value ?? 0;
      return metric.current_value > tv;
    }
    case 'less_than': {
      const tv = cond.threshold_value ?? 0;
      return metric.current_value < tv;
    }
  }
}

function evaluateRule(rule: DiagnosticRule, metricMap: Map<string, MetricInput>): boolean {
  const conds = rule.conditions;

  const allOk = !conds.all || conds.all.every((c) => evaluateCondition(c, metricMap));

  const anyOk =
    !conds.any || conds.any.length === 0 || conds.any.some((c) => evaluateCondition(c, metricMap));

  return allOk && anyOk;
}

function collectMatchedMetrics(
  rule: DiagnosticRule,
  metricMap: Map<string, MetricInput>,
): string[] {
  const matched = new Set<string>();

  const addIf = (c: RuleCondition): void => {
    if (metricMap.has(c.metric)) matched.add(c.metric);
  };

  (rule.conditions.all ?? []).forEach(addIf);
  (rule.conditions.any ?? []).forEach(addIf);

  return [...matched];
}

// ---------------------------------------------------------------------------
// Public RuleEngine
// ---------------------------------------------------------------------------

export class RuleEngine {
  constructor(private readonly repo: KnowledgeRepository) {}

  evaluate(input: DiagnosticInput): ReadonlyArray<TriggeredRule> {
    const metricMap = buildMetricMap(input.metrics);
    const activeRules = this.repo.getActiveRules();
    const triggered: TriggeredRule[] = [];

    for (const rule of activeRules) {
      if (!evaluateRule(rule, metricMap)) continue;

      const matched = collectMatchedMetrics(rule, metricMap);
      const severity = computeSeverity(matched, input);
      const confidence = computeConfidence(matched, input);

      triggered.push({ rule, severity, confidence, matched_metrics: matched });
    }

    // Sort: high severity first, then medium, then low
    const ORDER: Record<StrengthLevel, number> = { high: 0, medium: 1, low: 2 };
    triggered.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

    return triggered;
  }
}
