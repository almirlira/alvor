/**
 * Types for the marketing-kb package.
 * Contracts defined in data-model-kb.md v2 + spec §14-15 + spec §25.
 *
 * NO LLM dependency. NO tenant data. Global, versioned, deterministic.
 */

// ---------------------------------------------------------------------------
// Base item fields (data-model §1, spec §8)
// ---------------------------------------------------------------------------

export type ItemStatus = 'draft' | 'reviewed' | 'approved' | 'deprecated';
export type Language = 'pt-BR';
export type FourPs = 'product' | 'price' | 'place' | 'promotion';
export type FunnelStage =
  | 'awareness'
  | 'interest'
  | 'consideration'
  | 'conversion'
  | 'revenue'
  | 'retention'
  | 'advocacy';
export type KpiCategory =
  | 'acquisition'
  | 'media'
  | 'traffic'
  | 'engagement'
  | 'conversion'
  | 'revenue'
  | 'efficiency'
  | 'retention'
  | 'crm'
  | 'brand'
  | 'content';
export type ProblemType =
  | 'low_ctr'
  | 'high_cpc'
  | 'high_cpm'
  | 'low_conversion'
  | 'high_cpa'
  | 'high_cac'
  | 'low_roas'
  | 'low_revenue'
  | 'low_average_ticket'
  | 'high_churn'
  | 'low_retention'
  | 'low_engagement'
  | 'traffic_drop'
  | 'unqualified_traffic'
  | 'growth_without_profitability'
  | 'channel_saturation';
export type RecommendationType =
  | 'investigate'
  | 'optimize_campaign'
  | 'adjust_budget'
  | 'adjust_audience'
  | 'revise_creative'
  | 'revise_offer'
  | 'improve_landing_page'
  | 'adjust_pricing'
  | 'improve_tracking'
  | 'run_experiment'
  | 'improve_retention'
  | 'review_channel_mix'
  | 'improve_content'
  | 'analyze_margin';
export type RelationType =
  | 'explains'
  | 'influences'
  | 'correlates_with'
  | 'should_be_analyzed_with'
  | 'is_part_of'
  | 'maps_to'
  | 'triggers'
  | 'recommends'
  | 'warns_about';
export type StrengthLevel = 'low' | 'medium' | 'high';
export type CausalityLevel = 'hypothesis' | 'probable' | 'certain';

export interface BaseItem {
  readonly id: string;
  readonly type: 'concept' | 'kpi' | 'diagnostic_rule' | 'playbook' | 'relation' | 'taxonomy';
  readonly title: string;
  readonly slug: string;
  readonly status: ItemStatus;
  readonly version: string;
  readonly language: Language;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly four_ps?: readonly FourPs[];
  readonly funnel_stage?: readonly FunnelStage[];
  readonly kpi_category?: readonly KpiCategory[];
  readonly related_items?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly owner: string;
  readonly reviewed_by?: string | null;
  readonly notes?: string | null;
}

// ---------------------------------------------------------------------------
// Concept (data-model §2, spec §9)
// ---------------------------------------------------------------------------

export interface Concept extends BaseItem {
  readonly type: 'concept';
  readonly is_framework?: boolean;
  readonly definition?: string;
  readonly why_it_matters?: string;
  readonly related_kpis?: readonly string[];
  readonly related_concepts?: readonly string[];
  readonly diagnostic_use?: readonly string[];
  readonly decision_use?: readonly string[];
  readonly caveats?: readonly string[];
  readonly components?: readonly string[];
  readonly when_to_apply?: string;
  readonly p_ancora?: FourPs;
}

// ---------------------------------------------------------------------------
// KPI (data-model §3, spec §10)
// ---------------------------------------------------------------------------

export interface KpiInterpretation {
  readonly high?: string;
  readonly low?: string;
  readonly rising?: string;
  readonly falling?: string;
}

export interface KpiItem extends BaseItem {
  readonly type: 'kpi';
  readonly aliases?: readonly string[];
  readonly category: readonly KpiCategory[];
  readonly unit?: string;
  readonly formula: string;
  readonly formula_pt?: string;
  readonly description?: string;
  readonly business_question?: string;
  readonly data_sources?: readonly string[];
  readonly dimensions?: readonly string[];
  readonly interpretation?: KpiInterpretation;
  readonly related_kpis?: readonly string[];
  readonly leading_or_lagging?: 'leading' | 'lagging';
  readonly diagnostic_roles?: readonly string[];
  readonly caveats?: readonly string[];
  readonly recommended_actions?: readonly string[];
  readonly p_ancora?: FourPs;
}

// ---------------------------------------------------------------------------
// Diagnostic Rule (data-model §4, spec §11)
// ---------------------------------------------------------------------------

export type ConditionOperator =
  | 'increased'
  | 'decreased'
  | 'stable'
  | 'above_target'
  | 'below_target'
  | 'missing'
  | 'present'
  | 'greater_than'
  | 'less_than';

export type ConditionComparison = 'previous_period' | 'target';

export interface RuleCondition {
  readonly metric: string;
  readonly operator: ConditionOperator;
  readonly comparison?: ConditionComparison;
  readonly threshold_percent?: number;
  readonly threshold_value?: number;
}

export interface RuleConditions {
  readonly all?: readonly RuleCondition[];
  readonly any?: readonly RuleCondition[];
}

