import '../styles/screen-chat.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatBubble, TypingBubble } from '../components/ChatBubble';
import type { ChatMessageData, ChatSource } from '../components/ChatMessage';
import { apiClient, ApiError } from '../lib/api-client';
import { useDre } from '../lib/dre-context';
import { formatBRL, monthLong, monthShort } from '../lib/format';

export type CopilotSource = ChatSource & {
  readonly value?: number;
  readonly unit?: string;
  readonly detail?: string;
};

export interface InsightResult {
  readonly id: string;
  readonly month: string;
  readonly text: string;
  readonly sources: readonly CopilotSource[];
  readonly validationPassed: boolean;
  readonly usedLlm: boolean;
  readonly fallbackReason?: 'no_data' | 'out_of_scope' | 'ambiguous';
  readonly triggeredRules: readonly { readonly id: string; readonly title: string }[];
  readonly generatedAt: string;
  readonly model: string;
  readonly latencyMs: number;
}

const SUGGESTIONS = [
  'Qual despesa mais cresceu em relacao ao mes anterior?',
  'Quanto sobra de cada real vendido depois do CMV?',
  'O que eu corto primeiro sem derrubar a receita?',
];

export function CopilotPage(): JSX.Element {
  const { data } = useDre();
  const navigate = useNavigate();
  const months = data?.statement.months ?? [];
  const lastMonth = months[months.length - 1] ?? null;

  const [insight, setInsight] = useState<InsightResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<ChatMessageData[]>([]);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [activeSource, setActiveSource] = useState<CopilotSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        setInsight(await apiClient.get<InsightResult>('/insights/current'));
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) setError('Nao consegui carregar o ultimo insight.');
      }
      try {
        setHistory(await apiClient.get<ChatMessageData[]>('/copilot/history'));
      } catch {
        // sem historico
      }
    })();
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, asking]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      setInsight(await apiClient.post<InsightResult>('/insights/generate', { month: lastMonth }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar insights.');
    } finally {
      setGenerating(false);
    }
  }, [lastMonth]);

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (q.length === 0 || asking) return;
      setQuestion('');
      setAsking(true);
      setError(null);
      const userMsg: ChatMessageData = { id: `u-${Date.now()}`, role: 'user', content: q };
      setHistory((h) => [...h, userMsg]);
      try {
        const res = await apiClient.post<{ message: ChatMessageData }>('/copilot/ask', { question: q });
        setHistory((h) => [...h, res.message]);
      } catch (err) {
        setHistory((h) => [
          ...h,
          { id: `e-${Date.now()}`, role: 'assistant', content: err instanceof Error ? err.message : 'Falha na resposta.', isError: true },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [asking],
  );

  if (!data || lastMonth === null) {
    return (
      <div className="dre-empty">
        <p>Envie uma DRE para o Copilot ter o que ler.</p>
        <button type="button" className="dre-btn" onClick={() => navigate('/enviar')}>Enviar arquivos</button>
      </div>
    );
  }

  const insightMessage: ChatMessageData | null =
    insight === null
      ? null
      : {
          id: insight.id,
          role: 'assistant',
          content: insight.text,
          sources: insight.sources,
          ...(insight.fallbackReason !== undefined ? { fallbackReason: insight.fallbackReason } : {}),
        };

  const onSourceClick = (s: ChatSource): void => setActiveSource(s as CopilotSource);

  return (
    <>
      <div className="dre-head">
        <div>
          <div className="dre-eyebrow">Copilot financeiro</div>
          <h1 className="dre-title">Copilot — {monthLong(lastMonth)}</h1>
          <p className="dre-subtitle">Todo numero citado tem fonte na sua DRE. Se nao tem o dado, ele diz que nao tem.</p>
        </div>
        <button type="button" className="dre-btn" disabled={generating} onClick={() => void generate()}>
          {generating ? 'Lendo a DRE…' : insight ? 'Gerar de novo' : 'Gerar insights do mes'}
        </button>
      </div>

      {error !== null && <div className="dre-err">{error}</div>}

      <div className="dre-copilot">
        <div>
          <section className="dre-card">
            <h3>Leitura do mes</h3>
            {generating && (
              <>
                <TypingBubble />
                <p className="dre-thinking">Rodando as regras de diagnostico sobre a DRE e escrevendo a leitura com as fontes…</p>
              </>
            )}
            {!generating && insightMessage === null && (
              <p className="dre-subtitle">Clique em "Gerar insights do mes": o Copilot roda as regras de diagnostico sobre a DRE e escreve a leitura com as fontes.</p>
            )}
            {!generating && insightMessage !== null && insight !== null && (
              <>
                <ChatBubble message={insightMessage} onSourceClick={onSourceClick} activeRef={activeSource?.id ?? null} />
                <div className="dre-rules">
                  {insight.triggeredRules.map((r) => <span key={r.id} className="dre-chip" title={r.id}>regra: {r.title}</span>)}
                  <span className="dre-chip" title={insight.model}>
                    {insight.usedLlm ? `IA ${insight.validationPassed ? 'validada' : 'reprovada → texto deterministico'}` : 'texto deterministico (sem IA)'} · {(insight.latencyMs / 1000).toFixed(1)}s
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="dre-card" style={{ marginTop: 16 }}>
            <h3>Perguntar ao Copilot</h3>
            <div className="cs-suggestions" style={{ marginBottom: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="cs-suggestion-chip" onClick={() => void ask(s)} disabled={asking}>{s}</button>
              ))}
            </div>
            <div className="cs-thread" ref={threadRef} style={{ maxHeight: 460, overflowY: 'auto' }}>
              {history.map((m, i) => (
                <ChatBubble key={m.id} message={m} animIndex={i} onSourceClick={onSourceClick} activeRef={activeSource?.id ?? null} onSuggestion={(t) => void ask(t)} />
              ))}
              {asking && (
                <>
                  <TypingBubble />
                  <p className="dre-thinking">Lendo a DRE, aplicando as regras e conferindo cada numero contra a fonte…</p>
                </>
              )}
            </div>
            <form
              className="cs-input-bar"
              onSubmit={(e) => { e.preventDefault(); void ask(question); }}
            >
              <div className="cs-input-wrap">
                <input
                  className="cs-input-field"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={`Pergunte sobre ${monthShort(lastMonth)} ou compare meses…`}
                  aria-label="Pergunta ao Copilot"
                  disabled={asking}
                />
              </div>
              <button type="submit" className="cs-send-btn" disabled={asking || question.trim().length === 0} aria-label="Enviar">
                <span className="material-symbols-rounded" aria-hidden="true">send</span>
              </button>
            </form>
          </section>
        </div>

        <aside className="dre-card dre-source-panel">
          <h3>Fonte citada</h3>
          {activeSource === null ? (
            <p className="dre-subtitle">Clique em um numero sublinhado na resposta para ver de onde ele veio.</p>
          ) : (
            <dl>
              <dt>O que</dt><dd>{activeSource.label}</dd>
              {activeSource.period !== undefined && <><dt>Periodo</dt><dd>{activeSource.period}</dd></>}
              {activeSource.value !== undefined && (
                <><dt>Valor</dt><dd>{activeSource.unit === '%' ? `${activeSource.value.toLocaleString('pt-BR')}%` : formatBRL(activeSource.value, true)}</dd></>
              )}
              {activeSource.detail !== undefined && <><dt>Origem</dt><dd style={{ fontWeight: 400 }}>{activeSource.detail}</dd></>}
              <dt>Ref</dt><dd style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 400 }}>{activeSource.id}</dd>
            </dl>
          )}
          {activeSource !== null && (
            <div className="dre-actions">
              <button type="button" className="dre-btn secondary" onClick={() => navigate('/painel')}>Ver no painel</button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
