import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { PageHeading } from '../components/PageHeading';

interface AlphaParticipant {
  readonly participantId: string;
  readonly name: string;
  readonly organizer: boolean;
  readonly lastSeen: string | null;
  readonly usageCount: number;
  readonly feedbackCount: number;
  readonly hasDre: boolean;
}

interface AlphaReport {
  readonly generatedAt: string;
  readonly participants: readonly AlphaParticipant[];
}

export function AlphaReportPage(): JSX.Element {
  const [report, setReport] = useState<AlphaReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      setReport(await apiClient.get<AlphaReport>('/alpha/report'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o relatorio da alpha.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <PageHeading
        id="alpha-title"
        title="Alpha"
        subtitle="Acompanhamento rapido do uso e dos relatos por fundador."
      >
        <button className="dre-btn secondary" type="button" onClick={() => void load()}>Atualizar</button>
      </PageHeading>

      {error !== null && <p className="dre-err">{error}</p>}
      {report === null && error === null ? <p className="dre-empty">Carregando relatorio...</p> : null}
      {report !== null && (
        <div className="alpha-report-grid">
          {report.participants.map((item) => (
            <article className="dre-card alpha-report-card" key={item.participantId}>
              <div>
                <span className="dre-eyebrow">{item.participantId}{item.organizer ? ' · organizador' : ''}</span>
                <h3>{item.name}</h3>
              </div>
              <dl>
                <div><dt>Uso</dt><dd>{item.usageCount}</dd></div>
                <div><dt>Relatos</dt><dd>{item.feedbackCount}</dd></div>
                <div><dt>DRE</dt><dd>{item.hasDre ? 'carregada' : 'pendente'}</dd></div>
                <div><dt>Ultimo acesso</dt><dd>{item.lastSeen === null ? 'sem acesso' : new Date(item.lastSeen).toLocaleString('pt-BR')}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
