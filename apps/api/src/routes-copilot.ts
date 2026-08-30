/**
 * routes-copilot.ts — perguntas livres sobre a DRE.
 *
 *   POST /copilot/ask { question } → { message }
 *   GET  /copilot/history           → ChatMessage[]
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildContext, monthLabel, toUiSources, type SourceDetail } from './context.js';
import { generateGrounded, normalise, retrieveForQuestion } from './engine.js';
import { getCurrentImport } from './routes-dre.js';
import { readJson, writeJson } from './store.js';
import type { LlmSetup } from './llm.js';

interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly sources?: readonly Record<string, unknown>[];
  readonly fallbackReason?: 'no_data' | 'out_of_scope' | 'ambiguous';
  readonly meta?: Record<string, unknown>;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

/** Meses citados na pergunta (por nome ou mm/aa); vazio quando nenhum. */
function monthsInQuestion(question: string, available: readonly string[]): string[] {
  const q = normalise(question);
  const found = new Set<string>();
  for (const ym of available) {
    const [y, m] = ym.split('-');
    const mi = Number(m);
    const names = Object.entries(MONTH_NAMES).filter(([, n]) => n === mi).map(([name]) => name);
    const yy = (y ?? '').slice(2);
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b(\\s*(de\\s*)?(${y}|${yy}))?`).test(q)) {
        // se a pergunta cita o ano, so aceita o ym do ano certo; sem ano, aceita o mais recente daquele mes
        const citesYear = new RegExp(`\\b${name}\\b\\s*(de\\s*)?(${y}|${yy})\\b`).test(q);
        const anyYear = new RegExp(`\\b${name}\\b\\s*(de\\s*)?(20\\d\\d|\\d\\d)\\b`).test(q);
        if (citesYear || !anyYear) found.add(ym);
      }
    }
    if (q.includes(`${m}/${y}`) || q.includes(`${m}/${yy}`)) found.add(ym);
  }
  // sem ano: mantem so o mais recente de cada mes citado
  const byMonth = new Map<string, string>();
  for (const ym of [...found].sort()) byMonth.set(ym.slice(5), ym);
  return [...byMonth.values()].sort();
}

function wantsAllMonths(question: string): boolean {
  const q = normalise(question);
  return /\b(todos os meses|mes a mes|ao longo|tendencia|evolucao|historico|ultimos \d+ meses|no ano|do ano|trimestre|semestre)\b/.test(q);
}

function fallbackText(details: ReadonlyMap<string, SourceDetail>, ym: string): string {
  const pick = (id: string): SourceDetail | undefined => details.get(`kpi#${id}#${ym}`);
  const items = ['kpi_receita_liquida', 'kpi_margem_bruta', 'kpi_despesas_operacionais', 'kpi_resultado_liquido']
    .map(pick)
    .filter((d): d is SourceDetail => d !== undefined)
    .map((d) => `- ${d.label} — ${d.unit === '%' ? d.value.toLocaleString('pt-BR') + '%' : 'R$ ' + d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} [ref:${d.id}]`);
  return (
    `Nao consegui montar uma resposta em que todo numero tenha fonte na sua DRE — e prefiro nao chutar. ` +
    `O que tenho para ${monthLabel(ym)}:\n${items.join('\n')}\n---\nPergunte por uma conta, uma despesa ou uma comparacao entre dois meses que eu respondo com as fontes.`
  );
}

export async function copilotRoutes(app: FastifyInstance, llm: LlmSetup): Promise<void> {
  app.get('/copilot/history', async () => readJson<ChatMessage[]>('chat', []));

  app.post<{ Body: { question?: string } }>('/copilot/ask', async (req, reply) => {
    const question = (req.body?.question ?? '').trim();
    if (question.length === 0) return reply.code(400).send({ message: 'Pergunta vazia.' });
    const data = getCurrentImport();
    if (data === null) return reply.code(404).send({ message: 'Envie uma DRE primeiro.' });

    const history = readJson<ChatMessage[]>('chat', []);
    const available = data.statement.months;
    const last = available[available.length - 1]!;

    // Meses: citados na pergunta > todos (tendencia) > heranca do turno anterior > ultimo + anterior
    let months = monthsInQuestion(question, available);
    if (months.length === 0 && wantsAllMonths(question)) months = [...available];
    if (months.length === 0) {
      const prevMonths = history.length > 0 ? ((history[history.length - 1]?.meta?.['months'] as string[] | undefined) ?? []) : [];
      months = prevMonths.length > 0 ? prevMonths : available.slice(-2);
    }
    if (months.length === 1) {
      const idx = available.indexOf(months[0]!);
      if (idx > 0) months = [available[idx - 1]!, months[0]!];
    }
    const includeLines = months.length <= 3;

    const built = buildContext(data, { intent: question, months, includeLines, includeFiscal: true });
    const knowledge = retrieveForQuestion(question, 6);

    const recent = history.slice(-4).map((m) => `${m.role === 'user' ? 'Dono' : 'Copilot'}: ${m.content.replace(/\[(ref|kb):[^\]]+\]/g, '').slice(0, 400)}`).join('\n');
    const fullQuestion =
      (recent.length > 0 ? `Conversa anterior (para contexto, nao repita):\n${recent}\n\n` : '') +
      `Pergunta atual do dono: ${question}\n(Meses disponiveis no contexto: ${months.map(monthLabel).join(', ')}.)`;

    const grounded = await generateGrounded({ provider: llm.provider, context: built.context, question: fullQuestion, knowledge, log: (o, m) => req.log.info(o, m) });

    const focusMonth = months[months.length - 1] ?? last;
    const message: ChatMessage = grounded.passed
      ? { id: randomUUID(), role: 'assistant', content: grounded.text, sources: toUiSources(built.details), meta: { months, model: grounded.model, latencyMs: grounded.latencyMs, attempts: grounded.attempts } }
      // Sem `fallbackReason`: a bolha renderiza o texto honesto abaixo (com fontes), nao a copy generica herdada.
      : { id: randomUUID(), role: 'assistant', content: fallbackText(built.details, focusMonth), sources: toUiSources(built.details), meta: { months, model: grounded.model, latencyMs: grounded.latencyMs, rejection: grounded.rejectionReason, fallback: 'no_data' } };

    const userMsg: ChatMessage = { id: randomUUID(), role: 'user', content: question, meta: { months } };
    writeJson('chat', [...history, userMsg, message].slice(-40));
    return reply.send({ message });
  });
}
