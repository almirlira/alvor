/**
 * LLM audit logger — item 8 do ADR-008.
 *
 * Grava `llm_audit_log` conforme schema ADR-003 + retencao B.22 D-019
 * (90 dias default). Em F1 este logger e estrutural: se `db` e injetado,
 * grava no banco; se nao, e no-op estruturado que apenas retorna o
 * payload que seria gravado (util para tests + para o bootstrap de
 * backend integrar em F2 sem reinventar shape).
 *
 * Campos gravados (ADR-008 §2 item 8):
 *   request_id, tenant_id, user_id, user_role, model_version,
 *   prompt_hash, response_hash, tokens_in, tokens_out,
 *   hallucination_check_passed, output_validation_passed,
 *   rejection_reason, latency_ms, created_at.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ActiveRole } from './context-builder.js';
import type { RejectionReason, SourceRef } from './output-validator.js';

export interface AuditPayload {
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userRole: ActiveRole;
  readonly modelVersion: string;
  /** Nome do provider usado (ex: `vertex-anthropic`, `mock`). B.26 / ADR-010. */
  readonly providerName?: string;
  /** Regiao do provider (ex: `us-east5`). B.26 / ADR-010. */
  readonly region?: string;
  readonly promptHash: string;
  readonly responseHash: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly hallucinationCheckPassed: boolean;
  readonly outputValidationPassed: boolean;
  readonly rejectionReason: RejectionReason | null;
  readonly latencyMs: number;
  /**
   * Fontes injetadas no prompt desta chamada (migration 0028).
   *
   * Sem elas, um caso do audit log NAO e reproduzivel com fidelidade: o
   * guardiao de grounding so consegue julgar uma resposta sabendo quais fontes
   * foram oferecidas ao modelo, e reconstrui-las a partir do texto do prompt
   * produz avaliacao FALSA (medido em 2026-08-11). Com elas, qualquer troca de
   * modelo ou de prompt vira replay fiel sobre trafego real.
   *
   * Nao introduz nova classe de dado: os mesmos valores ja estao em texto na
   * coluna `prompt` da mesma linha, sob a mesma RLS e a mesma retencao.
   */
  readonly sourceRefs?: readonly SourceRef[];
  readonly createdAt: Date;
}

export interface AuditLogEntry {
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userRole: ActiveRole;
  readonly modelVersion: string;
  readonly providerName?: string;
  readonly region?: string;
  readonly prompt: string;
  readonly response: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly hallucinationCheckPassed: boolean;
  readonly outputValidationPassed: boolean;
  readonly rejectionReason: RejectionReason | null;
  readonly latencyMs: number;
  /** Fontes injetadas no prompt — ver `AuditPayload.sourceRefs` (migration 0028). */
  readonly sourceRefs?: readonly SourceRef[];
}

/** Interface minima de DB para gravacao — evita acoplar a pg/postgres. */
export interface AuditDb {
  insertLlmAuditLog(row: AuditPayload & { prompt: string; response: string }): Promise<void>;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export class LlmAuditLogger {
  constructor(private readonly db?: AuditDb) {}

  /**
   * Grava entry de auditoria. Retorna o payload estruturado mesmo em
   * modo no-op (sem db) — assim tests e callers tem observabilidade do
   * shape sem depender de instrumentar db.
   */
  async record(entry: AuditLogEntry): Promise<AuditPayload> {
    const payload: AuditPayload = {
      requestId: entry.requestId || randomUUID(),
      tenantId: entry.tenantId,
      userId: entry.userId,
      userRole: entry.userRole,
      modelVersion: entry.modelVersion,
      ...(entry.providerName !== undefined ? { providerName: entry.providerName } : {}),
      ...(entry.region !== undefined ? { region: entry.region } : {}),
      promptHash: sha256(entry.prompt),
      responseHash: sha256(entry.response),
      tokensIn: entry.tokensIn,
      tokensOut: entry.tokensOut,
      hallucinationCheckPassed: entry.hallucinationCheckPassed,
      outputValidationPassed: entry.outputValidationPassed,
      rejectionReason: entry.rejectionReason,
      latencyMs: entry.latencyMs,
      ...(entry.sourceRefs !== undefined ? { sourceRefs: entry.sourceRefs } : {}),
      createdAt: new Date(),
    };

    if (this.db !== undefined) {
      await this.db.insertLlmAuditLog({
        ...payload,
        prompt: entry.prompt,
        response: entry.response,
      });
    }

    return payload;
  }
}
