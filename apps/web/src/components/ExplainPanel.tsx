/**
 * ExplainPanel — Painel lateral "Explica pra mim".
 *
 * Abre da direita como painel inline, nao modal centrado.
 * Conteudo vem do endpoint GET /marketing-kb/kpi/:metric_key (deterministico, sem LLM).
 *
 * Estados (wireframe §2.4):
 *   loading          : skeleton titulo + definicao + formula
 *   ready-with-value : definicao + "Seu [metrica] agora" com valor real [ref:]
 *   ready-no-value   : definicao + "Sem dados para este periodo" honesto
 *   sem-definicao    : metrica nao esta no marketing-kb — CTA para chat
 *   error            : falha ao buscar — CTA retry
 *
 * A11y:
 *   - role="complementary" aria-label="Explica pra mim"
 *   - aria-modal="true" trap de foco no painel aberto
 *   - Foco inicial no botao Fechar (wireframe §2.5)
 *   - ESC fecha + foco retorna ao trigger (icone [?])
 *   - Overlay fecha ao clique
 *
 * Animacao (wireframe §2.5):
 *   Abertura: translateX(100%) → translateX(0) em 350ms --mkv-ease-enter
 *   Fechamento: translateX(0) → translateX(100%) em 200ms --mkv-ease-exit
 *   Overlay: opacity 0 → 1 em 150ms
 */

import '../styles/screen-explain.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { ApiError } from '../lib/api-client';
import { t } from '../lib/i18n';
import { Skeleton } from './Skeleton';

/* ================================================================
   TIPOS — contrato GET /marketing-kb/kpi/:metric_key
   ================================================================ */

interface KbSourceRef {
  readonly id: string;
  readonly source: string;
  readonly period?: string | undefined;
  readonly account?: string | undefined;
}

interface KbCurrentValue {
  readonly value: string;
  readonly unit?: string | undefined;
  readonly refs: readonly KbSourceRef[];
}

interface KpiKbData {
  readonly metric_key: string;
  readonly name_pt: string;
  readonly definition: string;
  readonly formula?: string | undefined;
  readonly benchmark?: string | undefined;
  readonly kb_ref: string;
  readonly current_value: KbCurrentValue | null;
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ready-with-value'; data: KpiKbData }
  | { kind: 'ready-no-value'; data: KpiKbData }
  | { kind: 'sem-definicao' }
  | { kind: 'error' };

/* ================================================================
   PROPS
   ================================================================ */

export interface ExplainPanelProps {
  /**
   * metric_key do KPI a explicar.
   * null = painel fechado; string = painel aberto para este KPI.
   */
  readonly metricKey: string | null;
  /** Callback quando painel deve fechar. */
  readonly onClose: () => void;
  /** Ref do elemento que abriu o painel — foco retorna aqui ao fechar. */
  readonly triggerRef?: React.RefObject<HTMLElement | null> | undefined;
}

/* ================================================================
   HELPERS
   ================================================================ */

/**
 * Formata source refs em texto legivel: "Meta Ads · 01/06–30/06"
 */
function formatRef(ref: KbSourceRef): string {
  const sourceLabel = ref.source.replace(/_/g, ' ');
  const parts: string[] = [sourceLabel];
  if (ref.account !== undefined && ref.account.length > 0) parts.push(ref.account);
  if (ref.period !== undefined && ref.period.length > 0) parts.push(ref.period);
  return parts.join(' · ');
}

/* ================================================================
   COMPONENTE
   ================================================================ */

export function ExplainPanel({
  metricKey,
  onClose,
  triggerRef,
}: ExplainPanelProps): JSX.Element | null {
  const [panelState, setPanelState] = useState<PanelState>({ kind: 'loading' });
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* ------------------------------------------------------------------
     Abrir / fechar — ciclo de animacao
     ------------------------------------------------------------------ */

  const handleClose = useCallback((): void => {
    setIsClosing(true);
    // Apos animacao de saida (200ms) chama o onClose
    setTimeout(() => {
      setIsClosing(false);
      setIsVisible(false);
      onClose();
      // Foco retorna ao trigger
      if (triggerRef?.current) {
        triggerRef.current.focus();
      }
    }, 210);
  }, [onClose, triggerRef]);

  /* ------------------------------------------------------------------
     Quando metricKey muda: abrir e buscar dados
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (metricKey === null) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    setIsClosing(false);
    setPanelState({ kind: 'loading' });

    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      try {
        const data = await apiClient.get<KpiKbData>(
          `/marketing-kb/kpi/${encodeURIComponent(metricKey)}`,
        );
        if (cancelled) return;

        if (data.current_value !== null) {
          setPanelState({ kind: 'ready-with-value', data });
        } else {
          setPanelState({ kind: 'ready-no-value', data });
        }
      } catch (err: unknown) {
        if (cancelled) return;

        if (err instanceof ApiError && err.status === 404) {
          setPanelState({ kind: 'sem-definicao' });
        } else {
          setPanelState({ kind: 'error' });
        }
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [metricKey]);

  /* ------------------------------------------------------------------
     Foco inicial no botao Fechar ao abrir (wireframe §2.5)
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (isVisible && !isClosing && panelState.kind !== 'loading') {
      closeButtonRef.current?.focus();
    }
  }, [isVisible, isClosing, panelState.kind]);

  /* ------------------------------------------------------------------
     ESC fecha o painel
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (!isVisible) return;

    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isVisible, handleClose]);

  /* ------------------------------------------------------------------
     Trap de foco dentro do painel
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (!isVisible || isClosing) return;

    const panel = panelRef.current;
    if (panel === null) return;

    const handleTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isVisible, isClosing]);

  /* ------------------------------------------------------------------
     Retry quando estado e error
     ------------------------------------------------------------------ */

  const handleRetry = useCallback((): void => {
    if (metricKey === null) return;
    setPanelState({ kind: 'loading' });

    const fetchData = async (): Promise<void> => {
      try {
        const data = await apiClient.get<KpiKbData>(
          `/marketing-kb/kpi/${encodeURIComponent(metricKey)}`,
        );
        if (data.current_value !== null) {
          setPanelState({ kind: 'ready-with-value', data });
        } else {
          setPanelState({ kind: 'ready-no-value', data });
        }
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 404) {
          setPanelState({ kind: 'sem-definicao' });
        } else {
          setPanelState({ kind: 'error' });
        }
      }
    };

    void fetchData();
  }, [metricKey]);

