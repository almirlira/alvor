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
        title="Gestão da alpha"
        subtitle="Acompanhe a atividade individual, os relatos enviados e a DRE disponível em cada acesso."
      >
        <button className="dre-btn secondary" type="button" onClick={() => void load()}>Atualizar</button>
      </PageHeading>

      {error !== null && <p className="dre-err">{error}</p>}
      {report === null && error === null ? <p className="dre-empty">Carregando relatório...</p> : null}
      {report !== null && (
        <>
          <div className="alpha-report-summary" aria-label="Resumo da alpha">
            <div><span>Acessos convidados</span><strong>{report.participants.length}</strong></div>
            <div><span>Com atividade</span><strong>{report.participants.filter((item) => item.lastSeen !== null).length}</strong></div>
            <div><span>Relatos recebidos</span><strong>{report.participants.reduce((sum, item) => sum + item.feedbackCount, 0)}</strong></div>
          </div>
          <div className="alpha-report-grid">
            {report.participants.map((item) => (
              <article className="dre-card alpha-report-card" key={item.participantId}>
                <header className="alpha-report-identity">
                  <span className={`alpha-activity-dot${item.lastSeen === null ? '' : ' is-active'}`} aria-hidden="true" />
                  <div>
                    <span className="dre-eyebrow">{item.participantId}{item.organizer ? ' · organizador' : ''}</span>
                    <h3>{item.name}</h3>
                  </div>
                </header>
                <dl>
                  <div><dt title="Ações autenticadas registradas neste acesso">Interações</dt><dd>{item.usageCount}</dd></div>
                  <div><dt>Relatos</dt><dd>{item.feedbackCount}</dd></div>
                  <div><dt>DRE</dt><dd><span className={`alpha-dre-status ${item.hasDre ? 'is-ready' : ''}`}>{item.hasDre ? 'Carregada' : 'Pendente'}</span></dd></div>
                  <div><dt>Última atividade</dt><dd className="alpha-last-seen">{item.lastSeen === null ? 'Sem acesso' : new Date(item.lastSeen).toLocaleString('pt-BR')}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
