import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { dreRoutes } from './routes-dre.js';
import { insightsRoutes } from './routes-insights.js';
import { copilotRoutes } from './routes-copilot.js';
import { kbRoutes } from './routes-kb.js';
import { semaforoRoutes } from './routes-semaforo.js';
import { createLlm } from './llm.js';
import { kb } from './engine.js';

export const APP_NAME = 'AIVOR';

const app = Fastify({ logger: { level: 'info' } });

await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const llm = createLlm({
  info: (o, m) => app.log.info(o, m),
  warn: (o, m) => app.log.warn(o, m),
  error: (o, m) => app.log.error(o, m),
  debug: (o, m) => app.log.debug(o, m),
});
const base = kb();
app.log.info({ kb_version: base.version, itens: base.getKpis().length + base.getRules().length + base.getConcepts().length + base.getPlaybooks().length }, '[kb] base financeira carregada');

app.get('/health', async () => ({ ok: true, app: APP_NAME, llm: llm.providerName, model: llm.model, kb: base.version }));
await app.register(dreRoutes);
await app.register(async (inst) => insightsRoutes(inst, llm));
await app.register(async (inst) => copilotRoutes(inst, llm));
await app.register(kbRoutes);
await app.register(semaforoRoutes);

const port = Number(process.env['API_PORT'] ?? 3800);
await app.listen({ port, host: '127.0.0.1' });
app.log.info(`${APP_NAME} API em http://localhost:${port} — IA: ${llm.providerName} (${llm.model})`);