export interface Hypothesis {
  readonly id: string;
  readonly text: string;
  readonly confidence: StrengthLevel;
  readonly related_four_ps?: readonly FourPs[];
}

export interface OutputStyle {
  readonly tone?: 'advisory' | 'informational' | 'warning';
  readonly causality_level: CausalityLevel;
}

export interface DiagnosticRule extends BaseItem {
  readonly type: 'diagnostic_rule';
  readonly problem_type: readonly ProblemType[];
  readonly conditions: RuleConditions;
  readonly required_context?: readonly string[];
  readonly recommended_dimensions?: readonly string[];
  readonly hypotheses?: readonly Hypothesis[];
  readonly recommendations?: readonly string[];
  readonly evidence_to_check?: readonly string[];
  readonly caveats?: readonly string[];
  readonly output_style?: OutputStyle;
}

// ---------------------------------------------------------------------------
// Playbook (data-model §5, spec §12)
// ---------------------------------------------------------------------------

export interface PlaybookAction {
  readonly priority: 'high' | 'medium' | 'low';
  readonly type: RecommendationType;
  readonly text: string;
}

export interface Playbook extends BaseItem {
  readonly type: 'playbook';
  readonly problem_type: readonly ProblemType[];
  readonly when_to_use?: readonly string[];
  readonly related_kpis?: readonly string[];
  readonly diagnostic_questions?: readonly string[];
  readonly actions: readonly PlaybookAction[];
  readonly guardrails?: readonly string[];
  readonly success_metrics?: readonly string[];
}

// ---------------------------------------------------------------------------
// Relation (data-model §6, spec §13)
// ---------------------------------------------------------------------------

export interface Relation extends BaseItem {
  readonly type: 'relation';
  readonly from: string;
  readonly to: string;
  readonly relation_type: RelationType;
  readonly strength?: StrengthLevel;
  readonly description?: string;
  readonly directional?: boolean;
  readonly caveat?: string;
}

// ---------------------------------------------------------------------------
// Taxonomy (data-model §7, spec §7)
// ---------------------------------------------------------------------------

export interface TaxonomyValue {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface TaxonomyItem extends BaseItem {
  readonly type: 'taxonomy';
  readonly values: readonly TaxonomyValue[];
}

// ---------------------------------------------------------------------------
// Manifest (data-model §0)
// ---------------------------------------------------------------------------

export interface KbManifest {
  readonly kb_version: string;
  readonly language: Language;
  readonly escopo: string;
  readonly tipos: readonly string[];
  readonly teto_blocos_por_prompt: number;
  readonly teto_palavras_por_corpo: number;
}

// ---------------------------------------------------------------------------
// KnowledgeBase (compiled output)
// ---------------------------------------------------------------------------

export type KbItem = Concept | KpiItem | DiagnosticRule | Playbook | Relation | TaxonomyItem;

export interface KnowledgeBase {
  readonly manifest: KbManifest;
  readonly items: readonly KbItem[];
  readonly compiled_at: string;
}

// ---------------------------------------------------------------------------
// Diagnostic Input / Output (data-model §8, spec §14-15, §25)
// ---------------------------------------------------------------------------

export interface MetricInput {
  readonly kpi_id: string;
  readonly current_value: number;
  readonly previous_value?: number;
  readonly target_value?: number;
  readonly delta_percent?: number;
  readonly trend?: 'up' | 'down' | 'stable';
}

export interface BusinessContext {
  readonly business_model?: string;
  readonly industry?: string;
  readonly primary_goal?: string;
  readonly currency?: string;
}

export interface DiagnosticPeriod {
  readonly current_start: string;
  readonly current_end: string;
  readonly comparison_start?: string;
  readonly comparison_end?: string;
}

export interface DiagnosticConstraints {
  readonly avoid_causality_claims?: boolean;
  readonly max_recommendations?: number;
  readonly language?: Language;
}

export interface DiagnosticInput {
  readonly analysis_id: string;
  readonly business_context?: BusinessContext;
  readonly period: DiagnosticPeriod;
  readonly metrics: readonly MetricInput[];
  readonly dimensions?: Readonly<Record<string, readonly string[]>>;
  readonly constraints?: DiagnosticConstraints;
}

export interface InsightEvidence {
  readonly kpi_id: string;
  readonly current_value: number;
  readonly previous_value?: number;
  readonly delta_percent?: number;
}

export interface InsightRecommendation {
  readonly priority: 'high' | 'medium' | 'low';
  readonly type: RecommendationType;
  readonly text: string;
}

export interface InsightHypothesis {
  readonly text: string;
  readonly confidence: StrengthLevel;
}

export interface Insight {
  readonly id: string;
  readonly severity: StrengthLevel;
  readonly confidence: StrengthLevel;
  readonly problem_type: ProblemType;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly InsightEvidence[];
  readonly triggered_rules: readonly string[];
  readonly related_concepts: readonly string[];
  readonly related_playbooks: readonly string[];
  readonly hypotheses: readonly InsightHypothesis[];
  readonly recommendations: readonly InsightRecommendation[];
  readonly caveats: readonly string[];
  readonly next_data_to_check: readonly string[];
}

export interface DiagnosticOutput {
  readonly analysis_id: string;
  readonly knowledge_base_version: string;
  readonly insights: readonly Insight[];
}
