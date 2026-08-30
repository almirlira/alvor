import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { DreProvider, useDre } from './lib/dre-context';
import { apiClient } from './lib/api-client';
import { UploadPage } from './routes/UploadPage';
import { PainelPage } from './routes/PainelPage';
import { CopilotPage } from './routes/CopilotPage';
import { SemaforoPage, type SemaforoResult } from './routes/SemaforoPage';
import { TickerBar } from './components/TickerBar';
import './styles/screen-dre.css';
import './styles/alvor-theme.css';

export const APP_NAME = 'ALVOR';

function RootIndex(): JSX.Element {
  const { data, loading } = useDre();
  if (loading) return <div className="dre-empty">Carregando…</div>;
  return <Navigate to={data === null ? '/enviar' : '/painel'} replace />;
}

/** Simbolo ALVOR (marca do design system) — recorte do SVG oficial. */
function AlvorMark(): JSX.Element {
  return (
    <svg viewBox="0 0 316 226" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M187.422 112.463L282.399 47.835L315.737 96.8271L213.72 166.245H102.017L0 96.8271L33.3369 47.835L128.163 112.359V0H187.422V112.463Z" fill="#FF5500" />
      <rect y="166.245" width="315.585" height="59.2592" fill="#FF5500" />
    </svg>
  );
}

function Rail(): JSX.Element {
  const { data } = useDre();
  const [alerts, setAlerts] = useState<number | null>(null);
  useEffect(() => {
    if (data === null) { setAlerts(null); return; }
    void (async () => {
      try {
        const r = await apiClient.get<SemaforoResult>('/semaforo');
        setAlerts(r.counts.vermelho + r.counts.amarelo);
      } catch {
        setAlerts(null);
      }
    })();
  }, [data]);

  const item = (to: string, icon: string, label: string, badge?: number | null): JSX.Element => (
    <NavLink to={to} className={({ isActive }) => `dre-rail-item${isActive ? ' active' : ''}`}>
      <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
      {label}
      {badge !== undefined && badge !== null && badge > 0 && <span className="dre-rail-count" aria-label={`${badge} itens que pedem validacao`}>{badge}</span>}
    </NavLink>
  );
  return (
    <nav className="dre-rail" aria-label="Navegacao">
      <div className="dre-rail-logo"><AlvorMark /><span>ALVOR</span></div>
      {item('/painel', 'grid_view', 'Painel')}
      {item('/semaforo', 'traffic', 'Semaforo', alerts)}
      {item('/copilot', 'forum', 'Copilot')}
      {item('/enviar', 'upload_file', 'Enviar arquivos')}
    </nav>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <DreProvider>
        <div className="dre-shell">
          <Rail />
          <main className="dre-main">
            <Routes>
              <Route path="/" element={<RootIndex />} />
              <Route path="/enviar" element={<UploadPage />} />
              <Route path="/painel" element={<PainelPage />} />
              <Route path="/semaforo" element={<SemaforoPage />} />
              <Route path="/copilot" element={<CopilotPage />} />
              {/* apelidos de rota mantidos por compatibilidade */}
              <Route path="/chat" element={<Navigate to="/copilot" replace />} />
              <Route path="/dashboard" element={<Navigate to="/painel" replace />} />
              <Route path="/sources" element={<Navigate to="/enviar" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <TickerBar />
        </div>
      </DreProvider>
    </BrowserRouter>
  );
}
