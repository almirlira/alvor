/**
 * ChatBubble.tsx — Componente de mensagem fiel ao prototipo chat.html (F3).
 *
 * ISOLAMENTO CRITICO:
 * - Este arquivo nao importa nem altera ChatMessage.tsx (componente F2 compartilhado).
 * - CSS exclusivo via screen-chat.css (prefixo .cbubble-).
 * - Reutiliza tipos e logica de ChatMessage.tsx sem re-exportar nada de la.
 * - Toda logica de grounding/fontes/fallback/retry preservada do ChatMessage.tsx.
 *
 * Referencia: docs/execucao-projetos/_local/design/prototipo/chat.html
 */

import { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import {
  type ChatMessageData,
  type ChatSource,
  type FallbackReason,
  type MdBlock,
  annotateRefs,
  filterCitedSources,
  parseMdBlocks,
  parseInlineBold,
  stripKbRefs,
} from './ChatMessage';

// ---------------------------------------------------------------------------
// SVG inline do simbolo CROSS (cata-vento) — viewBox 0 0 1080 1080
// Identico ao prototipo chat.html. aria-hidden por padrao (decorativo).
// ---------------------------------------------------------------------------
function CrossSymbol({ size = 20 }: { readonly size?: number }): JSX.Element {
  // Simbolo ALVOR (design system) — substitui o cata-vento do CROSS.
  return (
    <svg viewBox="0 0 316 226" xmlns="http://www.w3.org/2000/svg" width={size} height={Math.round(size * 0.72)} aria-hidden="true">
      <path d="M187.422 112.463L282.399 47.835L315.737 96.8271L213.72 166.245H102.017L0 96.8271L33.3369 47.835L128.163 112.359V0H187.422V112.463Z" fill="#FF5500" />
      <rect y="166.245" width="315.585" height="59.2592" fill="#FF5500" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Avatar — CROSS (logo SVG) ou usuario (icone person)
// ---------------------------------------------------------------------------
interface BubbleAvatarProps {
  readonly isUser: boolean;
}

function BubbleAvatar({ isUser }: BubbleAvatarProps): JSX.Element {
  if (isUser) {
    return (
      <div
        className="cbubble-avatar cbubble-avatar-user"
        aria-hidden="true"
        title={t('chat.senderYou')}
      >
        <span className="material-symbols-rounded">person</span>
      </div>
    );
  }
  return (
    <div className="cbubble-avatar" aria-hidden="true">
      <CrossSymbol size={20} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceTooltip — tooltip CSS puro, sem biblioteca (preservado do ChatMessage)
// ---------------------------------------------------------------------------
interface SourceTooltipProps {
  readonly source: ChatSource;
}

function SourceTooltip({ source }: SourceTooltipProps): JSX.Element {
  return (
    <span className="chat-source-tooltip" role="tooltip">
      <span className="chat-source-tooltip-label">{source.label}</span>
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
// CitedNumber — numero com affordancia de sublinhado + tooltip (preservado)
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
// Token — tipos locais para o array retornado por annotateRefs()
// (espelha os tipos de ChatMessage.tsx sem re-exportar)
// ---------------------------------------------------------------------------
type TextToken = { type: 'text'; content: string };
type RefAnchorToken = { type: 'ref'; refId: string; precedes: string };
type Token = TextToken | RefAnchorToken;

// ---------------------------------------------------------------------------
// InlineRenderer — renderiza uma linha de texto com suporte a negrito e refs.
// Combina parseInlineBold (para **x**) com annotateRefs (para [ref:ID]).
// ---------------------------------------------------------------------------

interface InlineRendererProps {
  readonly text: string;
  readonly sources: readonly ChatSource[];
  readonly activeRef: string | null;
  readonly onActivate: (refId: string) => void;
  readonly onDeactivate: () => void;
  readonly messageId: string;
  readonly lineKey: string;
}

function InlineRenderer({
  text,
  sources,
  activeRef,
  onActivate,
  onDeactivate,
  messageId,
  lineKey,
}: InlineRendererProps): JSX.Element {
  // Aplica annotateRefs primeiro para capturar [ref:ID] e associar ao numero
  const tokens = annotateRefs(text) as Token[];

  // Renderiza tokens: cada token de texto passa por parseInlineBold para negrito
  return (
    <>
      {tokens.map((token, idx) => {
        const key = `${lineKey}-${idx}`;
        if (token.type === 'text') {
          const boldParts = parseInlineBold(token.content);
          if (boldParts.length === 1 && boldParts[0] !== undefined && !boldParts[0][0]) {
            // Texto plano sem negrito — retorna diretamente
            return <span key={key}>{boldParts[0][1]}</span>;
          }
          return (
            <span key={key}>
              {boldParts.map(([isBold, part], bi) =>
                isBold ? <strong key={bi}>{part}</strong> : <span key={bi}>{part}</span>,
              )}
            </span>
          );
        }
        // RefAnchorToken
        const source = sources.find((s) => s.id === token.refId);
        const tooltipId = `tooltip-${messageId}-${token.refId}`;
        if (token.precedes.length === 0) return null;
        return (
          <CitedNumber
            key={key}
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
// MdContentRenderer — renderiza os blocos de markdown estruturados.
// Entrada: blocos parsados por parseMdBlocks().
// Zero dangerouslySetInnerHTML — todo conteudo e tratado como texto.
// ---------------------------------------------------------------------------

interface MdContentRendererProps {
  readonly blocks: readonly MdBlock[];
  readonly sources: readonly ChatSource[];
  readonly activeRef: string | null;
  readonly onActivate: (refId: string) => void;
  readonly onDeactivate: () => void;
  readonly messageId: string;
}

function MdContentRenderer({
  blocks,
  sources,
  activeRef,
  onActivate,
  onDeactivate,
  messageId,
}: MdContentRendererProps): JSX.Element {
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.type === 'divider') {
          return <hr key={bi} className="cbubble-divider" aria-hidden="true" />;
        }

        if (block.type === 'list') {
          return (
            <ul key={bi} className="cbubble-list">
              {block.items.map((item, ii) => (
                <li key={ii}>
                  <InlineRenderer
                    text={item}
                    sources={sources}
                    activeRef={activeRef}
                    onActivate={onActivate}
                    onDeactivate={onDeactivate}
                    messageId={messageId}
                    lineKey={`b${bi}-i${ii}`}
                  />
                </li>
              ))}
            </ul>
          );
        }

        // paragraph
        return (
          <p key={bi} className="cbubble-text">
            {block.lines.map((line, li) => (
              <span key={li} className="cbubble-line">
                <InlineRenderer
                  text={line}
                  sources={sources}
                  activeRef={activeRef}
                  onActivate={onActivate}
                  onDeactivate={onDeactivate}
                  messageId={messageId}
                  lineKey={`b${bi}-l${li}`}
                />
                {li < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// SourcesFooter — painel de fontes citadas (preservado do ChatMessage)
// Max 3 chips visiveis; botao expandir para ver todos.
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
    <footer className="cbubble-sources-footer">
      <span className="cbubble-sources-label">{t('chat.sourcesLabel')}</span>
      <ul className="chip-list">
        {visible.map((source) => {
          const isActive = source.id === activeRef;
          return (
            <li key={source.id}>
              <button
                type="button"
                className={`source-chip source-chip-cited${isActive ? ' active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onChipClick(source)}
              >
                <span>
                  {source.label.length > 28 ? `${source.label.slice(0, 27)}…` : source.label}
                </span>
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
// FallbackBubble — chips de acao contextuais por tipo de fallback
// Fiel ao prototipo (msg-fallback-chips + msg-fallback-chip).
// ---------------------------------------------------------------------------
interface FallbackBubbleProps {
  readonly fallbackReason: FallbackReason | undefined;
  readonly onConnectSources: () => void;
  readonly onSuggestion: (text: string) => void;
}

function FallbackBubble({
  fallbackReason,
  onConnectSources,
  onSuggestion,
}: FallbackBubbleProps): JSX.Element {
  if (fallbackReason === 'out_of_scope') {
    return (
      <>
        <p className="cbubble-text">{t('chat.fallback.out_of_scope.title')}</p>
        <p className="cbubble-note">{t('chat.fallback.out_of_scope.body')}</p>
        <div className="cbubble-fallback-chips">
          <button
            type="button"
            className="cbubble-fallback-chip"
            onClick={() => onSuggestion(t('chat.fallback.ambiguous.suggestionSales'))}
          >
            <span className="material-symbols-rounded">trending_up</span>
            {t('chat.fallback.ambiguous.suggestionSales')}
          </button>
          <button
            type="button"
            className="cbubble-fallback-chip"
            onClick={() => onSuggestion(t('chat.fallback.ambiguous.suggestionAds'))}
          >
            <span className="material-symbols-rounded">ads_click</span>
            {t('chat.fallback.ambiguous.suggestionAds')}
          </button>
        </div>
      </>
    );
  }

  if (fallbackReason === 'ambiguous') {
    return (
      <>
        <p className="cbubble-text">{t('chat.fallback.ambiguous.title')}</p>
        <div className="cbubble-fallback-chips">
          <button
            type="button"
            className="cbubble-fallback-chip"
            onClick={() => onSuggestion(t('chat.fallback.ambiguous.suggestionSales'))}
          >
            <span className="material-symbols-rounded">storefront</span>
            {t('chat.fallback.ambiguous.suggestionSales')}
          </button>
          <button
            type="button"
            className="cbubble-fallback-chip"
            onClick={() => onSuggestion(t('chat.fallback.ambiguous.suggestionInstagram'))}
          >
            <span className="material-symbols-rounded">visibility</span>
            {t('chat.fallback.ambiguous.suggestionInstagram')}
          </button>
          <button
            type="button"
            className="cbubble-fallback-chip"
            onClick={() => onSuggestion(t('chat.fallback.ambiguous.suggestionAds'))}
          >
            <span className="material-symbols-rounded">ads_click</span>
            {t('chat.fallback.ambiguous.suggestionAds')}
          </button>
        </div>
      </>
    );
  }

  // no_data (padrao)
  return (
    <>
      <p className="cbubble-text">{t('chat.fallback.no_data.title')}</p>
      <p className="cbubble-note">{t('chat.fallback.no_data.body')}</p>
      <div className="cbubble-fallback-chips">
        <button type="button" className="cbubble-fallback-chip" onClick={onConnectSources}>
          <span className="material-symbols-rounded">electrical_services</span>
          {t('chat.fallback.connectSources')}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatBubble — componente principal (F3, fiel ao prototipo)
// Interface identica ao ChatMessage para substituicao direta no ChatIaPage.
// ---------------------------------------------------------------------------
export interface ChatBubbleProps {
  readonly message: ChatMessageData;
  readonly activeRef?: string | null;
  readonly onSourceClick?: (source: ChatSource) => void;
  readonly onRetry?: () => void;
  readonly onConnectSources?: () => void;
  /** Permite que chips de fallback preencham o input e disparem envio */
  readonly onSuggestion?: (text: string) => void;
  /** Indice de animacao — controla animation-delay para stagger de entrada */
  readonly animIndex?: number;
}

export function ChatBubble({
  message,
  activeRef = null,
  onSourceClick,
  onRetry,
  onConnectSources,
  onSuggestion,
  animIndex = 0,
}: ChatBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const [localActiveRef, setLocalActiveRef] = useState<string | null>(null);
  const activatedFromChip = useRef(false);

  // Ref externo (chip clicado) tem precedencia sobre hover local
  const resolvedActive = activeRef ?? localActiveRef;

  const handleActivate = (refId: string): void => {
    if (!activatedFromChip.current) setLocalActiveRef(refId);
    const source = message.sources?.find((s) => s.id === refId);
    if (source !== undefined) onSourceClick?.(source);
  };

  const handleDeactivate = (): void => {
    if (!activatedFromChip.current) setLocalActiveRef(null);
  };

  const handleChipClick = (source: ChatSource): void => {
    activatedFromChip.current = true;
    onSourceClick?.(source);
    setTimeout(() => {
      activatedFromChip.current = false;
    }, 0);
  };

  const handleFallbackSuggestion = (text: string): void => {
    onSuggestion?.(text);
  };

  // Delay escalonado para stagger de entrada (max 800ms)
  const delay = Math.min(animIndex * 80, 800);

  // --- Estado D: Erro de rede ---
  if (message.isError === true) {
    return (
      <div
        className="cbubble-msg"
        style={{ animationDelay: `${delay}ms` }}
        role="alert"
        aria-live="assertive"
      >
        <BubbleAvatar isUser={false} />
        <div className="cbubble-bubble cbubble-bubble-error">
          <div className="cbubble-error-header" aria-hidden="true">
            <span className="material-symbols-rounded">error_outline</span>
            {t('chat.errorHeader')}
          </div>
          <p className="cbubble-error-sub">{t('chat.errorBody')}</p>
          {onRetry !== undefined ? (
            <button
              type="button"
              className="cbubble-retry-btn"
              aria-label={t('chat.retryAriaLabel')}
              onClick={onRetry}
            >
              <span className="material-symbols-rounded">refresh</span>
              {t('chat.errorRetry')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // --- Mensagem do usuario ---
  if (isUser) {
    return (
      <div
        className="cbubble-msg"
        style={{ animationDelay: `${delay}ms` }}
        aria-label={t('chat.userLabel')}
      >
        <BubbleAvatar isUser={true} />
        <div className="cbubble-bubble cbubble-bubble-user">
          <div className="cbubble-sender-user" aria-hidden="true">
            {t('chat.senderYou')}
          </div>
          <p className="cbubble-text">{message.content}</p>
        </div>
      </div>
    );
  }

  // --- Estado C: Fallback honesto ---
  const isFallback =
    message.fallbackReason !== undefined ||
    message.content
      .toLowerCase()
      .startsWith('nao tenho dados suficientes para responder essa pergunta');

  if (isFallback) {
    return (
      <div
        className="cbubble-msg"
        style={{ animationDelay: `${delay}ms` }}
        aria-label={t('chat.assistantLabel')}
      >
        <BubbleAvatar isUser={false} />
        <div className="cbubble-bubble cbubble-bubble-cross">
          <div className="cbubble-sender" aria-hidden="true">
            {t('chat.senderCross')}
          </div>
          <FallbackBubble
            fallbackReason={message.fallbackReason}
            onConnectSources={onConnectSources ?? (() => undefined)}
            onSuggestion={handleFallbackSuggestion}
          />
        </div>
      </div>
    );
  }

  // --- Estado A/B: Resposta normal (com ou sem fontes) ---
  // 1. Remove [kb:ID] antes de qualquer processamento.
  //    [ref:ID] NAO e removido aqui — o InlineRenderer (via annotateRefs) consome
  //    cada marcador linha a linha, nunca exibindo o texto cru.
  const cleanedContent = stripKbRefs(message.content);
  const citedSources = filterCitedSources(cleanedContent, message.sources ?? []);
  const hasSources = citedSources.length > 0;

  // 2. Parseia markdown em blocos estruturados preservando newlines.
  //    stripRefs() NAO e chamado aqui — ele colapsa whitespace e quebraria listas.
  const mdBlocks = parseMdBlocks(cleanedContent);

  return (
    <div
      className="cbubble-msg"
      style={{ animationDelay: `${delay}ms` }}
      aria-label={t('chat.assistantLabel')}
    >
      <BubbleAvatar isUser={false} />
      <div className="cbubble-bubble cbubble-bubble-cross">
        <div className="cbubble-sender" aria-hidden="true">
          {t('chat.senderCross')}
        </div>
        <MdContentRenderer
          blocks={mdBlocks}
          sources={hasSources ? citedSources : []}
          activeRef={resolvedActive}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
          messageId={message.id}
        />
        {hasSources ? (
          <SourcesFooter
            sources={citedSources}
            activeRef={resolvedActive}
            onChipClick={handleChipClick}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TypingBubble — estado "CROSS esta pensando" (fiel ao prototipo)
// ---------------------------------------------------------------------------
export function TypingBubble(): JSX.Element {
  return (
    <div className="cbubble-msg" aria-busy="true" aria-label={t('chat.sending')}>
      <div className="cbubble-avatar" aria-hidden="true">
        <CrossSymbol size={20} />
      </div>
      <div className="cbubble-bubble cbubble-bubble-cross">
        <div className="cbubble-sender" aria-hidden="true">
          {t('chat.senderCross')}
        </div>
        <div className="cs-typing" role="status" aria-live="polite" aria-label={t('chat.sending')}>
          <span className="cs-typing-dot" aria-hidden="true" />
          <span className="cs-typing-dot" aria-hidden="true" />
          <span className="cs-typing-dot" aria-hidden="true" />
          <span className="cs-typing-status">{t('chat.typingStatus')}</span>
        </div>
      </div>
    </div>
  );
}
