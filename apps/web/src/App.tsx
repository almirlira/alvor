import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { DreProvider, useDre } from './lib/dre-context';
import { apiClient } from './lib/api-client';
import { AuthProvider, useAuth } from './lib/auth-context';
import { UploadPage } from './routes/UploadPage';
import { PainelPage } from './routes/PainelPage';
import { CopilotPage } from './routes/CopilotPage';
import { SemaforoPage, type SemaforoResult } from './routes/SemaforoPage';
import { FeedbackPage } from './routes/FeedbackPage';
import { LoginPage } from './routes/LoginPage';
import { AlphaReportPage } from './routes/AlphaReportPage';
import { TickerBar } from './components/TickerBar';
import { AlphaFeedbackPanel } from './components/AlphaFeedbackPanel';

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

type RailIconName = 'grid' | 'traffic' | 'forum' | 'upload' | 'list' | 'monitoring' | 'logout';

function RailIcon({ name }: { readonly name: RailIconName }): JSX.Element {
  const common = { vectorEffect: 'non-scaling-stroke' as const };
  const paths: Record<RailIconName, JSX.Element> = {
    grid: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" {...common} />
        <rect x="13" y="4" width="7" height="7" rx="1.5" {...common} />
        <rect x="4" y="13" width="7" height="7" rx="1.5" {...common} />
        <rect x="13" y="13" width="7" height="7" rx="1.5" {...common} />
      </>
    ),
    traffic: (
      <>
        <rect x="8" y="3" width="8" height="18" rx="4" {...common} />
        <circle cx="12" cy="8" r="1.2" fill="currentColor" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        <circle cx="12" cy="16" r="1.2" fill="currentColor" />
      </>
    ),
    forum: (
      <>
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h6A2.5 2.5 0 0 1 16 6.5V10a2.5 2.5 0 0 1-2.5 2.5H10L6.5 15v-2.5A2.5 2.5 0 0 1 5 10V6.5Z" {...common} />
        <path d="M13 15h2.5l2 2v-2A2.5 2.5 0 0 0 20 12.5V10a2.5 2.5 0 0 0-2-2.45" {...common} />
      </>
    ),
    upload: (
      <>
        <path d="M12 15V4" {...common} />
        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" {...common} />
        <path d="M5 16.5v1A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-1" {...common} />
      </>
    ),
    list: (
      <>
        <path d="M8 6h12" {...common} />
        <path d="M8 12h12" {...common} />
        <path d="M8 18h12" {...common} />
        <circle cx="4.5" cy="6" r="1" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1" fill="currentColor" />
      </>
    ),
    monitoring: (
      <>
        <path d="M4 19h16" {...common} />
        <path d="M7 16v-5" {...common} />
        <path d="M12 16V6" {...common} />
        <path d="M17 16v-8" {...common} />
      </>
    ),
    logout: (
      <>
        <path d="M10 6H7.5A2.5 2.5 0 0 0 5 8.5v7A2.5 2.5 0 0 0 7.5 18H10" {...common} />
        <path d="M13 8l4 4-4 4" {...common} />
        <path d="M17 12H9" {...common} />
      </>
    ),
  };

  return (
    <svg className="dre-rail-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

function Rail(): JSX.Element {
  const { data } = useDre();
  const auth = useAuth();
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

  const item = (to: string, icon: RailIconName, label: string, badge?: number | null): JSX.Element => (
    <NavLink to={to} className={({ isActive }) => `dre-rail-item${isActive ? ' active' : ''}`}>
      <RailIcon name={icon} />
      <span className="dre-rail-label">{label}</span>
      {badge !== undefined && badge !== null && badge > 0 && <span className="dre-rail-count" aria-label={`${badge} itens que pedem validação`}>{badge}</span>}
    </NavLink>
  );
  return (
    <nav className={`dre-rail${auth.organizer ? ' organizer' : ''}`} aria-label="Navegação principal">
      <div className="dre-rail-logo"><AlvorMark /><span>ALVOR</span></div>
      {auth.enabled && auth.participantName !== null && (
        <div className="alpha-user-chip">
          <span>{auth.participantId}</span>
          <strong>{auth.participantName}</strong>
        </div>
      )}
      {item('/painel', 'grid', 'Painel')}
      {item('/semaforo', 'traffic', 'Semáforo', alerts)}
      {item('/copilot', 'forum', 'Copilot')}
      {item('/enviar', 'upload', 'Arquivos')}
      {item('/relatos', 'list', 'Relatos')}
      {auth.organizer && item('/gestao', 'monitoring', 'Gestão')}
      <button className="dre-rail-item rail-feedback" type="button" onClick={() => window.dispatchEvent(new CustomEvent('alvor:open-feedback'))}>
        <RailIcon name="forum" />
        <span className="dre-rail-label">Dar relato</span>
      </button>
      {auth.enabled && (
        <button className="dre-rail-item rail-logout" type="button" onClick={() => void auth.signOut()}>
          <RailIcon name="logout" />
          Sair
        </button>
      )}
    </nav>
  );
}

function MobileHeader(): JSX.Element {
  const auth = useAuth();
  if (!auth.enabled || auth.participantName === null) return <></>;
  return (
    <header className="dre-mobile-header">
      <div className="dre-mobile-brand" aria-label="ALVOR"><AlvorMark /><span>ALVOR</span></div>
      <div className="dre-mobile-user">
        <span>{auth.participantId}</span>
        <strong>{auth.participantName}</strong>
      </div>
      <button className="dre-mobile-feedback" type="button" onClick={() => window.dispatchEvent(new CustomEvent('alvor:open-feedback'))} aria-label="Enviar relato sobre o teste">
        <RailIcon name="forum" />
        <span>Relato</span>
      </button>
      <button className="dre-mobile-logout" type="button" onClick={() => void auth.signOut()} aria-label="Sair do ALVOR">
        <RailIcon name="logout" />
        <span>Sair</span>
      </button>
    </header>
  );
}

function ProductShell(): JSX.Element {
  const auth = useAuth();
  if (auth.enabled && auth.loading) return <div className="dre-empty">Carregando acesso...</div>;
  if (auth.enabled && auth.session === null) return <LoginPage />;

  return (
    <DreProvider>
      <div className="dre-shell">
        <MobileHeader />
        <Rail />
        <main className="dre-main">
          <Routes>
            <Route path="/" element={<RootIndex />} />
            <Route path="/enviar" element={<UploadPage />} />
            <Route path="/painel" element={<PainelPage />} />
            <Route path="/semaforo" element={<SemaforoPage />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/fundadores" element={<RootIndex />} />
            <Route path="/relatos" element={<FeedbackPage />} />
            <Route path="/gestao" element={<AlphaReportPage />} />
            {/* apelidos de rota mantidos por compatibilidade */}
            <Route path="/observacoes" element={<Navigate to="/relatos" replace />} />
            <Route path="/alpha" element={<Navigate to="/gestao" replace />} />
            <Route path="/chat" element={<Navigate to="/copilot" replace />} />
            <Route path="/dashboard" element={<Navigate to="/painel" replace />} />
            <Route path="/sources" element={<Navigate to="/enviar" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <AlphaFeedbackPanel />
        <TickerBar />
      </div>
    </DreProvider>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ProductShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
