import { useNavigate } from 'react-router-dom';
import { dataPorExtenso, fraseDoDia, saudacao } from '../lib/owner';
import { monthLong } from '../lib/format';
import type { SemaforoLevel } from './SemaforoCard';

interface Props {
  readonly month: string;
  readonly months: readonly string[];
  readonly onMonthChange: (m: string) => void;
  readonly fileName: string;
  readonly resultadoLiquido: number;
  readonly counts: Readonly<Record<SemaforoLevel, number>> | null;
  readonly monthShortFn: (ym: string) => string;
  readonly displayName: string;
}

/**
 * Faixa de boas-vindas do painel: saudacao pelo horario, data por extenso,
 * uma linha honesta sobre o que espera o dono hoje e a frase do dia.
 */
export function WelcomeBand({ month, months, onMonthChange, fileName, resultadoLiquido, counts, monthShortFn, displayName }: Props): JSX.Element {
  const navigate = useNavigate();
  const vermelho = resultadoLiquido < 0;
  const pendentes = counts === null ? 0 : counts.vermelho + counts.amarelo;
  const sozinho = counts?.verde ?? 0;

  const resumo = (): JSX.Element => {
    if (counts === null) return <>Sua DRE de {monthLong(month)} está carregada e pronta para leitura.</>;
    if (pendentes === 0 && sozinho === 0) return <>Nenhum alerta em {monthLong(month)} — os indicadores acompanhados estão dentro do esperado.</>;
    return (
      <>
        {vermelho ? `${monthLong(month)} fechou no vermelho` : `${monthLong(month)} fechou no azul`}
        {sozinho > 0 && <>, e há <b>{sozinho}</b> {sozinho === 1 ? 'ponto que você resolve sozinho' : 'pontos que você resolve sozinho'}</>}
        {pendentes > 0 && <> — {sozinho > 0 ? 'mais ' : 'há '}<b>{pendentes}</b> {pendentes === 1 ? 'que pede validação profissional' : 'que pedem validação profissional'}</>}.
      </>
    );
  };

  return (
    <section className="wb" aria-label="Boas-vindas">
      <div className="wb-main">
        <div className="wb-date">{dataPorExtenso()}</div>
        <h1 className="wb-greet">{saudacao()}, {displayName}.</h1>
        <p className="wb-resumo">{resumo()}</p>
        <p className="wb-frase">“{fraseDoDia(vermelho)}”</p>
      </div>
      <div className="wb-side">
        <label className="wb-month">
          <span className="dre-eyebrow">Mês em análise</span>
          <select className="dre-month-select" value={month} onChange={(e) => onMonthChange(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthShortFn(m)}</option>)}
          </select>
        </label>
        <div className="wb-file" title={fileName}>{fileName}</div>
        {pendentes > 0 && (
          <button type="button" className="pill-btn pill-light" onClick={() => navigate('/semaforo')}>
            Ver o que precisa de atenção
          </button>
        )}
      </div>
    </section>
  );
}
