/**
 * engine.ts — a cadeia do Copilot: diagnostico por regras → conhecimento → IA → guardiao → retry → fallback.
 *
 * Nada aqui inventa numero. Todo numero nasce em context.ts (com [ref:]) ou no
 * texto deterministico montado a partir do InsightComposer (com [ref:]).
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PromptAssembler,
  validateLlmOutput,
  checkKnowledgeCitations,
  type KnowledgeBlock,
  type LlmProvider,
  type SanitizedContext,
} from '@dre/ai';
import {
  KnowledgeRepository,
  RuleEngine,
  InsightComposer,
  type Concept,
  type DiagnosticInput,
  type DiagnosticOutput,
  type DiagnosticRule,
  type KpiItem,
  type MetricInput,
  type Playbook,
} from '@dre/kb';
import { EXPENSE_GROUP_KEYS, type DreImport, type MonthKpis } from '@dre/ingest';
import { monthLabel, TENANT_ID, type SourceDetail } from './context.js';
import { KB_DIR } from './store.js';

// ---------------------------------------------------------------------------
// Base de conhecimento (carregada uma vez)
// ---------------------------------------------------------------------------

let repo: KnowledgeRepository | null = null;
export function kb(): KnowledgeRepository {
  if (repo === null) repo = new KnowledgeRepository(join(KB_DIR, 'finance_kb.json'));
  return repo;
}

// ---------------------------------------------------------------------------
// Diagnostico: DRE → MetricInput[] → regras → insights estruturados
// ---------------------------------------------------------------------------

/** Mapeia os KPIs do mes para os ids de metrica usados nas regras. */
export function metricsForMonth(data: DreImport, ym: string): Record<string, number> {
  const mi = data.statement.months.indexOf(ym);
  const k = data.kpis[mi];
  const c = data.statement.canonical[ym];
  if (k === undefined || c === undefined) return {};
  const shares = EXPENSE_GROUP_KEYS.map((g) => k.participacao_despesas[g] ?? 0);
  const out: Record<string, number | null> = {
    kpi_receita_liquida: k.receita_liquida,
    kpi_cmv: c.cmv,
    kpi_lucro_bruto: k.lucro_bruto,
    kpi_margem_bruta: k.margem_bruta_pct,
    kpi_despesas_operacionais: k.despesas_operacionais,
    kpi_despesas_sobre_receita: k.despesas_sobre_receita_pct,
    kpi_resultado_operacional: k.resultado_operacional,
    kpi_resultado_liquido: k.resultado_liquido,
    kpi_margem_liquida: k.margem_liquida_pct,
    kpi_margem_contribuicao: k.margem_contribuicao_pct,
    kpi_ponto_equilibrio: k.ponto_equilibrio,
    kpi_folga_ponto_equilibrio: k.ponto_equilibrio === null ? null : Math.round((k.receita_bruta - k.ponto_equilibrio) * 100) / 100,
    kpi_despesas_pessoal: c.despesas_pessoal,
    kpi_despesas_marketing: c.despesas_marketing,
    kpi_despesas_ocupacao: c.despesas_ocupacao,
    kpi_despesas_comerciais: c.despesas_comerciais,
    kpi_despesas_administrativas: c.despesas_administrativas,
    kpi_despesas_financeiras: c.despesas_financeiras,
    kpi_maior_despesa_share: shares.length > 0 ? Math.max(...shares) : null,
  };
  const clean: Record<string, number> = {};
  for (const [key, v] of Object.entries(out)) if (v !== null && Number.isFinite(v)) clean[key] = v;
  return clean;
}

export function buildDiagnosticInput(data: DreImport, ym: string): DiagnosticInput {
  const months = data.statement.months;
  const mi = months.indexOf(ym);
  const prevYm = mi > 0 ? months[mi - 1] : undefined;
  const cur = metricsForMonth(data, ym);
  const prev = prevYm === undefined ? {} : metricsForMonth(data, prevYm);
  const metrics: MetricInput[] = Object.entries(cur).map(([kpi_id, current_value]) => {
    const previous = prev[kpi_id];
    return previous === undefined ? { kpi_id, current_value } : { kpi_id, current_value, previous_value: previous };
  });
  return {
    analysis_id: `dre-${ym}-${randomUUID().slice(0, 8)}`,
    business_context: { currency: 'BRL', primary_goal: 'lucrar mais: reduzir custo e aumentar receita' },
    period: {
      current_start: `${ym}-01`,
      current_end: `${ym}-28`,
      ...(prevYm !== undefined ? { comparison_start: `${prevYm}-01`, comparison_end: `${prevYm}-28` } : {}),
    },
    metrics,
    constraints: { max_recommendations: 5 },
  };
}

