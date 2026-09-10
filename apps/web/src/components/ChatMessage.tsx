import { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { AppIcon, type AppIconName } from './AppIcon';

export type FallbackReason = 'no_data' | 'out_of_scope' | 'ambiguous';

/** Shape de fonte citada — campos opcionais degradam graciosamente. */
export interface ChatSource {
  readonly id: string;
  readonly label: string;
  readonly sourceType?: string;
  readonly account?: string;
  readonly period?: string;
  readonly href?: string;
}

export interface ChatMessageData {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly sources?: readonly ChatSource[];
  /** Flag de fallback — propaga do backend quando validationPassed === false. */
  readonly fallbackReason?: FallbackReason;
  /** Flag de erro de rede/timeout — mensagem local inserida pelo ChatIaPage. */
  readonly isError?: boolean;
}

// ---------------------------------------------------------------------------
// filterCitedSources — interseccao entre sources recebidas e refs [ref:ID]
// efetivamente citados no conteudo da mensagem (product-spec §4.1.4, 2026-06-03).
//
// Motivo: o backend pode enviar todas as fontes do contexto; so mostramos
// as que o LLM realmente citou. Isso elimina o "+24 mais" de fontes nao-usadas.
// ---------------------------------------------------------------------------

/** Regex que captura todos os IDs citados como [ref:ID] no texto. */
const CITED_REF_RE = /\[ref:([^\]]+)\]/g;

/**
 * Retorna apenas as sources cujo id aparece como [ref:id] no conteudo.
 * Se nenhum [ref:] existe no texto, retorna array vazio (resposta qualitativa).
 */
export function filterCitedSources(
  content: string,
  sources: readonly ChatSource[],
): readonly ChatSource[] {
  const cited = new Set<string>();
  for (const m of content.matchAll(CITED_REF_RE)) {
    const id = m[1];
    if (id !== undefined) cited.add(id);
  }
  if (cited.size === 0) return [];
  return sources.filter((s) => cited.has(s.id));
}

// ---------------------------------------------------------------------------
// stripKbRefs — remove marcadores [kb:ID] do texto antes de qualquer
// processamento. Esses marcadores sao anotacoes internas do LLM sobre
// conceitos citados — nao devem aparecer visivelmente para o usuario.
// ---------------------------------------------------------------------------

/** Regex que captura [kb:ID] (conceitos do knowledge base) */
const KB_REF_RE = /\s*\[kb:[^\]]+\]/g;

/**
 * Remove todos os marcadores [kb:ID] do texto.
 * Chamado antes de qualquer outro processamento de texto do LLM.
 */
export function stripKbRefs(text: string): string {
  return text.replace(KB_REF_RE, '');
}

// ---------------------------------------------------------------------------
// parseMdBlocks — parser minimo de markdown seguro para o chat do ALVOR.
//
// Suporte intencional e limitado ao subset que o LLM ALVOR produz:
//   - Paragrafos (blocos separados por linha em branco)
//   - Listas (linhas consecutivas iniciadas por "- ")
//   - Divisorias ("---" numa linha propria → <hr>)
//   - Negrito (**texto**) — processado em nível de inline
//   - Quebras de linha simples dentro de paragrafos (preservadas)
//
// NAO suporta: headings (#), links ([text](url)), imagens, tabelas,
// code blocks, HTML bruto. Qualquer markup nao reconhecido e tratado
// como texto literal — sem risco de XSS (zero dangerouslySetInnerHTML).
// ---------------------------------------------------------------------------

export type MdBlock =
  | { readonly type: 'paragraph'; readonly lines: readonly string[] }
  | { readonly type: 'list'; readonly items: readonly string[] }
  | { readonly type: 'divider' };

/**
 * Divide o texto do LLM em blocos de markdown estruturados.
 * Retorna um array de MdBlock a ser renderizado pelo componente.
 *
 * Entrada: texto raw do LLM (apos stripKbRefs).
 * Saida: blocos tipados, prontos para renderizacao sem dangerouslySetInnerHTML.
 */
