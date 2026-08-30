/**
 * ContextBuilder — Camada 1 do hardening.
 *
 * Dado `{tenantId, userId, activeRole, memberships}`, monta um
 * `SanitizedContext` contendo apenas os dados que esse usuario, com esse
 * papel ativo, nesse tenant, pode ler via endpoint direto.
 *
 * Regra dura:
 *   - ContextBuilder e a UNICA porta de entrada de dados para o prompt.
 *   - Prompt builders NUNCA acessam o banco diretamente.
 *   - Scope de papel e aplicado AQUI, nao dentro do prompt.
 *
 * entrega o esqueleto de interface + uma implementacao default que
 * delega para um `ContextRepository` injetado. A implementacao real que
 * consulta Postgres com `SET LOCAL app.current_tenant` vive em dentro
 * do backend (apps/api), conforme contrato definido aqui.
 *
 * ## Extensao (2026-06-03)
 *
 * `ScopedDataItem` ganha campo opcional `entity` (id + label de loja).
 * O ContextBuilder popula `entity` deserializando o campo `note` JSON
 * que o PgContextRepository injeta no formato `{ entityId, storeLabel }`.
 *
 * `SanitizedContext` ganha `intentScope` e `fallbackReason` propagados
 * do resultado do repositorio (via cast para `StoreContextResult`-like).
 * O caller (PromptAssembler / ChatService) usa esses campos para:
 *   - montar blocos DATA com dimensao de loja (intentScope)
 *   - distinguir no_data / out_of_scope / ambiguous no fallback (fallbackReason)
 */

import type { SourceRef } from './output-validator.js';

/** Papel ativo do usuario dentro do tenant atual. */
export type ActiveRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Membership {
  readonly tenantId: string;
  readonly role: ActiveRole;
  /** Nivel na hierarquia: org | franqueadora | franqueado | loja. */
  readonly level?: 'org' | 'franqueadora' | 'franqueado' | 'loja' | 'tenant';
}

/**
 * Hints conversacionais derivados do historico de turnos anteriores.
 *
 * Contrato de carry-over (design 2026-06-07):
 *   - Carrega APENAS labels de intent (periodo, nomes de produto, loja, escopo).
 *   - NUNCA carrega valores numericos — todo numero e re-buscado e re-ancorado
 *     com [ref:] no turno atual.
 *   - Efemero por request — nao persistido como estado novo.
 *   - Derivado pelo ChatService a partir do historico da sessao corrente (tenant-safe).
 *
 * addendum (2026-06-07): suporta carry-over de periodo e lista de
 * produtos para habilitar follow-ups de comparacao multi-produto e heranca
 * de periodo sem que o usuario repita o filtro.
 */
export interface ConversationHints {
  /**
   * Periodo resolvido no ultimo turno com dado (label ISO).
   * Aplicado pelo classifyIntent apenas quando o turno atual NAO traz periodo proprio.
   * Nunca atribui dado de um periodo a outro — so define a janela de busca.
   */
  readonly lastPeriod?: {
    readonly start: string; // ISO date "2026-01-01"
    readonly end: string; // ISO date "2026-05-01"
    readonly label: string; // ex: "janeiro_a_abril/2026"
  };
  /**
   * Nomes canonicos de produto do turno anterior (max 4).
   * Usados em follow-up de comparacao: fundidos com os produtos do turno atual.
   * Canonicos = LOWER(TRIM(...)) com acentos, como retornados pelo catalogo do tenant.
   */
  readonly lastProducts?: readonly string[];
  /**
   * Loja nomeada no turno anterior (external_ref, ex: "lj02").
   * Aplicado apenas quando o turno atual NAO nomeia loja propria.
   */
  readonly lastStore?: string;
}

export interface ContextRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly activeRole: ActiveRole;
  readonly memberships: readonly Membership[];
  /** Intent resolvido upstream pelo classificador (ex: "vendas_mes").
   *  Em o ChatService passa a pergunta real do usuario para que o
   *  classificador de loja (PgContextRepository) funcione corretamente.
   */
  readonly intent: string;
  /**
   * Hints conversacionais derivados pelo ChatService a partir do historico
   * da sessao corrente (N=4 turnos, efemero, tenant-safe).
   *
   * Opcional — ausente = comportamento estateless atual (sem carry-over).
   * Quando presente, o classifyIntent aplica heranca de periodo e fusao
   * de produtos conforme as regras do design 2026-06-07.
   */
  readonly hints?: ConversationHints;
}

/**
 * Dimensao de entidade (loja) opcional em um ScopedDataItem.
 * Carrega apenas nome de exibicao — NUNCA endereco/CNPJ/PII.
 * Decisao 2.1 do parecer grounding-por-loja 2026-06-03.
 */
