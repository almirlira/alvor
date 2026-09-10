import { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { AppIcon } from './AppIcon';
import { Sparkline } from './Sparkline';
import { ExplainPanel } from './ExplainPanel';

interface KpiCardProps {
  readonly title: string;
  readonly value: string | null;
  readonly unit?: string | undefined;
  readonly delta?: number | null | undefined;
  readonly series?: readonly number[] | undefined;
  readonly loading?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly ariaLabel?: string | undefined;
  /**
   * Explicacao amigavel do KPI — renderizada abaixo do valor para
   * facilitar entendimento (dono nao-tecnico).
   */
  readonly description?: string | undefined;
  /**
   * Quando true, aplica o estilo de card-heroi (filete gradiente-assinatura
   * de 4px no topo + elevacao maior). Maximo 1 hero por tela.
   */
  readonly hero?: boolean | undefined;
  /**
   * Chave de metrica do marketing-kb.
   * Quando fornecida, exibe o icone [?] que abre o painel "Explica pra mim".
   * Wireframe §2.2: icone visivel (opacity 0.4 idle, 1.0 ao hover no card).
   */
  readonly metricKey?: string | undefined;
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

export function KpiCard({
  title,
  value,
  unit,
  delta,
  series,
  loading,
  onClick,
  ariaLabel,
  description,
  hero,
  metricKey,
}: KpiCardProps): JSX.Element {
  const deltaClass =
    delta === undefined || delta === null
      ? ''
      : delta > 0
        ? 'kpi-delta kpi-delta-up'
        : delta < 0
          ? 'kpi-delta kpi-delta-down'
          : 'kpi-delta kpi-delta-flat';

  const heroClass = hero === true ? 'kpi-card-hero' : '';

  // Estado do painel "Explica pra mim"
  const [explainOpen, setExplainOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const handleHelpClick = (e: React.MouseEvent): void => {
    e.stopPropagation(); // Nao ativar o onClick do card
    setExplainOpen(true);
  };

  const handleHelpKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setExplainOpen(true);
    }
  };

  const helpButton =
    metricKey !== undefined && metricKey.length > 0 ? (
      <button
        ref={helpButtonRef}
        type="button"
        className="kpi-card-help-btn"
        aria-label={t('explain.helpIconAriaLabel', { metric: title })}
        onClick={handleHelpClick}
        onKeyDown={handleHelpKeyDown}
        // aria-expanded indica se o painel esta aberto para este icone
        aria-expanded={explainOpen}
        aria-haspopup="dialog"
        // data-active para estilo CSS enquanto painel esta aberto
        data-active={explainOpen ? 'true' : undefined}
        tabIndex={0}
      >
        <AppIcon name="help" />
      </button>
    ) : null;

  const content = (
    <>
      <div className="kpi-card-title-row">
        <h3>{title}</h3>
        {helpButton}
      </div>
      <p className="kpi-value">
        {loading === true
          ? t('common.loading')
          : value !== null
            ? unit !== undefined && unit.length > 0
              ? `${value} ${unit}`
              : value
            : t('dashboard.kpis.placeholder')}
      </p>
      {delta !== undefined && delta !== null && !loading ? (
        <span className={deltaClass} aria-label={formatDelta(delta)}>
          {formatDelta(delta)}
        </span>
      ) : null}
      {description !== undefined && description.length > 0 && !loading ? (
        <p className="kpi-description muted">{description}</p>
      ) : null}
      {series !== undefined && series.length > 0 && !loading ? (
        <Sparkline points={series} ariaLabel={title} />
      ) : null}
    </>
  );

  // Ref com tipo correto para o ExplainPanel
  const triggerRef = helpButtonRef as React.RefObject<HTMLElement | null>;

  const panel =
    metricKey !== undefined && metricKey.length > 0 ? (
      <ExplainPanel
        metricKey={explainOpen ? metricKey : null}
        onClose={() => setExplainOpen(false)}
        triggerRef={triggerRef}
      />
    ) : null;

  if (onClick !== undefined) {
    return (
      <>
        <button
          type="button"
          className={`kpi-card kpi-card-clickable ${heroClass}${metricKey !== undefined ? ' kpi-card-has-help' : ''}`}
          aria-busy={loading === true}
          aria-label={ariaLabel ?? title}
          onClick={onClick}
        >
          {content}
        </button>
        {panel}
      </>
    );
  }

  return (
    <>
      <article
        className={`kpi-card ${heroClass}${metricKey !== undefined ? ' kpi-card-has-help' : ''}`}
        aria-busy={loading === true}
      >
        {content}
      </article>
      {panel}
    </>
  );
}