export function runRules(data: DreImport, ym: string): { input: DiagnosticInput; output: DiagnosticOutput; triggered: readonly DiagnosticRule[] } {
  const input = buildDiagnosticInput(data, ym);
  const engine = new RuleEngine(kb());
  const composer = new InsightComposer(kb());
  const triggered = engine.evaluate(input);
  const output = composer.compose(input, triggered);
  return { input, output, triggered: triggered.map((t) => t.rule) };
}

// ---------------------------------------------------------------------------
// Blocos de conhecimento (texto curado, sem numero de cliente)
// ---------------------------------------------------------------------------

function kpiBody(k: KpiItem): string {
  const parts = [k.title + ': ' + k.summary];
  if (k.formula_pt) parts.push('Formula: ' + k.formula_pt + '.');
  if (k.interpretation?.rising) parts.push('Se sobe: ' + k.interpretation.rising);
  if (k.interpretation?.falling) parts.push('Se cai: ' + k.interpretation.falling);
  if (k.caveats?.length) parts.push('Cuidado: ' + k.caveats.join(' '));
  return parts.join(' ');
}
function conceptBody(c: Concept): string {
  const parts = [c.title + ': ' + c.summary];
  if (c.why_it_matters) parts.push(c.why_it_matters);
  if (c.caveats?.length) parts.push('Cuidado: ' + c.caveats.join(' '));
  return parts.join(' ');
}
function ruleBody(r: DiagnosticRule): string {
  const parts = ['Diagnostico "' + r.title + '": ' + r.summary];
  if (r.hypotheses?.length) parts.push('Hipoteses: ' + r.hypotheses.map((h) => h.text).join(' | '));
  if (r.recommendations?.length) parts.push('Recomendacoes: ' + r.recommendations.join(' | '));
  if (r.caveats?.length) parts.push('Cuidado: ' + r.caveats.join(' '));
  return parts.join(' ');
}
function playbookBody(p: Playbook): string {
  const parts = ['Playbook "' + p.title + '": ' + p.summary];
  parts.push('Acoes: ' + p.actions.map((a) => `(${a.priority}) ${a.text}`).join(' | '));
  if (p.guardrails?.length) parts.push('Nao fazer: ' + p.guardrails.join(' | '));
  return parts.join(' ');
}

export function knowledgeBlocks(opts: {
  readonly kpiIds?: readonly string[];
  readonly rules?: readonly DiagnosticRule[];
  readonly playbookIds?: readonly string[];
  readonly conceptIds?: readonly string[];
  readonly max?: number;
}): KnowledgeBlock[] {
  const r = kb();
  const max = opts.max ?? r.manifest.teto_blocos_por_prompt;
  const blocks: KnowledgeBlock[] = [];
  const seen = new Set<string>();
  const add = (id: string, body: string): void => {
    if (seen.has(id) || blocks.length >= max) return;
    seen.add(id);
    blocks.push({ kbId: id, body });
  };
  for (const rule of opts.rules ?? []) add(rule.id, ruleBody(rule));
  for (const id of opts.playbookIds ?? []) {
    const p = r.getPlaybookById(id);
    if (p) add(p.id, playbookBody(p));
  }
  for (const id of opts.conceptIds ?? []) {
    const c = r.getById(id);
    if (c && c.type === 'concept') add(c.id, conceptBody(c));
  }
  for (const id of opts.kpiIds ?? []) {
    const k = r.getKpiById(id);
    if (k) add(k.id, kpiBody(k));
  }
  return blocks;
}

