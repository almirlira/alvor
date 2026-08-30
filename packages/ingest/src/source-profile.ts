/**
 * source-profile.ts — Tipo e loader de perfil declarativo por fonte.
 *
 * Um perfil declarativo descreve COMPLETAMENTE como ler a planilha de uma fonte:
 *   - quais abas processar (e como identificá-las)
 *   - onde está a linha de cabeçalho
 *   - quais linhas ignorar
 *   - mapa coluna→canonical
 *   - qual coluna identifica a entidade (loja/filial)
 *   - padrões de linhas de total/subtotal a pular
 *
 * O perfil é carregado a partir de `data_sources.config` (campo JSONB que já
 * existe — sem migration). Tenant pode referenciar/override via config.
 *
 *: zero nome de cliente em código — o perfil é dado, não branch.
 *
 * Precedência:
 *   1. Perfil declarativo em `data_sources.config.profile` (override declarativo)
 *   2. Perfil padrão do registro por `profile_id` referenciado em config
 *   3. Perfil hardcoded em REGISTERED_PROFILES/PIVOT_REVENUE_PROFILES (legado)
 *   4. Heurística do column-detector (fallback)
 *
 * O campo `profile_id` + `profile_version` é propagado no metadata de cada
 * record produzido, para rastreabilidade de linhagem.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Mapeamento declarativo coluna→canonical.
 * A chave é o header raw (ou normalizado) da coluna na planilha.
 * O valor é o canonical do metric_key_catalog.
 *
 * Exemplo: { "VLR BALCAO": "vlr_balcao", "VLR DELIVERY": "vlr_delivery" }
 */
export type ColumnMap = Readonly<Record<string, string>>;

/**
 * Descrição de uma aba a ser processada pelo perfil declarativo.
 */
export interface ProfileSheet {
  /**
   * Padrão de nome de aba (regex serializado como string, flags 'i' aplicadas).
   * Exemplo: "resumo\\s*mensal" → /resumo\s*mensal/i
   */
  readonly name_pattern: string;

  /**
   * Índice (0-based) da linha de cabeçalho.
   * Default: 0 (primeira linha).
   */
  readonly header_row: number;

  /**
   * Linhas a ignorar antes dos dados (por índice 0-based após o header).
   * Raramente necessário — use skip_patterns para linhas de total.
   */
  readonly skip_rows?: readonly number[];

  /**
   * Padrões regex (serializado como string) contra o conteúdo da primeira
   * célula da linha. Linhas que batem qualquer padrão são ignoradas.
   * Exemplo: ["total", "^\\s*$"] ignora linhas de total e linhas em branco.
   */
  readonly skip_patterns?: readonly string[];

  /**
   * Mapa coluna→canonical para esta aba. Sobrepõe a heurística do
   * column-detector para as colunas declaradas.
   *
   * A chave é o header raw (insensível a maiúsculas/acentos após normalização
   * interna). Valor é o canonical do catalog.
   */
  readonly column_map?: ColumnMap;

  /**
   * Colunas que representam valores numéricos relevantes para KPI.
   * Se declarado, só essas colunas são consideradas — as demais são ignoradas
   * pelo normalizer. Se ausente, todas as colunas mapeadas são consideradas.
   */
  readonly value_columns?: readonly string[];

  /**
   * Tipo de layout desta aba.
   * - 'tabular': layout padrão (header + linhas de dados) — default.
   * - 'pivot': layout pivô transposto (itens × dias) como SABORES POR DIA.
   *   Abas com layout 'pivot' são processadas pelo pivot-revenue-extractor.
   */
  readonly layout?: 'tabular' | 'pivot';

  /**
   * Para abas de layout 'pivot': indica se esta aba contribui para volume_total.
   * Apenas abas de SABORES contribuem para volume (não coberturas).
   * Default: false.
   */
  readonly is_volume_source?: boolean;
}

/**
 * Perfil declarativo completo de uma fonte.
 *
 * É persistido em `data_sources.config.profile` como objeto JSON.
 * Também serve como formato canônico no registro de perfis-padrão.
 */
