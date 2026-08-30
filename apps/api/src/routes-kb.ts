/**
 * routes-kb.ts — "Explica pra mim" deterministico (sem IA).
 *
 *   GET /marketing-kb/kpi/:metric_key   (rota herdada do painel do ALVOR)
 *   GET /kb/kpi/:metric_key
 *
 * Contrato: KpiKbData do ExplainPanel (metric_key, name_pt, definition, formula, kb_ref, current_value).
 */

import type { FastifyInstance } from 'fastify';
import type { MonthKpis } from '@dre/ingest';
import { kb } from './engine.js';
import { monthLabel } from './context.js';
import { getCurrentImport } from './routes-dre.js';

const FIELD_BY_KPI: Readonly<Record<string, { key: keyof MonthKpis; unit: string }>> = {
  kpi_receita_liquida: { key: 'receita_liquida', unit: 'BRL' },
  kpi_lucro_bruto: { key: 'lucro_bruto', unit: 'BRL' },
  kpi_margem_bruta: { key: 'margem_bruta_pct', unit: '%' },
  kpi_despesas_operacionais: { key: 'despesas_operacionais', unit: 'BRL' },
  kpi_despesas_sobre_receita: { key: 'despesas_sobre_receita_pct', unit: '%' },
  kpi_resultado_operacional: { key: 'resultado_operacional', unit: 'BRL' },
  kpi_resultado_liquido: { key: 'resultado_liquido', unit: 'BRL' },
  kpi_margem_liquida: { key: 'margem_liquida_pct', unit: '%' },
  kpi_margem_contribuicao: { key: 'margem_contribuicao_pct', unit: '%' },
  kpi_ponto_equilibrio: { key: 'ponto_equilibrio', unit: 'BRL' },
};

function fmt(v: number, unit: string): string {
  if (unit === '%') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

export async function kbRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (metricKey: string): Promise<Record<string, unknown> | null> => {
    const item = kb().getKpiById(metricKey);
    if (item === undefined) return null;
    const data = getCurrentImport();
    const field = FIELD_BY_KPI[metricKey];
    let current_value: Record<string, unknown> | null = null;
    if (data !== null && field !== undefined) {
      const ym = data.statement.months[data.statement.months.length - 1] ?? '';
      const k = data.kpis[data.kpis.length - 1];
      const v = k?.[field.key];
      if (typeof v === 'number') {
        current_value = {
          value: fmt(v, field.unit),
          unit: field.unit,
          refs: [{ id: `kpi#${metricKey}#${ym}`, source: 'DRE', period: monthLabel(ym), account: data.statement.fileName }],
        };
      }
    }
    return {
      metric_key: metricKey,
      name_pt: item.title,
      definition: [item.summary, item.description, item.business_question ? `Pergunta que responde: ${item.business_question}` : ''].filter((s) => s && s.length > 0).join(' '),
      formula: item.formula_pt ?? item.formula,
      kb_ref: item.id,
      current_value,
    };
  };

  for (const path of ['/marketing-kb/kpi/:metric_key', '/kb/kpi/:metric_key']) {
    app.get<{ Params: { metric_key: string } }>(path, async (req, reply) => {
      const out = await handler(req.params.metric_key);
      if (out === null) return reply.code(404).send({ message: 'KPI sem definicao na base.' });
      return reply.send(out);
    });
  }
}
