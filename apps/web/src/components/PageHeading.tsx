import type { ReactNode } from 'react';

/**
 * PageHeading — H1 padrao das telas ALVOR.
 *
 * Garante hierarquia consistente com os prototipos:
 *   - fonte display (Space Grotesk) peso 700
 *   - tamanho --mkv-text-xl (24px)
 *   - cor --md-on-surface
 *   - subtitulo opcional em --md-on-surface-variant (Roboto Flex 15px)
 *
 * Anti-overengineering: abstrai apenas o que varia entre telas (id, titulo, subtitulo).
 * Comportamento e estrutura HTML sao identicos em todas as telas, justificando a extracao.
 */

interface PageHeadingProps {
  /** id do h1 — obrigatorio para aria-labelledby na section pai. */
  readonly id: string;
  /** Texto principal do titulo. */
  readonly title: string;
  /** Subtitulo opcional, exibido em muted abaixo do titulo. */
  readonly subtitle?: string;
  /** Filhos adicionais (ex: hero-message, filtros) abaixo do subtitulo. */
  readonly children?: ReactNode;
}

export function PageHeading({ id, title, subtitle, children }: PageHeadingProps): JSX.Element {
  return (
    <header className="page-heading dashboard-hero">
      <h1 id={id} className="page-heading-title">
        {title}
      </h1>
      {subtitle !== undefined && subtitle.length > 0 ? (
        <p className="page-heading-subtitle muted">{subtitle}</p>
      ) : null}
      {children}
    </header>
  );
}