export interface DataItemEntity {
  /** Identificador estavel da loja (ex: "lj01", ou entity_id quando ativar). */
  readonly id: string;
  /** Nome de exibicao da loja (ex: "Loja Centro") — rotulo estrutural, nao PII. */
  readonly label: string;
}

/**
 * Fato numerico com fonte rastreavel — cada item vira um `<<<DATA>>>` block
 * no user message, com source_ref citavel no output.
 *
 *: campo `entity` opcional carrega a dimensao de loja quando o item
 * representa um KPI de uma loja especifica. Populado pelo ContextBuilder
 * a partir do campo `note` JSON injetado pelo PgContextRepository.
 *
 * (2026-06-03 — chat padrao ouro): campo `period` opcional carrega
 * o periodo ISO do dado. Populado pelo ContextBuilder a partir dos campos
 * `periodStart`/`periodEnd` do note JSON. O PromptAssembler emite o periodo
 * explicitamente em cada bloco <<<DATA>>> para que o LLM nunca atribua
 * um dado a um periodo diferente do pedido.
 */
export interface ScopedDataItem {
  readonly sourceRef: SourceRef;
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  /** Texto descritivo/contextual ja sanitizado pelo repositorio. */
  readonly note?: string;
  /**
   * Dimensao de loja. Presente quando o item representa um KPI
   * de uma loja especifica, ausente para agregados de rede.
   * Nunca contem PII — so rotulo estrutural da loja.
   */
  readonly entity?: DataItemEntity;
  /**
   * Periodo do dado.
   * Extraido dos campos `periodStart`/`periodEnd` do note JSON.
   * Ausente em items legados ou quando o repositorio nao envia periodo.
   */
  readonly period?: DataItemPeriod;
}

/**
 * Escopo de granularidade resolvido pelo classificador de intent.
 * Espelha o tipo IntentScope do PgContextRepository (backend).
 */
export type IntentScope = 'aggregate' | 'per_store' | 'comparison';

/**
 * Motivo de fallback quando o contexto nao tem dado suficiente.
 * Espelha o tipo FallbackReason do PgContextRepository (backend).
 * O caller deve distinguir os tres para usar a copy correta (content 2026-06-03).
 */
export type FallbackReason = 'no_data' | 'out_of_scope' | 'ambiguous';

export interface SanitizedContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly activeRole: ActiveRole;
  readonly intent: string;
  readonly items: readonly ScopedDataItem[];
  /** Itens removidos por falta de permissao — rastreavel em audit. */
  readonly droppedBecauseOfRole: number;
  /**
   * Escopo de granularidade do contexto.
   * Propagado do PgContextRepository via StoreContextResult.
   * Undefined quando o repositorio nao retorna esse metadado (repos legados).
   */
  readonly intentScope?: IntentScope;
  /**
   * Motivo de fallback quando o contexto nao tem dado suficiente.
   * O caller usa isso para distinguir no_data / out_of_scope / ambiguous
   * e servir a copy honesta correta (content 2026-06-03).
   * Undefined quando ha dado suficiente.
   */
  readonly fallbackReason?: FallbackReason;
}

/**
 * Repositorio abstrato de dados scoped. A implementacao concreta em
 * usa o mesmo repository layer do dashboard (Flow 04) com `SET LOCAL
 * app.current_tenant` ativo + filtro de RBAC por conteudo.
 */
export interface ContextRepository {
  fetchForIntent(request: ContextRequest): Promise<readonly ScopedDataItem[]>;
}

/**
 * Regras de scope de papel aplicadas em cima dos dados retornados pelo
 * repositorio — camada de defesa em profundidade.
 *
 * Regras:
 *   - viewer: nunca recebe items marcados com `sourceRef.classification === 'pii'`
 *   - viewer: nunca recebe items com `label` contendo tokens de PII individual
 *   - editor: recebe tudo exceto audit log
 *   - admin/owner: recebe tudo
 *
 * amplia para regras por categoria de dado configuraveis por tenant.
 */
const PII_LABEL_HINTS = [
  'cpf',
  'email',
  'telefone',
  'whatsapp',
  'endereco',
  'endereço',
  'cliente_nome',
];

function isAllowedForRole(role: ActiveRole, item: ScopedDataItem): boolean {
  if (role === 'owner' || role === 'admin') return true;

  const labelLower = item.label.toLowerCase();
  const noteLower = (item.note ?? '').toLowerCase();
  const touchesPii =
    item.sourceRef.classification === 'pii' ||
    PII_LABEL_HINTS.some((h) => labelLower.includes(h) || noteLower.includes(h));

  if (role === 'viewer' && touchesPii) return false;
  if (role === 'editor' && item.sourceRef.classification === 'audit') return false;
  return true;
}

/**
 * Periodo ISO de um dado, extraido do campo `note` JSON.
 * Presente quando o PgContextRepository serializa `periodStart`/`periodEnd`.
 * Ausente em items legados ou quando o repositorio nao envia periodo.
 */