/** Recuperacao deterministica: casa termos da pergunta com aliases/titulos da base. */
export function retrieveForQuestion(question: string, max = 6): KnowledgeBlock[] {
  const q = normalise(question);
  const r = kb();
  const scored: { id: string; score: number }[] = [];
  const score = (id: string, terms: readonly string[]): void => {
    let s = 0;
    for (const t of terms) {
      const nt = normalise(t);
      if (nt.length >= 4 && q.includes(nt)) s += nt.length;
    }
    if (s > 0) scored.push({ id, score: s });
  };
  for (const k of r.getKpis()) score(k.id, [k.title, ...(k.aliases ?? [])]);
  for (const c of r.getConcepts()) score(c.id, [c.title, c.slug.replace(/-/g, ' ')]);
  for (const p of r.getPlaybooks()) score(p.id, [p.title, ...(p.when_to_use ?? [])]);
  scored.sort((a, b) => b.score - a.score);
  const ids = scored.slice(0, max).map((s) => s.id);
  // Base sempre presente: sem bloco algum, o modelo tende a citar um [kb:] que nao existe.
  const BASELINE = ['kpi_resultado_liquido', 'kpi_margem_bruta', 'kpi_despesas_operacionais', 'concept_dre'];
  for (const b of BASELINE) if (ids.length < max && !ids.includes(b)) ids.push(b);
  return knowledgeBlocks({
    kpiIds: ids.filter((i) => i.startsWith('kpi_')),
    conceptIds: ids.filter((i) => i.startsWith('concept_')),
    playbookIds: ids.filter((i) => i.startsWith('playbook_')),
    max,
  });
}

