const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export function formatBRL(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (cents ? brl2 : brl).format(n);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2026-08" → "ago/26" */
export function monthShort(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m) - 1;
  return `${MONTHS_SHORT[mi] ?? m}/${(y ?? '').slice(2)}`;
}

/** "2026-08" → "agosto de 2026" */
export function monthLong(ym: string): string {
  const [y, m] = ym.split('-');
  const mi = Number(m) - 1;
  return `${MONTHS_LONG[mi] ?? m} de ${y}`;
}