export function parseMdBlocks(raw: string): readonly MdBlock[] {
  // Normaliza line endings
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Divide em linhas para processamento linha a linha
  const rawLines = text.split('\n');

  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i] ?? '';

    // Linha em branco — avanca sem criar bloco
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Divisoria: linha que e exatamente "---" (ou "***" ou "___")
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Lista: sequencia de linhas comecando com "- " ou "* "
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const l = rawLines[i] ?? '';
        if (/^[-*]\s/.test(l)) {
          // Remove o marcador de lista (- ou *) e captura o conteudo
          items.push(l.replace(/^[-*]\s+/, '').trim());
          i++;
        } else if (l.trim() === '') {
          // Linha em branco termina o bloco de lista
          break;
        } else {
          // Linha sem marcador — termina a lista (ex.: paragrafo seguinte)
          break;
        }
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', items });
      }
      continue;
    }

    // Paragrafo: coleta linhas ate encontrar linha em branco, divisoria ou lista
    const lines: string[] = [];
    while (i < rawLines.length) {
      const l = rawLines[i] ?? '';
      if (l.trim() === '') break;
      if (/^[-*_]{3,}\s*$/.test(l.trim())) break;
      if (/^[-*]\s/.test(l)) break;
      lines.push(l);
      i++;
    }
    if (lines.length > 0) {
      blocks.push({ type: 'paragraph', lines });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// renderInlineMd — processa inline markdown dentro de uma linha de texto.
// Suporte: **negrito**. Zero dangerouslySetInnerHTML.
// Retorna array de ReactNode (texto plano ou <strong>).
// ---------------------------------------------------------------------------

/**
 * Divide uma string em segmentos de texto plano e segmentos em negrito (**x**).
 * Retorna pares [isBold, content] para renderizacao como JSX.
 */
export function parseInlineBold(text: string): readonly (readonly [boolean, string])[] {
  const BOLD_RE = /\*\*([^*]+)\*\*/g;
  const result: Array<readonly [boolean, string]> = [];
  let last = 0;
  for (const m of text.matchAll(BOLD_RE)) {
    if ((m.index ?? 0) > last) {
      result.push([false, text.slice(last, m.index)]);
    }
    result.push([true, m[1] ?? '']);
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) {
    result.push([false, text.slice(last)]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// annotateRefs — substitui stripRefs() para renderizacao com afordancias.
// stripRefs() continua disponivel para usos que nao precisam de renderizacao
// (ex.: derivar titulo de sessao a partir do conteudo).
// ---------------------------------------------------------------------------

type TextToken = { type: 'text'; content: string };
type RefAnchorToken = { type: 'ref'; refId: string; precedes: string };
type Token = TextToken | RefAnchorToken;

/** Regex que captura [ref:ID] com capture group no ID. */
const REF_RE = /\[ref:([^\]]+)\]/g;

/**
 * Remove marcadores [ref:ID] — usado em contextos que nao precisam de
 * renderizacao (ex.: titulo de sessao). NAO usar na bolha de chat.
 */
export function stripRefs(text: string): string {
  return text
    .replace(/\s*\[ref:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Produz um array de tokens a partir do texto do LLM.
 *
 * Para cada segmento de texto antes de um [ref:ID]:
 *   - Identifica o ultimo numero (grupo numerico + eventual unidade) como
 *     o "dono" da referencia.
 *   - Produz tokens: texto-antes-do-numero | RefAnchor | texto-apos-numero.
 *
 * O [ref:ID] cru NUNCA aparece no output. O numero que o precede ganha
 * `refId` para que o renderizador possa aplicar afordancia visual.
 */
export function annotateRefs(text: string): Token[] {
  const tokens: Token[] = [];
  // Numero: digitos com separadores opcionais + sufixo de unidade opcional
  // Captura: R$ 12.450, 8%, 340, etc.
  const NUMBER_TAIL_RE = /(?:R\$\s*)?[\d.,]+\s*(?:%|k|K|mil)?(?=\s*$)/;

  let lastIndex = 0;
  for (const match of text.matchAll(REF_RE)) {
    const refId = match[1] ?? '';
    const before = text.slice(lastIndex, match.index);
    lastIndex = (match.index ?? 0) + match[0].length;

    // Tenta encontrar o numero no final do segmento `before`
    const numMatch = NUMBER_TAIL_RE.exec(before);
    if (numMatch !== null) {
      const numStart = numMatch.index;
      // Texto antes do numero
      const preText = before.slice(0, numStart);
      if (preText.length > 0) tokens.push({ type: 'text', content: preText });
      // RefAnchor carrega o numero como `precedes`
      tokens.push({ type: 'ref', refId, precedes: numMatch[0] });
    } else {
      // Nao encontrou numero — joga o texto antes normalmente e cria anchor vazio
      if (before.length > 0) tokens.push({ type: 'text', content: before });
      tokens.push({ type: 'ref', refId, precedes: '' });
    }
  }

  // Restante do texto apos o ultimo ref
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Mapeamento sourceType → label legivel (product-spec §5.2, 2026-06-03)
// ---------------------------------------------------------------------------
function sourceTypeLabel(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'google_drive':
      return t('chat.sourceTypeLabel.google_drive');
    case 'instagram':
      return t('chat.sourceTypeLabel.instagram');
    case 'meta_ads':
      return t('chat.sourceTypeLabel.meta_ads');
    case 'google_analytics':
      return t('chat.sourceTypeLabel.google_analytics');
    case 'whatsapp':
      return t('chat.sourceTypeLabel.whatsapp');
    case 'manual':
      return t('chat.sourceTypeLabel.manual');
    case 'pdv':
      return t('chat.sourceTypeLabel.pdv');
    case 'crm':
      return t('chat.sourceTypeLabel.crm');
    default:
      return t('chat.sourceTypeLabel.outro');
  }
}

/** Ícone local por tipo de fonte; não depende de fonte externa. */
function sourceTypeIcon(sourceType: string | undefined): AppIconName {
  switch (sourceType) {
    case 'google_drive':
      return 'upload';
    case 'instagram':
      return 'eye';
    case 'meta_ads':
      return 'target';
    case 'google_analytics':
      return 'chart';
    case 'whatsapp':
      return 'send';
    case 'manual':
      return 'help';
    case 'pdv':
      return 'store';
    case 'crm':
      return 'person';
    default:
      return 'chart';
  }
}

// ---------------------------------------------------------------------------
// SourceTooltip — tooltip CSS puro, sem biblioteca externa (product-spec §5.3)
// ---------------------------------------------------------------------------
interface SourceTooltipProps {
  readonly source: ChatSource;
}

function SourceTooltip({ source }: SourceTooltipProps): JSX.Element {
  return (
    <span className="chat-source-tooltip" role="tooltip">
      <span className="chat-source-tooltip-label">{source.label}</span>
      <span className="chat-source-tooltip-type">{sourceTypeLabel(source.sourceType)}</span>
      {source.period !== undefined && source.period.length > 0 ? (
        <span className="chat-source-tooltip-period">{source.period}</span>
      ) : null}
      {source.account !== undefined && source.account.length > 0 ? (
        <span className="chat-source-tooltip-account">{source.account}</span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CitedNumber — span com afordancia de sublinhado pontilhado + tooltip
// ---------------------------------------------------------------------------
interface CitedNumberProps {
  readonly text: string;
  readonly refId: string;
  readonly source: ChatSource | undefined;
  readonly isActive: boolean;
  readonly onActivate: (refId: string) => void;
  readonly onDeactivate: () => void;
  readonly tooltipId: string;
}

function CitedNumber({
  text,
  refId,
  source,
  isActive,
  onActivate,
  onDeactivate,
  tooltipId,
}: CitedNumberProps): JSX.Element {
  const ariaLabel =
    source !== undefined ? t('chat.viewSource', { label: source.label }) : `ref:${refId}`;

  return (
    <span className="chat-number-cited-wrapper">
      <span
        className={`chat-number-cited${isActive ? ' active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={source !== undefined ? tooltipId : undefined}
        onMouseEnter={() => onActivate(refId)}
        onMouseLeave={onDeactivate}
        onFocus={() => onActivate(refId)}
        onBlur={onDeactivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(refId);
          }
        }}
      >
        {text}
      </span>
      {source !== undefined && isActive ? <SourceTooltip source={source} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TokenRenderer — renderiza o array de tokens de annotateRefs()
// ---------------------------------------------------------------------------
interface TokenRendererProps {
  readonly tokens: Token[];
  readonly sources: readonly ChatSource[];
  readonly activeRef: string | null;
  readonly onActivate: (refId: string) => void;
  readonly onDeactivate: () => void;
  readonly messageId: string;
}

function TokenRenderer({
  tokens,
  sources,
  activeRef,
  onActivate,
  onDeactivate,
  messageId,
}: TokenRendererProps): JSX.Element {
  return (
    <>
      {tokens.map((token, idx) => {
        if (token.type === 'text') {
          return <span key={idx}>{token.content}</span>;
        }
        // RefAnchorToken: renderiza o numero com afordancia
        const source = sources.find((s) => s.id === token.refId);
        const tooltipId = `tooltip-${messageId}-${token.refId}`;
        if (token.precedes.length === 0) {
          // Ref sem numero associado: nao renderiza nada visivel
          return null;
        }
        return (
          <CitedNumber
            key={idx}
            text={token.precedes}
            refId={token.refId}
            source={source}
            isActive={activeRef === token.refId}
            onActivate={onActivate}
            onDeactivate={onDeactivate}
            tooltipId={tooltipId}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// FallbackContent — renderizacao por estado C (fallback honesto)
// ---------------------------------------------------------------------------
interface FallbackContentProps {
  readonly fallbackReason: FallbackReason | undefined;
  readonly onConnectSources: () => void;
}

function FallbackContent({ fallbackReason, onConnectSources }: FallbackContentProps): JSX.Element {
  if (fallbackReason === 'out_of_scope') {
    return (
      <div className="chat-fallback-content">
        <p className="chat-fallback-title">{t('chat.fallback.out_of_scope.title')}</p>
        <p className="chat-fallback-body">{t('chat.fallback.out_of_scope.body')}</p>
        <p className="chat-fallback-cta-text">{t('chat.fallback.out_of_scope.cta')}</p>
      </div>
    );
  }

  if (fallbackReason === 'ambiguous') {
    return (
      <div className="chat-fallback-content">
        <p className="chat-fallback-title">{t('chat.fallback.ambiguous.title')}</p>
        <ul className="chat-fallback-suggestions">
          <li>{t('chat.fallback.ambiguous.suggestionSales')}</li>
          <li>{t('chat.fallback.ambiguous.suggestionInstagram')}</li>
          <li>{t('chat.fallback.ambiguous.suggestionAds')}</li>
        </ul>
      </div>
    );
  }

  // no_data ou undefined (fallback generico)
  return (
    <div className="chat-fallback-content">
      <p className="chat-fallback-title">{t('chat.fallback.no_data.title')}</p>
      <p className="chat-fallback-body">{t('chat.fallback.no_data.body')}</p>
      <button type="button" className="chat-fallback-cta btn-secondary" onClick={onConnectSources}>
        {t('chat.fallback.connectSources')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourcesFooter — painel "Fontes citadas" (Estado A)
// Max 3 chips visiveis; botao expandir para ver todos (product-spec §4.1.3)
// ---------------------------------------------------------------------------

const MAX_CHIPS_VISIBLE = 3;

interface SourcesFooterProps {
  readonly sources: readonly ChatSource[];
  readonly activeRef: string | null;
  readonly onChipClick: (source: ChatSource) => void;
}

function SourcesFooter({ sources, activeRef, onChipClick }: SourcesFooterProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, MAX_CHIPS_VISIBLE);
  const hiddenCount = sources.length - MAX_CHIPS_VISIBLE;

  return (
    <footer className="chat-message-sources">
      <span className="chat-message-sources-label">{t('chat.sourcesLabel')}</span>
      <ul className="chip-list">
        {visible.map((source) => {
          const isActive = source.id === activeRef;
          const icon = sourceTypeIcon(source.sourceType);
          const truncLabel =
            source.label.length > 28 ? `${source.label.slice(0, 27)}…` : source.label;
          return (
            <li key={source.id}>
              <button
                type="button"
                className={`source-chip source-chip-cited${isActive ? ' active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onChipClick(source)}
              >
                <AppIcon name={icon} className="source-chip-icon" />
                <span>{truncLabel}</span>
              </button>
            </li>
          );
        })}
        {!expanded && hiddenCount > 0 ? (
          <li>
            <button
              type="button"
              className="source-chip source-chip-expand btn-secondary"
              onClick={() => setExpanded(true)}
            >
              {t('chat.sourceMore', { count: String(hiddenCount) })}
            </button>
          </li>
        ) : null}
      </ul>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// ChatMessage — componente principal (refatorado para)
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  readonly message: ChatMessageData;
  readonly activeRef?: string | null;
  readonly onSourceClick?: (source: ChatSource) => void;
  readonly onRetry?: () => void;
  readonly onConnectSources?: () => void;
}

export function ChatMessage({
  message,
  activeRef = null,
  onSourceClick,
  onRetry,
  onConnectSources,
}: ChatMessageProps): JSX.Element {
  const isUser = message.role === 'user';
  const label = isUser ? t('chat.userLabel') : t('chat.assistantLabel');
  // activeRef local — para hover sobre numero sem propagar para cima
  const [localActiveRef, setLocalActiveRef] = useState<string | null>(null);
  const activatedFromChip = useRef(false);

  // O activeRef externo (do chip clicado) tem precedencia sobre o hover local
  const resolvedActive = activeRef ?? localActiveRef;

  const handleActivate = (refId: string): void => {
    if (!activatedFromChip.current) setLocalActiveRef(refId);
    // Notifica o pai para destacar o chip correspondente
    const source = message.sources?.find((s) => s.id === refId);
    if (source !== undefined) onSourceClick?.(source);
  };

  const handleDeactivate = (): void => {
    if (!activatedFromChip.current) setLocalActiveRef(null);
  };

  const handleChipClick = (source: ChatSource): void => {
    activatedFromChip.current = true;
    onSourceClick?.(source);
    // reset flag no proximo tick para nao bloquear hover posterior
    setTimeout(() => {
      activatedFromChip.current = false;
    }, 0);
  };

  // --- Estado D: Erro de rede ---
  if (message.isError === true) {
    return (
      <article className="chat-message chat-message-error" aria-label={label}>
        <header className="chat-message-role">{label}</header>
        <p className="chat-message-content">{t('chat.error')}</p>
        {onRetry !== undefined ? (
          <div className="chat-message-actions">
            <button type="button" className="btn-secondary" onClick={onRetry}>
              {t('chat.errorRetry')}
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  // --- Mensagem do usuario ---
  if (isUser) {
    return (
      <article className="chat-message chat-message-user" aria-label={label}>
        <header className="chat-message-role">{label}</header>
        <p className="chat-message-content">{message.content}</p>
      </article>
    );
  }

  // --- Estado C: Fallback ---
  // Detecta via flag ou via texto exato do FALLBACK_INSUFFICIENT_DATA_MESSAGE
  const isFallback =
    message.fallbackReason !== undefined ||
    message.content
      .toLowerCase()
      .startsWith('nao tenho dados suficientes para responder essa pergunta');

  if (isFallback) {
    return (
      <article
        className="chat-message chat-message-assistant chat-message-fallback"
        aria-label={label}
      >
        <header className="chat-message-role">{label}</header>
        <FallbackContent
          fallbackReason={message.fallbackReason}
          onConnectSources={onConnectSources ?? (() => undefined)}
        />
      </article>
    );
  }

  // --- Estado A/B: Resposta normal (com ou sem fontes) ---
  // Filtrar apenas as fontes efetivamente citadas no texto ([ref:ID]).
  // O backend ja entrega so as citadas para novas mensagens; esse filtro
  // cobre mensagens de historico onde o campo sources pode ter mais items.
  const citedSources = filterCitedSources(message.content, message.sources ?? []);
  const hasSources = citedSources.length > 0;

  const tokens = annotateRefs(message.content);
  const sources = citedSources;

  return (
    <article className="chat-message chat-message-assistant" aria-label={label}>
      <header className="chat-message-role">{label}</header>
      <p className="chat-message-content">
        {hasSources ? (
          <TokenRenderer
            tokens={tokens}
            sources={sources}
            activeRef={resolvedActive}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
            messageId={message.id}
          />
        ) : (
          stripRefs(message.content)
        )}
      </p>
      {hasSources ? (
        <SourcesFooter sources={sources} activeRef={resolvedActive} onChipClick={handleChipClick} />
      ) : null}
    </article>
  );
}