export interface SourceProfile {
  /**
   * Identificador único do perfil. Aparece em metadata de linhagem.
   * Exemplo: 'casa-de-bolos-vendas-diarias-v1'
   *
   * Regra: NUNCA inclua nome de cliente — use descrição do formato.
   * O profile_id é identificador do formato/template, não do cliente.
   */
  readonly profile_id: string;

  /**
   * Versão inteira do perfil. Incrementar ao alterar a semântica do mapeamento.
   * Insumo de linhagem: permite reprocessar histórico com o perfil vigente na época.
   */
  readonly profile_version: number;

  /**
   * Padrão de nome de arquivo (regex serializado) para auto-detecção.
   * Opcional — se ausente, o perfil não faz auto-detecção por nome de arquivo.
   * Exemplo: "MKT_vendas_diarias" → /MKT_vendas_diarias/i
   */
  readonly file_name_pattern?: string;

  /**
   * Abas a processar. Cada entrada descreve como identificar e ler uma aba.
   * Se vazio/ausente, o comportamento cai para heurística.
   */
  readonly sheets: readonly ProfileSheet[];

  /**
   * Nome da coluna que identifica a entidade (loja/filial) nos dados tabulares.
   * Após normalização (lowercase, sem acento). Exemplo: 'loja'.
   * Usado para propagar o identificador da entidade.
   * Se ausente, registros não têm entity_id (aceitável para fontes sem multi-entidade).
   */
  readonly entity_column?: string;
}

// ---------------------------------------------------------------------------
// Validação (sem Zod — validação manual por função pura)
// ---------------------------------------------------------------------------

/**
 * Resultado de validação de um perfil declarativo.
 */
export type ProfileValidationResult =
  | { readonly ok: true; readonly profile: SourceProfile }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Valida um objeto arbitrário como SourceProfile.
 * Usado ao carregar perfil de `data_sources.config` (dado não confiável).
 *
 * Regras:
 *  - profile_id: string não vazia
 *  - profile_version: inteiro >= 1
 *  - sheets: array (pode ser vazio — heurística assume controle)
 *  - Cada sheet: name_pattern string, header_row inteiro >= 0
 *
 * Chaves desconhecidas são ignoradas silenciosamente (extensibilidade futura).
 */