  /* ------------------------------------------------------------------
     Render — nao renderiza nada se nao esta visivel
     ------------------------------------------------------------------ */

  if (!isVisible && metricKey === null) return null;

  const panelClass = [
    'explain-panel',
    isVisible && !isClosing ? 'explain-panel--open' : '',
    isClosing ? 'explain-panel--closing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const metricLabel =
    panelState.kind === 'ready-with-value' || panelState.kind === 'ready-no-value'
      ? panelState.data.name_pt
      : (metricKey ?? '');

  return (
    <>
      {/* Overlay */}
      <div
        className={`explain-panel-overlay${isVisible && !isClosing ? ' explain-panel-overlay--visible' : ''}`}
        role="presentation"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Painel */}
      <div
        ref={panelRef}
        className={panelClass}
        role="complementary"
        aria-label={t('explain.panelAriaLabel')}
        aria-modal="true"
      >
        {/* Header */}
        <div className="explain-panel-header">
          <h2 className="explain-panel-heading" id="explain-panel-title">
            {t('explain.panelTitle')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="explain-panel-close"
            onClick={handleClose}
            aria-label={t('explain.closeBtnLabel')}
          >
            <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: 20 }}>
              close
            </span>
          </button>
        </div>

        <div className="explain-panel-divider" aria-hidden="true" />

        {/* Corpo por estado */}
        <div className="explain-panel-body">
          {/* Estado: loading */}
          {panelState.kind === 'loading' ? (
            <div
              className="explain-panel-loading"
              role="status"
              aria-busy="true"
              aria-label={t('common.loading')}
            >
              {/* titulo 24px/40% */}
              <Skeleton variant="heading" width="60%" />
              {/* definicao 3 linhas */}
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="90%" />
              <Skeleton variant="text" width="75%" />
              {/* formula 1 linha */}
              <Skeleton variant="text" width="50%" />
            </div>
          ) : null}

          {/* Estado: ready-with-value */}
          {panelState.kind === 'ready-with-value' ? (
            <ReadyContent
              data={panelState.data}
              showCurrentValue={true}
              metricKey={metricKey ?? ''}
            />
          ) : null}

          {/* Estado: ready-no-value */}
          {panelState.kind === 'ready-no-value' ? (
            <ReadyContent
              data={panelState.data}
              showCurrentValue={false}
              metricKey={metricKey ?? ''}
            />
          ) : null}

          {/* Estado: sem-definicao */}
          {panelState.kind === 'sem-definicao' ? (
            <div className="explain-panel-sem-definicao">
              <span
                className="material-symbols-rounded explain-panel-state-icon"
                aria-hidden="true"
              >
                help_outline
              </span>
              <p className="explain-panel-sem-definicao-text">{t('explain.semDefinicaoText')}</p>
              <Link to={`/chat?context=kpi:${metricKey ?? ''}`} className="explain-panel-cta-btn">
                {t('explain.askCrossCta', { metric: metricLabel })}
              </Link>
            </div>
          ) : null}

