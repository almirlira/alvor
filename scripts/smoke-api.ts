// Smoke da API: carrega a DRE de exemplo, gera insights e faz 1 pergunta.
// Uso: npx tsx scripts/smoke-api.ts ["pergunta"]
const BASE = process.env['API_URL'] ?? 'http://localhost:3800';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.message ?? ''}`);
  return json;
}

const health = await call<{ llm: string; model: string; kb: string }>('GET', '/health');
console.log('health:', health);

const imp = await call<{ statement: { months: string[]; summary: unknown } }>('POST', '/dre/load-sample');
console.log('sample carregada:', imp.statement.months.length, 'meses', JSON.stringify(imp.statement.summary));

const t0 = Date.now();
const ins = await call<{ text: string; validationPassed: boolean; usedLlm: boolean; model: string; triggeredRules: { id: string }[]; rejectionReason: string | null; latencyMs: number }>('POST', '/insights/generate', {});
console.log(`\ninsights: passed=${ins.validationPassed} usedLlm=${ins.usedLlm} model=${ins.model} rules=${ins.triggeredRules.map((r) => r.id).join(',')} latency=${ins.latencyMs}ms (${Date.now() - t0}ms total) rejection=${ins.rejectionReason}`);
console.log('---\n' + ins.text + '\n---');

const q = process.argv[2] ?? 'Qual despesa mais cresceu em relacao ao mes anterior?';
const t1 = Date.now();
const ask = await call<{ message: { content: string; fallbackReason?: string; meta?: Record<string, unknown> } }>('POST', '/copilot/ask', { question: q });
console.log(`\npergunta: ${q}\nfallback=${ask.message.fallbackReason ?? 'nao'} meta=${JSON.stringify(ask.message.meta)} (${Date.now() - t1}ms)`);
console.log('---\n' + ask.message.content + '\n---');
