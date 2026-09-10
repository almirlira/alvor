import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { PageHeading } from '../components/PageHeading';
import { areaLabels, taskStatusLabels, alphaTasks, type AlphaTaskStatus } from '../lib/alpha-research';

interface FeedbackNote {
  readonly id: string;
  readonly area: string;
  readonly task_id: string | null;
  readonly ease: number;
  readonly outcome: AlphaTaskStatus;
  readonly comment: string | null;
  readonly status: 'aberta' | 'em_analise' | 'resolvida';
  readonly note: string | null;
  readonly created_at: string;
}

export function FeedbackPage(): JSX.Element {
  const [notes, setNotes] = useState<FeedbackNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setNotes(await apiClient.get<FeedbackNote[]>('/feedback'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar observacoes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <PageHeading
        id="feedback-title"
        title="Relatos"
        subtitle="Historico dos relatos enviados durante a alpha dos fundadores."
      />

      <div className="feedback-list feedback-list-full" aria-live="polite">
        {error !== null && <p className="dre-err">{error}</p>}
        {loading ? <p className="dre-empty">Carregando relatos...</p> : null}
        {!loading && notes.length === 0 ? <p className="dre-empty">Ainda nao ha relatos neste acesso. Use o botao Enviar relato durante o teste.</p> : null}
        {notes.map((item) => {
          const task = alphaTasks.find((entry) => entry.id === item.task_id);
          return (
            <article className="dre-card feedback-item" key={item.id}>
              <div className="feedback-meta">
                <span>{areaLabels[item.area] ?? item.area}</span>
                <span>{task?.title ?? 'Exploracao livre'}</span>
                <span>Facilidade {item.ease}/7</span>
                <span>{taskStatusLabels[item.outcome]}</span>
                <span>{new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
              </div>
              <p>{item.comment ?? item.note ?? 'Sem comentario adicional.'}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