          {/* Estado: error */}
          {panelState.kind === 'error' ? (
            <div className="explain-panel-error" role="alert">
              <span
                className="material-symbols-rounded explain-panel-state-icon"
                aria-hidden="true"
              >
                error_outline
              </span>
              <p className="explain-panel-error-text">{t('explain.errorText')}</p>
              <button type="button" className="explain-panel-cta-btn" onClick={handleRetry}>
                {t('explain.retryCta')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ================================================================
   SUBCOMPONENTE: conteudo "ready" (with-value e no-value)
   ================================================================ */

interface ReadyContentProps {
  readonly data: KpiKbData;
  readonly showCurrentValue: boolean;
  readonly metricKey: string;
}

function ReadyContent({ data, showCurrentValue, metricKey }: ReadyContentProps): JSX.Element {
  return (
    <div className="explain-panel-ready">
      {/* Nome da metrica + chip [kb:] */}
      <div className="explain-panel-metric-header">
        <h3 className="explain-panel-metric-name">{data.name_pt}</h3>
        <span
          className="kb-chip"
          title={data.kb_ref}
          aria-label={`${t('explain.kbChipLabel')}: ${data.kb_ref}`}
        >
          kb:
        </span>
      </div>

      {/* Definicao */}
      <p className="explain-panel-definition">{data.definition}</p>

      {/* Formula (se disponivel) */}
      {data.formula !== undefined && data.formula.length > 0 ? (
        <div className="explain-panel-formula-block">
          <span className="explain-panel-formula-label">{t('explain.formulaLabel')}</span>
          <code className="explain-panel-formula">{data.formula}</code>
        </div>
      ) : null}

      {/* Benchmark (se disponivel) */}
      {data.benchmark !== undefined && data.benchmark.length > 0 ? (
        <div className="explain-panel-benchmark">
          <span className="explain-panel-benchmark-label">{t('explain.benchmarkLabel')}</span>
          <p className="explain-panel-benchmark-text">{data.benchmark}</p>
        </div>
      ) : null}

      <div className="explain-panel-divider" aria-hidden="true" />

      {/* Valor atual do tenant */}
      {showCurrentValue && data.current_value !== null ? (
        <div className="explain-panel-current-value">
          <span className="explain-panel-current-label">
            {t('explain.yourValueLabel', { metric: data.name_pt })}
          </span>
          <div className="explain-panel-current-row">
            <span className="explain-panel-current-number">
              {data.current_value.unit !== undefined && data.current_value.unit.length > 0
                ? `${data.current_value.value} ${data.current_value.unit}`
                : data.current_value.value}
            </span>
            {data.current_value.refs.length > 0 ? (
              <span
                className="ref-chip"
                title={formatRef(data.current_value.refs[0]!)}
                aria-label={`${t('explain.refChipLabel')}: ${formatRef(data.current_value.refs[0]!)}`}
              >
                ref:
              </span>
            ) : null}
          </div>
          {data.current_value.refs.length > 0 ? (
            <span className="explain-panel-ref-note">
              {t('explain.sourceNote', {
                source: data.current_value.refs[0]!.source.replace(/_/g, ' '),
                period: data.current_value.refs[0]!.period ?? '',
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Estado no-value: "sem dados honestos" */}
      {!showCurrentValue ? (
        <div className="explain-panel-no-value">
          <span className="material-symbols-rounded explain-panel-no-value-icon" aria-hidden="true">
            data_usage
          </span>
          <p className="explain-panel-no-value-text">{t('explain.noDataText')}</p>
          <Link to="/sources" className="explain-panel-cta-link">
            {t('explain.connectSourceCta')}
          </Link>
        </div>
      ) : null}

      <div className="explain-panel-divider" aria-hidden="true" />

      {/* CTAs finais */}
      <div className="explain-panel-ctas">
        <p className="explain-panel-ctas-label">{t('explain.ctasLabel')}</p>

        <Link to={`/chat?context=kpi:${metricKey}`} className="explain-panel-cta-btn">
          <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: 16 }}>
            forum
          </span>
          {t('explain.askCrossCta', { metric: data.name_pt })}
        </Link>

        <Link to={`/dashboard?metric=${metricKey}`} className="explain-panel-cta-secondary">
          <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: 16 }}>
            bar_chart
          </span>
          {t('explain.viewHistoryCta')}
        </Link>
      </div>
    </div>
  );
}