export function validateSourceProfile(raw: unknown): ProfileValidationResult {
  const errors: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['profile deve ser um objeto'] };
  }

  const obj = raw as Record<string, unknown>;

  // profile_id
  if (typeof obj['profile_id'] !== 'string' || obj['profile_id'].length === 0) {
    errors.push('profile_id: string não vazia obrigatória');
  }

  // profile_version
  if (
    typeof obj['profile_version'] !== 'number' ||
    !Number.isInteger(obj['profile_version']) ||
    obj['profile_version'] < 1
  ) {
    errors.push('profile_version: inteiro >= 1 obrigatório');
  }

  // sheets
  if (!Array.isArray(obj['sheets'])) {
    errors.push('sheets: array obrigatório (pode ser vazio)');
  } else {
    for (let i = 0; i < obj['sheets'].length; i++) {
      const sheet = obj['sheets'][i];
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
        errors.push(`sheets[${i}]: deve ser objeto`);
        continue;
      }
      const s = sheet as Record<string, unknown>;
      if (typeof s['name_pattern'] !== 'string' || s['name_pattern'].length === 0) {
        errors.push(`sheets[${i}].name_pattern: string não vazia obrigatória`);
      }
      if (
        typeof s['header_row'] !== 'number' ||
        !Number.isInteger(s['header_row']) ||
        (s['header_row'] as number) < 0
      ) {
        errors.push(`sheets[${i}].header_row: inteiro >= 0 obrigatório`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    profile: raw as SourceProfile,
  };
}

// ---------------------------------------------------------------------------
// Loader — lê perfil de data_sources.config
// ---------------------------------------------------------------------------

/**
 * Resultado do carregamento de perfil declarativo.
 *
 * - profile: perfil válido se encontrado e válido
 * - source: de onde veio o perfil ('config' = da fonte, 'registry' = padrão)
 * - errors: erros de validação se o config continha perfil inválido
 */
export type ProfileLoadResult =
  | {
      readonly found: true;
      readonly profile: SourceProfile;
      readonly source: 'config' | 'registry';
    }
  | { readonly found: false; readonly errors?: readonly string[] };

/**
 * Carrega o perfil declarativo de `data_sources.config`.
 *
 * Procura em:
 *   1. `config.profile` — perfil inline completo (override declarativo máximo)
 *   2. `config.profile_id` — referência a perfil do registro (loadProfileFromRegistry)
 *
 * Retorna `{ found: false }` se nenhum perfil estiver configurado.
 * Retorna `{ found: false, errors }` se o config continha perfil inválido.
 *
 * O caller decide como tratar `found: false` — normalmente cai para heurística.
 *
 * @param config - Objeto `data_sources.config` da fonte (JSONB do banco)
 * @param registryLookup - Função para buscar perfil por ID no registro de perfis-padrão
 */
export function loadProfileFromConfig(
  config: Record<string, unknown> | undefined | null,
  registryLookup: (profileId: string) => SourceProfile | null,
): ProfileLoadResult {
  if (!config) {
    return { found: false };
  }

  // Caso 1: perfil inline completo em config.profile
  if ('profile' in config && config['profile'] !== undefined && config['profile'] !== null) {
    const validation = validateSourceProfile(config['profile']);
    if (!validation.ok) {
      return { found: false, errors: validation.errors };
    }
    return { found: true, profile: validation.profile, source: 'config' };
  }

  // Caso 2: referência a perfil do registro por profile_id
  if (typeof config['profile_id'] === 'string' && config['profile_id'].length > 0) {
    const profileFromRegistry = registryLookup(config['profile_id']);
    if (profileFromRegistry !== null) {
      return { found: true, profile: profileFromRegistry, source: 'registry' };
    }
    // profile_id declarado mas não encontrado no registro — erro explícito
    return {
      found: false,
      errors: [`profile_id "${config['profile_id']}" não encontrado no registro de perfis`],
    };
  }

  return { found: false };
}

// ---------------------------------------------------------------------------
// Utilitários de aplicação de perfil
// ---------------------------------------------------------------------------

/**
 * Compila um ProfileSheet para uso em tempo de execução.
 * Converte name_pattern e skip_patterns de string para RegExp.
 */
export interface CompiledProfileSheet {
  readonly namePattern: RegExp;
  readonly headerRow: number;
  readonly skipRows: readonly number[];
  readonly skipPatterns: readonly RegExp[];
  readonly columnMap: ColumnMap;
  readonly valueColumns: readonly string[] | null;
  readonly layout: 'tabular' | 'pivot';
  readonly isVolumeSource: boolean;
}

export function compileProfileSheet(sheet: ProfileSheet): CompiledProfileSheet {
  const skipPatterns: RegExp[] = (sheet.skip_patterns ?? []).map((p) => {
    try {
      return new RegExp(p, 'i');
    } catch {
      return /(?!)/; // regex que nunca bate — fallback seguro
    }
  });

  let namePattern: RegExp;
  try {
    namePattern = new RegExp(sheet.name_pattern, 'i');
  } catch {
    namePattern = /(?!)/;
  }

  return {
    namePattern,
    headerRow: sheet.header_row,
    skipRows: sheet.skip_rows ?? [],
    skipPatterns,
    columnMap: sheet.column_map ?? {},
    valueColumns: sheet.value_columns ? [...sheet.value_columns] : null,
    layout: sheet.layout ?? 'tabular',
    isVolumeSource: sheet.is_volume_source ?? false,
  };
}

/**
 * Compila o file_name_pattern do perfil, se presente.
 */
export function compileFileNamePattern(profile: SourceProfile): RegExp | null {
  if (!profile.file_name_pattern) return null;
  try {
    return new RegExp(profile.file_name_pattern, 'i');
  } catch {
    return null;
  }
}

/**
 * Encontra a primeira aba do perfil que bate o nome de aba dado.
 * Retorna null se nenhuma aba bater.
 */
export function findMatchingProfileSheet(
  compiledSheets: readonly CompiledProfileSheet[],
  sheetName: string,
): CompiledProfileSheet | null {
  for (const s of compiledSheets) {
    if (s.namePattern.test(sheetName)) return s;
  }
  return null;
}
