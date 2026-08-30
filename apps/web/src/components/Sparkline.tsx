interface SparklineProps {
  readonly points: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly ariaLabel: string;
}

/**
 * Sparkline SVG puro. Zero dependencia externa (regra bundle size).
 * Renderiza polyline normalizada entre min e max. Acessivel via aria-label.
 */
export function Sparkline({
  points,
  width = 120,
  height = 32,
  ariaLabel,
}: SparklineProps): JSX.Element | null {
  if (points.length < 2) {
    return null;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const last = points[points.length - 1] ?? 0;
  const first = points[0] ?? 0;
  const trendClass =
    last > first ? 'sparkline-up' : last < first ? 'sparkline-down' : 'sparkline-flat';

  return (
    <svg
      className={`sparkline ${trendClass}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      focusable="false"
    >
      <polyline fill="none" strokeWidth="2" points={path} />
    </svg>
  );
}