export function normalise(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Geracao com guardiao + 1 retry
// ---------------------------------------------------------------------------

export interface GroundedResult {
  readonly text: string;
  readonly passed: boolean;
  readonly usedLlm: boolean;
  readonly attempts: number;
  readonly rejectionReason: string | null;
  readonly model: string;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly injectedKbIds: readonly string[];
}

function retrySuffix(reason: string | null, allowedKbIds: readonly string[]): string {
  const kbLine =
    allowedKbIds.length === 0
      ? 'NAO use nenhum [kb:] nesta resposta — nenhum conhecimento foi entregue.'
      : `Os UNICOS [kb:] permitidos sao exatamente estes: ${allowedKbIds.map((i) => `[kb:${i}]`).join(' ')}. Qualquer outro sera rejeitado.`;
  return (
    `\n\n[Sua resposta anterior foi REJEITADA pelo guardiao (motivo: ${reason ?? 'desconhecido'}). Reescreva obedecendo: ` +
    'TODO numero grudado ao seu [ref:ID] exato do bloco <<<DATA>>>; NENHUM numero calculado por voce; ' +
    `variacoes apenas com os itens cujo label comeca com "Variacao" e o [ref:] deles; resumo final sem numeros. ${kbLine}]`
  );
}

export async function generateGrounded(args: {
  readonly provider: LlmProvider;
  readonly context: SanitizedContext;
  readonly question: string;
  readonly knowledge: readonly KnowledgeBlock[];
  readonly maxOutputTokens?: number;
  /** Profundidade de raciocinio. 'low' = resposta rapida para o chat ao vivo. */
  readonly effort?: 'low' | 'medium' | 'high';
  readonly log: (obj: unknown, msg: string) => void;
}): Promise<GroundedResult> {
  const assembler = new PromptAssembler();
  const started = Date.now();
  // Sem IA real (mock): devolve "nao passou" para o chamador usar o texto deterministico das regras.
  if (args.provider.name === 'mock') {
    return { text: '', passed: false, usedLlm: false, attempts: 0, rejectionReason: 'sem IA real (LLM_PROVIDER=mock)', model: 'mock', latencyMs: 0, tokensIn: 0, tokensOut: 0, injectedKbIds: [] };
  }
  let attempts = 0;
  let lastReason: string | null = null;
  let model = 'n/a';
  let tokensIn = 0;
  let tokensOut = 0;
  let injected: readonly string[] = [];

  for (let round = 0; round < 2; round++) {
    attempts += 1;
    const suffix = round === 0 ? '' : retrySuffix(lastReason, args.knowledge.map((k) => k.kbId));
    const messages = assembler.assemble({
      userQuestion: args.question + suffix,
      context: args.context,
      nonce: randomUUID(),
      knowledgeBlocks: args.knowledge,
    });
    injected = messages.injectedKbIds;
    let text: string;
    try {
      const res = await args.provider.generate(messages, {
        maxOutputTokens: args.maxOutputTokens ?? 1400,
        timeoutMs: 120_000,
        effort: args.effort ?? 'medium',
      });
      text = res.text;
      model = res.model;
      tokensIn += res.usage.tokensIn;
      tokensOut += res.usage.tokensOut;
    } catch (err) {
      lastReason = `provider_error: ${err instanceof Error ? err.message : String(err)}`;
      args.log({ err: lastReason }, '[engine] falha do provedor');
      break;
    }
    const validation = validateLlmOutput(text, messages.sourceRefs, TENANT_ID);
    const kbCheck = checkKnowledgeCitations(text, [...messages.injectedKbIds]);
    args.log({ attempt: attempts, passed: validation.passed, reason: validation.rejectionReason, detail: validation.rejectionDetail, kb: kbCheck.passed }, '[engine] validacao');
    if (validation.passed && kbCheck.passed) {
      return { text, passed: true, usedLlm: true, attempts, rejectionReason: null, model, latencyMs: Date.now() - started, tokensIn, tokensOut, injectedKbIds: injected };
    }
    lastReason = validation.passed ? `kb:${kbCheck.reason ?? 'unknown_kb_id'}` : `${validation.rejectionReason}: ${validation.rejectionDetail ?? ''}`;
  }
  return { text: '', passed: false, usedLlm: true, attempts, rejectionReason: lastReason, model, latencyMs: Date.now() - started, tokensIn, tokensOut, injectedKbIds: injected };
}

// ---------------------------------------------------------------------------
// Texto deterministico (sem IA) — sempre passa no guardiao por construcao
// ---------------------------------------------------------------------------

function fmtBRL(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtVal(n: number, unit: string): string {
  if (unit === '%') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  if (unit === 'pp') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pontos`;
  return fmtBRL(n);
}

/** Localiza o ref do KPI de um mes (kpi#<id>#<ym>) nos detalhes do contexto. */
function refFor(details: ReadonlyMap<string, SourceDetail>, kpiId: string, ym: string): SourceDetail | undefined {
  return details.get(`kpi#${kpiId}#${ym}`) ?? details.get(`dre#${kpiId.replace(/^kpi_/, '')}#${ym}`);
}

export function deterministicInsightText(output: DiagnosticOutput, details: ReadonlyMap<string, SourceDetail>, ym: string, k: MonthKpis): string {
  const lines: string[] = [];
  lines.push(`Leitura de ${monthLabel(ym)} (texto montado pelas regras, sem IA):`);
  const rl = details.get(`kpi#kpi_resultado_liquido#${ym}`);
  const rec = details.get(`kpi#kpi_receita_liquida#${ym}`);
  const mb = details.get(`kpi#kpi_margem_bruta#${ym}`);
  if (rec) lines.push(`- Receita liquida — ${fmtVal(rec.value, rec.unit)} [ref:${rec.id}]`);
  if (mb) lines.push(`- Margem bruta — ${fmtVal(mb.value, mb.unit)} [ref:${mb.id}]`);
  if (rl) lines.push(`- Resultado liquido — ${fmtVal(rl.value, rl.unit)} [ref:${rl.id}]`);
  lines.push('---');
  if (output.insights.length === 0) {
    lines.push('Nenhuma regra de diagnostico disparou neste mes: sem sinal de alerta nos indicadores acompanhados. [kb:concept_dre]');
  }
  const usedRecs = new Set<string>();
  for (const ins of output.insights) {
    lines.push(`${ins.title}. ${ins.summary} [kb:${ins.triggered_rules[0] ?? 'concept_dre'}]`);
    for (const ev of ins.evidence) {
      const d = refFor(details, ev.kpi_id, ym);
      if (d) lines.push(`- ${d.label} — ${fmtVal(d.value, d.unit)} [ref:${d.id}]`);
    }
    if (ins.hypotheses.length > 0) lines.push('Hipoteses: ' + ins.hypotheses.slice(0, 2).map((h) => h.text).join(' '));
    // Recomendacoes da PROPRIA regra (mais especificas que as do playbook), sem repetir entre insights.
    const rule = kb().getRuleById(ins.triggered_rules[0] ?? '');
    const recs = (rule?.recommendations ?? ins.recommendations.map((r) => r.text)).filter((r) => !usedRecs.has(r)).slice(0, 2);
    recs.forEach((r) => usedRecs.add(r));
    if (recs.length > 0) lines.push('Proximos passos: ' + recs.join(' '));
  }
  const top = k.top_despesas[0];
  if (top) {
    const d = [...details.values()].find((x) => x.label === `Linha "${top.label}"` && x.period === monthLabel(ym));
    if (d) lines.push(`Maior despesa do mes: ${top.label} — ${fmtVal(d.value, d.unit)} [ref:${d.id}]`);
  }
  return lines.join('\n');
}