export interface DataItemPeriod {
  /** Data ISO 8601 de inicio do periodo (ex: "2026-04-01"). */
  readonly start: string;
  /** Data ISO 8601 de fim do periodo (ex: "2026-04-30"). */
  readonly end: string;
}

/**
 * Tenta parsear o campo `note` JSON para extrair a dimensao de loja e o periodo.
 *
 * O PgContextRepository serializa metadados em `note` como:
 *   `{ entityId: "lj01", storeLabel: "Loja Centro", intentScope: "per_store",
 *      periodStart: "2026-04-01", periodEnd: "2026-04-30" }`
 *
 * Retorna `{ entity, period }`. Falha silenciosa (note pode ser
 * texto livre ou JSON invalido em items legados).
 *
 * Nunca lanca excecao — fail-closed: sem entity/period se nao conseguir parsear.
 */
function parseMetadataFromNote(note: string | undefined): {
  entity: DataItemEntity | undefined;
  period: DataItemPeriod | undefined;
} {
  if (note === undefined || note.length === 0) return { entity: undefined, period: undefined };
  try {
    const parsed = JSON.parse(note) as unknown;
    if (typeof parsed !== 'object' || parsed === null)
      return { entity: undefined, period: undefined };
    const obj = parsed as Record<string, unknown>;

    // Entity (loja)
    const entityId = obj['entityId'];
    const storeLabel = obj['storeLabel'];
    const entity: DataItemEntity | undefined =
      typeof entityId === 'string' && entityId.length > 0 && typeof storeLabel === 'string'
        ? { id: entityId, label: storeLabel.length > 0 ? storeLabel : entityId }
        : undefined;

    // Periodo
    const periodStart = obj['periodStart'];
    const periodEnd = obj['periodEnd'];
    const period: DataItemPeriod | undefined =
      typeof periodStart === 'string' &&
      periodStart.length > 0 &&
      typeof periodEnd === 'string' &&
      periodEnd.length > 0
        ? { start: periodStart, end: periodEnd }
        : undefined;

    return { entity, period };
  } catch {
    // note nao e JSON — e texto livre (item legado), nao e erro
  }
  return { entity: undefined, period: undefined };
}

/**
 * Constroi o contexto scoped para uma request LLM.
 */
export class ContextBuilder {
  constructor(private readonly repo: ContextRepository) {}

  async build(request: ContextRequest): Promise<SanitizedContext> {
    this.assertMembership(request);

    const raw = await this.repo.fetchForIntent(request);

    // Extrai metadados do resultado do repositorio via propriedades
    // nao-enumeradas injetadas pelo PgContextRepository (StoreContextResult).
    // Fail-safe: repositorios legados nao tem esses campos — undefined e ok.
    const rawWithMeta = raw as unknown as {
      intentScope?: IntentScope;
      fallbackReason?: FallbackReason;
    };
    const intentScope: IntentScope | undefined = rawWithMeta.intentScope;
    const fallbackReason: FallbackReason | undefined = rawWithMeta.fallbackReason;

    const allowed: ScopedDataItem[] = [];
    let dropped = 0;
    for (const item of raw) {
      // Garantia cross-tenant: item nao pode pertencer a tenant diferente.
      if (item.sourceRef.tenantId !== request.tenantId) {
        dropped += 1;
        continue;
      }
      if (!isAllowedForRole(request.activeRole, item)) {
        dropped += 1;
        continue;
      }

      //: popula entity a partir do note JSON (stopgap).
      //: popula period a partir do note JSON (chat padrao ouro 2026-06-03).
      // Se o item ja tem entity/period (passado diretamente), preserva.
      // Se nao, tenta deserializar do note.
      const { entity: parsedEntity, period: parsedPeriod } = parseMetadataFromNote(item.note);
      const entity = item.entity ?? parsedEntity;
      const period = item.period ?? parsedPeriod;

      const enriched: ScopedDataItem = {
        ...item,
        ...(entity !== undefined ? { entity } : {}),
        ...(period !== undefined ? { period } : {}),
      };
      allowed.push(enriched);
    }

    return {
      tenantId: request.tenantId,
      userId: request.userId,
      activeRole: request.activeRole,
      intent: request.intent,
      items: allowed,
      droppedBecauseOfRole: dropped,
      ...(intentScope !== undefined ? { intentScope } : {}),
      ...(fallbackReason !== undefined ? { fallbackReason } : {}),
    };
  }

  private assertMembership(request: ContextRequest): void {
    const hit = request.memberships.find((m) => m.tenantId === request.tenantId);
    if (!hit) {
      throw new Error(
        `ContextBuilder: user ${request.userId} has no membership in tenant ${request.tenantId}`,
      );
    }
    if (hit.role !== request.activeRole) {
      throw new Error(
        `ContextBuilder: activeRole ${request.activeRole} does not match membership role ${hit.role}`,
      );
    }
  }
}
