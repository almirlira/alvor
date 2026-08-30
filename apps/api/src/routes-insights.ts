/**
 * routes-insights.ts — leitura do mes.
 *
 *   POST /insights/generate { month? }  → InsightResult
 *   GET  /insights/current               → InsightResult | 404
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildContext, monthLabel, toUiSources } from './context.js';
import { deterministicInsightText, generateGrounded, knowledgeBlocks, runRules } from './engine.js';
import { getCurrentImport } from './routes-dre.js';
import { readJson, writeJson } from './store.js';
import type { LlmSetup } from './llm.js';

export interface InsightResult {
  readonly id: string;
  readonly month: string;
  readonly text: string;
  readonly sources: readonly Record<string, unknown>[];
  readonly validationPassed: boolean;
  readonly usedLlm: boolean;
  readonly fallbackReason?: 'no_data' | 'out_of_scope' | 'ambiguous';
  readonly triggeredRules: readonly { id: string; title: string }[];
  readonly generatedAt: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly rejectionReason: string | null;
}

export async function insightsRoutes(app: FastifyInstance, llm: LlmSetup): Promise<void> {
  app.get('/insights/current', async (_req, reply) => {
    const cur = readJson<InsightResult | null>('insights', null);
    if (cur === null) return reply.code(404).send({ message: 'Nenhum insight gerado ainda.' });
    return reply.send(cur);
  });

  app.post<{ Body: { month?: string } }>('/insights/generate', async (req, reply) => {
    const data = getCurrentImport();
    if (data === null) return reply.code(404).send({ message: 'Envie uma DRE primeiro.' });
    const months = data.statement.months;
    const month = req.body?.month && months.includes(req.body.month) ? req.body.month : months[months.length - 1]!;
    const mi = months.indexOf(month);
    const prev = mi > 0 ? months[mi - 1] : undefined;
    const k = data.kpis[mi]!;

    // 1. Regras → insight estruturado (sem IA)
    const { output, triggered } = runRules(data, month);

    // 2. Contexto citavel (mes atual + anterior + linhas + fiscal)
    const built = buildContext(data, {
      intent: `leitura do mes de ${monthLabel(month)}`,
      months: prev === undefined ? [month] : [prev, month],
      includeLines: true,
      includeFiscal: true,
    });

    // 3. Conhecimento: regras disparadas + playbooks + conceitos + KPIs em evidencia
    const evidenceKpis = new Set<string>();
    const playbooks = new Set<string>();
    const concepts = new Set<string>();
    for (const ins of output.insights) {
      ins.evidence.forEach((e) => evidenceKpis.add(e.kpi_id));
      ins.related_playbooks.forEach((p) => playbooks.add(p));
      ins.related_concepts.forEach((c) => concepts.add(c));
    }
    if (evidenceKpis.size === 0) ['kpi_resultado_liquido', 'kpi_margem_bruta', 'kpi_despesas_sobre_receita'].forEach((x) => evidenceKpis.add(x));
    const knowledge = knowledgeBlocks({ rules: triggered, playbookIds: [...playbooks], conceptIds: [...concepts], kpiIds: [...evidenceKpis] });

    // 4. Pergunta ao LLM = instrucao + diagnostico estruturado com refs ja anexadas
    const diagText = output.insights.length === 0
      ? 'Nenhuma regra de diagnostico disparou: sem sinal de alerta nos indicadores acompanhados.'
      : output.insights.map((ins) => {
          const ev = ins.evidence.map((e) => {
            const d = built.details.get(`kpi#${e.kpi_id}#${month}`) ?? built.details.get(`dre#${e.kpi_id.replace(/^kpi_/, '')}#${month}`);
            return d ? `${d.label}: ${d.value} [ref:${d.id}]` : e.kpi_id;
          });
          return `DIAGNOSTICO [kb:${ins.triggered_rules[0] ?? ''}] — ${ins.title} (severidade ${ins.severity}). Evidencias: ${ev.join('; ')}. Hipoteses: ${ins.hypotheses.map((h) => h.text).join(' | ')}. Recomendacoes: ${ins.recommendations.map((r) => r.text).join(' | ')}.`;
        }).join('\n');

    const question =
      `Escreva a leitura de ${monthLabel(month)} para o dono da empresa, no formato unico aceito. ` +
      `Abra com uma frase sobre como o mes fechou; liste de 3 a 6 numeros-chave (receita liquida, margem bruta, resultado liquido, maiores despesas e variacoes que existirem nos dados), cada um com seu [ref:]; ` +
      `na leitura, explique o que os diagnosticos abaixo indicam (cite [kb:] das regras) e diga as 2 ou 3 acoes praticas mais importantes para lucrar mais no proximo mes; ` +
      `feche com uma pergunta de continuacao.\n\nDiagnostico estruturado (produzido pelas regras do sistema):\n${diagText}`;

    const grounded = await generateGrounded({ provider: llm.provider, context: built.context, question, knowledge, maxOutputTokens: 1600, log: (o, m) => req.log.info(o, m) });

    const text = grounded.passed ? grounded.text : deterministicInsightText(output, built.details, month, k);
    const result: InsightResult = {
      id: randomUUID(),
      month,
      text,
      sources: toUiSources(built.details),
      validationPassed: grounded.passed,
      usedLlm: grounded.passed,
      triggeredRules: triggered.map((r) => ({ id: r.id, title: r.title })),
      generatedAt: new Date().toISOString(),
      model: grounded.passed ? grounded.model : `regras (fallback: ${grounded.rejectionReason ?? 'sem IA'})`,
      latencyMs: grounded.latencyMs,
      rejectionReason: grounded.rejectionReason,
    };
    writeJson('insights', result);
    return reply.send(result);
  });
}
