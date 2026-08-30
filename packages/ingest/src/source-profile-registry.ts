/**
 * source-profile-registry.ts — Registro de perfis declarativos padrão por tipo de formato.
 *
 * Cada perfil aqui é o DEFAULT para um formato de planilha específico.
 * Tenant pode referenciar o perfil por profile_id em data_sources.config,
 * ou fornecer um perfil inline completo (override total).
 *
 *: ZERO nome de cliente em código.
 * O profile_id descreve o FORMATO/TEMPLATE, não o cliente.
 *
 * Como adicionar um novo perfil:
 *   1. Defina o objeto SourceProfile abaixo (sem nome de cliente).
 *   2. Registre em DEFAULT_PROFILES.
 *   3. Para ativar para uma fonte: configure data_sources.config.profile_id = 'id-do-perfil'
 *      OU configure data_sources.config.profile = { ...perfil completo... }.
 *
 * Modo heurístico como fallback:
 *   Quando nenhum perfil declarativo é encontrado (fonte sem config.profile e sem
 *   config.profile_id), o sistema cai para a heurística do column-detector.
 *   O resultado da heurística NUNCA substitui silenciosamente um perfil mal configurado —
 *   erros de validação são propagados explicitamente ao caller.
 */

import type { SourceProfile } from './source-profile.js';

// ---------------------------------------------------------------------------
// Perfis registrados
// ---------------------------------------------------------------------------

/**
 * Perfil para planilhas MKT_vendas_diarias no formato padronizado.
 *
 * Cobre:
 *  - Aba RESUMO MENSAL (tabular): cabeçalho na linha 3 (índice 2), linha de TOTAL ignorada
 *  - Aba SABORES POR DIA (pivot): receita e volume de sabores
 *  - Aba COBERTURAS POR DIA (pivot): receita de coberturas (sem volume)
 *
 * Versão 1 — mapeamentos iniciais com campos VLR BALCAO/DELIVERY.
 */
const MKT_VENDAS_DIARIAS_V1: SourceProfile = {
  profile_id: 'mkt-vendas-diarias-v1',
  profile_version: 1,
  file_name_pattern: 'MKT_vendas_diarias',
  entity_column: 'loja',
  sheets: [
    {
      name_pattern: 'resumo\\s*mensal',
      header_row: 2,
      skip_patterns: ['total'],
      layout: 'tabular',
      column_map: {
        // Mapeamentos explícitos para colunas que a heurística pode errar ou não cobrir.
        // Incluem os campos de valor por canal (balcao/delivery).
        'VLR BALCAO': 'vlr_balcao',
        'VLR DELIVERY': 'vlr_delivery',
        'QTDE DELIVERY': 'quantidade_delivery',
        'QTDE BALCAO': 'quantidade_balcao',
        // Campos de volume e faturamento total
        'VENDA TOTAL BOLOS': 'quantidade',
        'LUCRO BRUTO': 'lucro',
      },
      value_columns: [
        'vlr_balcao',
        'vlr_delivery',
        'quantidade_delivery',
        'quantidade_balcao',
        'quantidade',
        'lucro',
        'vendas',
        'ticket_medio',
      ],
    },
    {
      name_pattern: 'sabores\\s*(por|de)\\s*dia',
      header_row: 1,
      layout: 'pivot',
      is_volume_source: true,
    },
    {
      name_pattern: 'coberturas\\s*(por|de)\\s*dia',
      header_row: 1,
      layout: 'pivot',
      is_volume_source: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Registro e lookup
// ---------------------------------------------------------------------------

/**
 * Mapa de perfis-padrão indexado por profile_id.
 * O registro é imutável em runtime — perfis são adicionados aqui em código.
 */
const DEFAULT_PROFILES: Readonly<Record<string, SourceProfile>> = {
  [MKT_VENDAS_DIARIAS_V1.profile_id]: MKT_VENDAS_DIARIAS_V1,
};

/**
 * Busca um perfil padrão pelo profile_id.
 * Retorna null se não encontrado — o caller decide o fallback.
 *
 * @param profileId - ID do perfil a buscar
 */
export function lookupProfileById(profileId: string): SourceProfile | null {
  return DEFAULT_PROFILES[profileId] ?? null;
}

/**
 * Detecta automaticamente o perfil padrão mais adequado pelo nome do arquivo.
 * Aplicado quando a fonte não tem config.profile nem config.profile_id.
 *
 * Retorna o primeiro perfil cujo file_name_pattern bate o nome do arquivo.
 * Retorna null se nenhum perfil bater — o caller cai para heurística.
 *
 * Comportamento intencional: este método só é chamado como FALLBACK após
 * confirmar que config.profile e config.profile_id estão ausentes.
 * A heurística permanece o fallback final — este método é o "fallback declarativo".
 *
 * @param fileName - Nome do arquivo (ex: 'MKT_vendas_diarias_lj01_2026-04_v01.xlsx')
 */
export function detectProfileByFileName(fileName: string): SourceProfile | null {
  for (const profile of Object.values(DEFAULT_PROFILES)) {
    if (!profile.file_name_pattern) continue;
    try {
      if (new RegExp(profile.file_name_pattern, 'i').test(fileName)) {
        return profile;
      }
    } catch {
      // regex inválido no registro — ignora silenciosamente
    }
  }
  return null;
}

/**
 * Lista todos os perfis registrados (para diagnóstico/seed).
 */
export function listRegisteredProfiles(): readonly SourceProfile[] {
  return Object.values(DEFAULT_PROFILES);
}

// Exporta o perfil padrão diretamente para referência em testes
export { MKT_VENDAS_DIARIAS_V1 };
