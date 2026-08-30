/**
 * Input sanitizer — Camada 3 do hardening.
 *
 * Remove padroes conhecidos de prompt injection antes que qualquer conteudo
 * externo (legenda de post, nome de cliente CRM, comentario em DM, etc) seja
 * injetado em um bloco `<<<DATA>>>` no user message.
 *
 * **Scope:** cobertura dos padroes mais comuns e conhecidos. amplia
 * via config atualizavel sem deploy.
 *
 * Tambem:
 *   - trunca payloads acima de MAX_ITEM_CHARS
 *   - sinaliza conteudo suspeito (rastreavel em llm_audit_log)
 *   - escapa delimitadores `<<<DATA>>>` / `<<<END_DATA>>>`
 */

/** Teto de tamanho por item de conteudo externo. */
export const MAX_ITEM_CHARS = 500;

/** Acima deste tamanho o item e considerado anomalo (regra 3). */
export const ANOMALY_THRESHOLD_CHARS = 2000;

/**
 * Padroes conhecidos de prompt injection. Todos case-insensitive.
 * Atualizaveis via config em sem deploy — em sao hardcoded.
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  // "ignore previous instructions", "disregard all prior rules", etc
  /(ignore|disregard|forget)\s+(all|any|previous|above|prior|earlier)\s+(instructions?|rules?|prompts?|context)/i,
  // "you are now X", "you are a Y"
  /you\s+are\s+(now|a)\s+/i,
  // role headers tentando se passar por system
  /(^|\n)\s*system\s*:/i,
  /(^|\n)\s*assistant\s*:/i,
  // tags tipicas de chat templates
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<\/?\s*system\s*>/i,
  /\[\/?INST\]/i,
  // "act as", "pretend to be", "roleplay"
  /\b(act\s+as|pretend\s+to\s+be|roleplay\s+as)\b/i,
  // portugues
  /\b(ignore|ignora|esqueca|esqueça|desconsidere|desconsidera)\b[\s\w]{0,40}?\b(instrucoes?|instruções?|regras?|prompt|acima|anterior|anteriores)/i,
  /\b(voce\s+e|você\s+é)\s+(agora|um|uma)\s+/i,
  // espanhol
  /\b(ignora|olvida|desestima)\b[\s\w]{0,40}?\b(instrucciones?|reglas?|anterior|anteriores|prompt)/i,
  // tentativas de extracao de system prompt
  /\b(show|reveal|print|output|display)\s+(the\s+)?(system\s+)?(prompt|instructions?)/i,
];

export interface SanitizeResult {
  readonly sanitized: string;
  readonly suspicious: boolean;
  readonly truncated: boolean;
  readonly anomalous: boolean;
  /** Padroes que deram match (nomes legiveis para audit log). */
  readonly matchedPatterns: readonly string[];
}

/**
 * Sanitiza um item de conteudo externo antes de injetar em prompt.
 *
 * **Nao joga excecao** — sempre retorna um SanitizeResult. O caller decide
 * se usa o conteudo sanitizado, rejeita a request, ou so loga.
 */
export function sanitizeExternalPayload(raw: string): SanitizeResult {
  if (typeof raw !== 'string') {
    return {
      sanitized: '',
      suspicious: false,
      truncated: false,
      anomalous: false,
      matchedPatterns: [],
    };
  }

  let working = raw;
  const matched: string[] = [];

  // 1. Detecta padroes adversariais e remove (substitui por placeholder).
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(working)) {
      matched.push(pattern.source);
      working = working.replace(
        new RegExp(
          pattern.source,
          pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
        ),
        '[REMOVED-SUSPICIOUS-INSTRUCTION]',
      );
    }
  }

  // 2. Escapa delimitadores de bloco de dados para impedir "falso fim de bloco".
  working = working
    .replace(/<<<DATA>>>/g, '<<<D_A_T_A>>>')
    .replace(/<<<END_DATA>>>/g, '<<<E_N_D>>>');

  // 3. Detecta anomalia de tamanho.
  const anomalous = raw.length > ANOMALY_THRESHOLD_CHARS;

  // 4. Trunca para o teto por item.
  let truncated = false;
  if (working.length > MAX_ITEM_CHARS) {
    working = working.slice(0, MAX_ITEM_CHARS) + ' [...]';
    truncated = true;
  }

  return {
    sanitized: working,
    suspicious: matched.length > 0 || anomalous,
    truncated,
    anomalous,
    matchedPatterns: matched,
  };
}
