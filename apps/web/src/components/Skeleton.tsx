/**
 * Skeleton — componente de carregamento ALVOR.
 *
 * Shape: retangulo com base creme --md-surface-container (nao azul-frio).
 * Animacao: pulse suave sobre a superficie creme ALVOR.
 * Acessibilidade: role="status" + aria-label no wrapper; shapes internos sao aria-hidden.
 *
 * Variantes:
 *   - text  : linha de texto (altura 1rem, border-radius xs)
 *   - heading : linha de titulo (altura 1.5rem, largura 60%, border-radius xs)
 *   - card  : bloco de card KPI completo (altura fixa, border-radius md)
 *   - kpi-value : numero grande (altura 2.5rem, largura 40%, border-radius xs)
 *   - progress-bar : barra horizontal fina (4px de altura)
 *
 * Anti-overengineering: so vira componente porque tem 4+ call-sites (Mirror,
 * Dashboard, Insights, Billing — todos com estado de loading).
 */

interface SkeletonProps {
  /** Variante visual do skeleton. */
  readonly variant?: 'text' | 'heading' | 'card' | 'kpi-value' | 'progress-bar';
  /** Largura CSS (padrao: 100%). */
  readonly width?: string;
  /**
   * Quando true, adiciona role="status" + aria-label no elemento.
   * Usar apenas quando o Skeleton e o unico indicador de loading na regiao.
   * Dentro de SkeletonGrid o wrapper ja tem o role, entao passar false.
   * Padrao: false (sem role explicito — aria-hidden do wrapper cobre).
   */
  readonly standalone?: boolean;
  /** aria-label acessivel para o bloco. Usado apenas quando standalone=true. */
  readonly ariaLabel?: string;
}

/**
 * Skeleton de linha de texto ou elemento individual.
 * Para um bloco de card completo, use SkeletonCard.
 * Para uma grade de cards, use SkeletonGrid.
 */
export function Skeleton({
  variant = 'text',
  width,
  standalone = false,
  ariaLabel = 'Carregando',
}: SkeletonProps): JSX.Element {
  const classes: Record<NonNullable<SkeletonProps['variant']>, string> = {
    text: 'skeleton skeleton-text',
    heading: 'skeleton skeleton-heading',
    card: 'skeleton skeleton-card',
    'kpi-value': 'skeleton skeleton-kpi-value',
    'progress-bar': 'skeleton skeleton-progress-bar',
  };

  return (
    <span
      className={classes[variant]}
      style={width !== undefined ? { width } : undefined}
      {...(standalone
        ? { role: 'status', 'aria-label': ariaLabel, 'aria-busy': 'true' }
        : { 'aria-hidden': 'true' })}
    />
  );
}

/**
 * SkeletonCard — simula um KpiCard completo durante loading.
 * Usado em grades de KPI (Mirror, Dashboard, Billing).
 */
export function SkeletonCard(): JSX.Element {
  return (
    <article className="skeleton-card-block" aria-busy="true" aria-label="Carregando indicador">
      <span className="skeleton skeleton-label" aria-hidden="true" />
      <span className="skeleton skeleton-kpi-value" aria-hidden="true" />
      <span className="skeleton skeleton-text" style={{ width: '50%' }} aria-hidden="true" />
    </article>
  );
}

/**
 * SkeletonGrid — grade de N SkeletonCards para substituir KpiGrid durante loading.
 * Tem role="status" unico no wrapper — os cards filhos sao aria-hidden.
 */
interface SkeletonGridProps {
  /** Quantidade de cards skeleton a exibir. Padrao: 4. */
  readonly count?: number;
}

export function SkeletonGrid({ count = 4 }: SkeletonGridProps): JSX.Element {
  return (
    <div className="kpi-grid" role="status" aria-label="Carregando indicadores" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
