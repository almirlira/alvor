import { useState } from 'react';
import { formatBRL, formatPct } from '../lib/format';

export type SemaforoLevel = 'verde' | 'amarelo' | 'vermelho';

export interface SemaforoEvidence {
  readonly label: string;
  readonly value: number;
  readonly unit: 'BRL' | '%' | 'pp' | 'meses';
  readonly refId: string;
  readonly period?: string;
}

export interface SemaforoCardData {
  readonly id: string;
  readonly level: SemaforoLevel;
  readonly priority: number;
  readonly title: string;
  readonly problem: string;
  readonly evidence: readonly SemaforoEvidence[];
  readonly who: 'voce' | 'contador' | 'gerente do banco' | 'contador ou consultor tributario';
  readonly actions: readonly string[];
  readonly impact: { readonly label: string; readonly value: number; readonly refId: string } | null;
  readonly validationRequest: string | null;
  readonly norma: { readonly citada: string; readonly vigencia: string; readonly fonte_url?: string } | null;
  readonly confidence: 'alta' | 'media' | 'baixa';
  readonly triggeredRule: string | null;
  readonly month: string;
}

export const LEVEL_LABEL: Readonly<Record<SemaforoLevel, string>> = {
  verde: 'VERDE · VOCE RESOLVE',
  amarelo: 'AMARELO · VALIDAR',
  vermelho: 'VERMELHO · PARECER',
};

export const LEVEL_MEANING: Readonly<Record<SemaforoLevel, string>> = {
  verde: 'O dono executa sozinho — renegociar fornecedor, cortar assinatura, ajustar preco.',
  amarelo: 'Exige validacao do contador ou do gerente do banco antes de agir.',
  vermelho: 'Nunca sai daqui sem parecer profissional — regime, reclassificacao, retroativo.',
};

const WHO_LABEL: Readonly<Record<SemaforoCardData['who'], string>> = {
  voce: 'voce resolve',
  contador: 'contador',
  'gerente do banco': 'gerente do banco',
  'contador ou consultor tributario': 'contador / tributarista',
};

function fmtEvidence(e: SemaforoEvidence): string {
  if (e.unit === '%') return formatPct(e.value, 2);
  if (e.unit === 'pp') return `${e.value.toLocaleString('pt-BR')} pp`;
  if (e.unit === 'meses') return String(e.value);
  return formatBRL(e.value, true);
}

export function LiquidBadge({ level }: { readonly level: SemaforoLevel }): JSX.Element {
  return (
    <div className="liquid-badge-container" aria-label={LEVEL_MEANING[level]}>
      <span className="liquid-badge-text">{LEVEL_LABEL[level]}</span>
      <div className={`liquid-shader-line shader-${level}`} aria-hidden="true" />
    </div>
  );
}

interface Props {
  readonly card: SemaforoCardData;
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  /** Modo compacto (hero do painel): sem corpo, clique navega. */
  readonly compact?: boolean;
  readonly onOpen?: () => void;
}

export function SemaforoCard({ card, expanded = false, onToggle, compact = false, onOpen }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const impact = card.impact;

  const copy = async (): Promise<void> => {
    if (card.validationRequest === null) return;
    try {
      await navigator.clipboard.writeText(card.validationRequest);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard bloqueado — o texto continua visivel para copiar a mao
    }
  };

  const head = (
    <div className="sem-card-head">
      <LiquidBadge level={card.level} />
      <div>
        <div className="sem-card-title">{card.title}</div>
        <div className="sem-card-problem">{card.problem}</div>
      </div>
      <div className="sem-card-right">
        {impact !== null ? (
          <div className="sem-impact"><small>{impact.label}</small>{formatBRL(impact.value)}</div>
        ) : (
          <div className="sem-impact"><small>valor em jogo</small>—</div>
        )}
        <span className="sem-who">{WHO_LABEL[card.who]}</span>
      </div>
    </div>
  );

  if (compact) {
    return (
      <button type="button" className={`sem-card sem-card-${card.level}`} onClick={onOpen} aria-label={`Abrir: ${card.title}`}>
        {head}
      </button>
    );
  }

  return (
    <div className={`sem-card sem-card-${card.level}`} role="button" tabIndex={0} aria-expanded={expanded} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); } }}>
      {head}
      {expanded && (
        <div className="sem-card-body" onClick={(e) => e.stopPropagation()}>
          <div className="sem-block">
            <h4>De onde saiu (trilha)</h4>
            <ul className="sem-evidence">
              {card.evidence.map((e) => (
                <li key={e.refId}><span>{e.label}</span><b title={`ref: ${e.refId}`}>{fmtEvidence(e)}</b></li>
              ))}
            </ul>
            {card.triggeredRule !== null && <p style={{ fontSize: 12.5, opacity: .8, marginTop: 8 }}>Regra que disparou: <code>{card.triggeredRule}</code></p>}
          </div>
          <div className="sem-block">
            <h4>{card.who === 'voce' ? 'O que fazer' : 'O que fazer (e o que nao fazer sozinho)'}</h4>
            <ul>{card.actions.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
          {card.validationRequest !== null && (
            <div className="sem-block" style={{ gridColumn: '1 / -1' }}>
              <h4>Pedido de validacao pronto para enviar ao {WHO_LABEL[card.who]}</h4>
              <div className="sem-request">{card.validationRequest}</div>
              <div className="sem-request-actions">
                <button type="button" className="pill-btn pill-dark" onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar pedido'}</button>
              </div>
            </div>
          )}
          {card.norma !== null && (
            <div className="sem-block" style={{ gridColumn: '1 / -1' }}>
              <h4>Base da sugestao (os 4 campos obrigatorios)</h4>
              <dl className="sem-norma">
                <dt>Norma citada</dt><dd>{card.norma.citada}{card.norma.fonte_url !== undefined && <> · <a href={card.norma.fonte_url} target="_blank" rel="noreferrer">fonte oficial</a></>}</dd>
                <dt>Vigencia</dt><dd>{card.norma.vigencia}</dd>
                <dt>Confianca</dt><dd>{card.confidence}</dd>
                <dt>Semaforo</dt><dd>{LEVEL_LABEL[card.level]}</dd>
              </dl>
            </div>
          )}
          {card.norma === null && (
            <div className="sem-block">
              <h4>Confianca</h4>
              <p style={{ margin: 0, fontSize: 14 }}>{card.confidence} — hipotese fundamentada nos numeros acima, nao parecer.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
