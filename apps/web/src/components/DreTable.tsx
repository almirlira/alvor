import type { DreStatement } from '../../../../packages/ingest/src/dre-profile';
import { ACCOUNTS } from '../../../../packages/ingest/src/dre-model';
import { formatBRL, monthShort } from '../lib/format';

export function DreTable({ statement, selected }: { readonly statement: DreStatement; readonly selected: string }): JSX.Element {
  const { months, canonical } = statement;
  return (
    <div className="dre-table-wrap">
      <table className="dre-table">
        <thead>
          <tr>
            <th>Conta</th>
            {months.map((m) => <th key={m} className={m === selected ? 'sel' : ''}>{monthShort(m)}</th>)}
          </tr>
        </thead>
        <tbody>
          {ACCOUNTS.map((a) => {
            const isSub = a.kind === 'subtotal';
            const allZero = months.every((m) => (canonical[m]?.[a.key] ?? 0) === 0);
            if (allZero && !isSub) return null;
            return (
              <tr key={a.key} className={isSub ? 'sub' : ''}>
                <td>{a.label}</td>
                {months.map((m) => {
                  const v = canonical[m]?.[a.key] ?? 0;
                  const shown = a.kind === 'revenue' || a.kind === 'financial_income' || isSub ? v : -v;
                  return (
                    <td key={m} className={`${shown < 0 ? 'neg' : ''} ${m === selected ? 'sel' : ''}`}>
                      {formatBRL(shown)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
