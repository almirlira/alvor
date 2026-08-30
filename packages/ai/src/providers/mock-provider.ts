/**
 * MockLlmProviderAdapter — implementacao determinista da LlmProvider para
 * dev local e testes. Substitui chamada real ao Vertex quando
 * `LLM_PROVIDER=mock`.
 *
 * NAO usar em producao. Factory recusa instanciar este adapter se
 * `NODE_ENV=production`.
 *
 * A regra e ecoar refs scoped do contexto em formato valido de grounding
 * (`[ref:ID]`) para nao quebrar o OutputValidator downstream.
 */

import type { LlmMessages } from '../prompt-assembler.js';
import {
  approximateTokenCount,
  type LlmGenerateOptions,
  type LlmProvider,
  type LlmProviderHealth,
  type LlmResponse,
  type LlmStreamChunk,
} from './provider-interface.js';

export interface MockProviderOptions {
  /** Resposta fixa. Se nao definida, ecoa refs scoped como grounded. */
  readonly fixedResponse?: string;
  /** Latencia simulada (ms) — util para testes de timeout. */
  readonly simulatedLatencyMs?: number;
}

export class MockLlmProviderAdapter implements LlmProvider {
  public readonly name = 'mock';
  private readonly fixedResponse: string | undefined;
  private readonly simulatedLatencyMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.fixedResponse = options.fixedResponse;
    this.simulatedLatencyMs = options.simulatedLatencyMs ?? 0;
  }

  async generate(messages: LlmMessages, _opts?: LlmGenerateOptions): Promise<LlmResponse> {
    const started = Date.now();
    if (this.simulatedLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulatedLatencyMs));
    }

    const text = this.fixedResponse ?? this.defaultResponse(messages);
    const tokensIn = approximateTokenCount(messages);
    const tokensOut = Math.ceil(text.length / 4);

    return {
      text,
      usage: { tokensIn, tokensOut },
      model: 'mock-v0',
      provider: this.name,
      region: 'local',
      latencyMs: Date.now() - started,
      finishReason: 'stop',
    };
  }

  async *stream(messages: LlmMessages, opts?: LlmGenerateOptions): AsyncIterable<LlmStreamChunk> {
    const full = await this.generate(messages, opts);
    // Emite 1 chunk com o texto inteiro + done=true.
    yield { deltaText: full.text, done: true };
  }

  countTokens(messages: LlmMessages): Promise<number> {
    return Promise.resolve(approximateTokenCount(messages));
  }

  health(): Promise<LlmProviderHealth> {
    return Promise.resolve({ status: 'ok', detail: 'mock provider always ok' });
  }

  private defaultResponse(messages: LlmMessages): string {
    const refs = messages.sourceRefs;
    if (refs.length === 0) {
      // Resposta de chat sem contexto rico (provider real desligado, contexto
      // ainda nao carregado). Em vez de "nao tenho dados suficientes" seco,
      // damos uma resposta util que orienta o owner.
      return [
        'Estou em modo de demonstracao no seu ambiente local — minha inteligencia completa precisa de configuracao adicional (provedor de IA no .env).',
        'Mesmo assim, posso te apoiar: conecte mais fontes em Fontes, gere um resumo em Insights, ou pergunte sobre uma campanha especifica.',
        'Quando minha inteligencia estiver ligada, vou ler seus KPIs e responder com numeros e recomendacoes do seu negocio.',
      ].join(' ');
    }
    // Texto qualitativo curto em tom executivo. Sem citar numeros (mock nao
    // sabe interpretar) mas preservando refs anchored no final para que o
    // grounding validator + auditoria mantenham rastreabilidade com os
    // kpi_snapshots usados na construcao do contexto.
    const refAnchors = refs
      .slice(0, 3)
      .map((r) => `[ref:${r.id}]`)
      .join(' ');
    // O prefixo de demonstracao e OBRIGATORIO (2026-08-11). Sem ele este texto
    // se parece com uma analise real e o owner nao tem como saber que a
    // inteligencia esta desligada — foi exatamente o cenario que o diagnostico
    // da Etapa 0 precisou descartar consultando o banco. Um provider de
    // demonstracao nunca deve ser confundivel com o provider real.
    return [
      '[modo de demonstracao — a inteligencia real esta desligada neste ambiente]',
      'Encontrei movimento consistente nas suas campanhas no periodo analisado.',
      'Seus indicadores de preco e alcance estao dentro de uma faixa saudavel para um piloto desta etapa.',
      'Para entender o que esta funcionando melhor e onde focar agora, abra o chat e pergunte sobre o eixo que mais te interessa.',
      refAnchors,
    ].join(' ');
  }
}
