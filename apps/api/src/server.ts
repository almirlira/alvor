import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { dreRoutes } from './routes-dre.js';
import { insightsRoutes } from './routes-insights.js';
import { copilotRoutes } from './routes-copilot.js';
import { kbRoutes } from './routes-kb.js';
import { semaforoRoutes } from './routes-semaforo.js';
import { feedbackRoutes } from './routes-feedback.js';
import { alphaRoutes } from './routes-alpha.js';
import { createLlm } from './llm.js';
import { kb } from './engine.js';
import { inviteAuthEnabled, supabaseAuthEnabled, requireAuth } from './auth.js';
import { recordUsage } from './audit.js';

export const APP_NAME = 'ALVOR';

const app = Fastify({ logger: { level: 'info' } });

const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? process.env['APP_ORIGIN'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

await app.register(cors, {
  origin(origin, cb) {
    if (origin === undefined || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }
    cb(new Error('Origem nao permitida'), false);
  },
});

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

app.addHook('preHandler', async (req, reply) => {
  if (req.routeOptions.url === '/health') return;
  await requireAuth(req, reply);
});

app.addHook('onResponse', async (req, reply) => {
  if (!('auth' in req)) return;
  try {
    await recordUsage(req, reply.statusCode);
  } catch (err) {
    req.log.warn({ err }, 'falha ao registrar uso da alpha');
  }
});

await app.register(alphaRoutes);
await app.register(dreRoutes);
await app.register(async (inst) => insightsRoutes(inst, llm));
await app.register(async (inst) => copilotRoutes(inst, llm));
await app.register(kbRoutes);
await app.register(semaforoRoutes);
await app.register(feedbackRoutes);

const port = Number(process.env['API_PORT'] ?? 3800);
const host = process.env['API_HOST'] ?? (process.env['NODE_ENV'] === 'production' ? '0.0.0.0' : '127.0.0.1');
await app.listen({ port, host });
const authMode = supabaseAuthEnabled ? 'supabase' : inviteAuthEnabled ? 'convite' : 'local';
app.log.info(`${APP_NAME} API em http://${host}:${port} — IA: ${llm.providerName} (${llm.model}) — auth: ${authMode}`);
