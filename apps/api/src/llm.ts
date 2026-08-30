/**
 * llm.ts — cria o provedor de IA a partir do ambiente (mesma logica do chat-ia/wire.ts do CROSS).
 *
 *   LLM_PROVIDER      anthropic-direct | mock   (default: mock se nao houver chave)
 *   ANTHROPIC_API_KEY chave da Anthropic (nunca no codigo)
 *   ANTHROPIC_MODEL   claude-opus-5 (default) | claude-sonnet-5
 */

import { createLlmProvider, type AdapterLogger, type LlmProvider } from '@dre/ai';

export interface LlmSetup {
  readonly provider: LlmProvider;
  readonly providerName: 'anthropic-direct' | 'mock';
  readonly model: string;
}

export function createLlm(logger: AdapterLogger): LlmSetup {
  const env = process.env;
  const requested = env['LLM_PROVIDER'];
  const apiKey = env['ANTHROPIC_API_KEY'];
  const model = env['ANTHROPIC_MODEL'] ?? 'claude-opus-5';

  if (requested === 'anthropic-direct' || (requested === undefined && apiKey !== undefined && apiKey.length > 10)) {
    if (apiKey === undefined || apiKey.length < 10 || apiKey.startsWith('cole-aqui')) {
      logger.warn({}, '[llm] LLM_PROVIDER=anthropic-direct sem ANTHROPIC_API_KEY valida — usando mock.');
      return { provider: createLlmProvider({ provider: 'mock' }), providerName: 'mock', model: 'mock' };
    }
    const provider = createLlmProvider({
      provider: 'anthropic-direct',
      nodeEnv: 'development',
      anthropicDirect: { apiKey, model, logger },
    });
    logger.info({ model }, '[llm] anthropic-direct ativo');
    return { provider, providerName: 'anthropic-direct', model };
  }

  logger.info({}, '[llm] provedor mock ativo (sem chamadas reais)');
  return { provider: createLlmProvider({ provider: 'mock' }), providerName: 'mock', model: 'mock' };
}
