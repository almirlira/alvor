/**
 * account-detector.ts — Detector heuristico de LINHAS da DRE.
 *
 * Mesma tecnica do column-detector do ALVOR, aplicada a rotulos de linha:
 * normaliza (minusculas, sem acento, sem numeracao "3.1.2", sem marcadores
 * "(-)" "(+)" "(=)"), e compara com uma tabela de sinonimos pt-BR.
 *
 * Confianca:
 *   1.0 = match exato com sinonimo
 *   0.8 = sinonimo contido no rotulo (palavra inteira) — vence o mais longo
 *   < 0.7 = nao classificado
 */

import type { AccountKey, SubtotalKey } from './dre-model.js';

export interface AccountMatch {
  readonly key: AccountKey;
  readonly confidence: number;
  /** Rotulo normalizado usado na comparacao. */
  readonly normalized: string;
  /** Marcador "(=)" ou palavra "total" no rotulo — indica linha de subtotal. */
  readonly looksLikeTotal: boolean;
}

export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(\s*[-+=]\s*\)/g, ' ') // (-) (+) (=)
    .replace(/^[\s\d.\-–—)]+(?=[a-z])/i, '') // numeracao "3.1.2 " ou "1 - "
    .replace(/[^a-z0-9%/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYNONYMS: Readonly<Record<AccountKey, readonly string[]>> = {
  receita_bruta: [
    'receita bruta', 'receita operacional bruta', 'receita bruta de vendas', 'vendas brutas',
    'faturamento bruto', 'faturamento', 'receita de vendas', 'receita de servicos',
    'receitas de vendas', 'vendas', 'receitas', 'receita operacional', 'receita',
    'vendas de mercadorias', 'vendas de produtos', 'prestacao de servicos', 'receita total',
  ],
  deducoes: [
    'deducoes', 'deducoes da receita', 'deducoes da receita bruta', 'deducoes de vendas',
    'impostos sobre vendas', 'impostos sobre a receita', 'impostos sobre faturamento',
    'impostos', 'tributos', 'simples nacional', 'das simples nacional', 'icms', 'iss', 'issqn',
    'pis', 'cofins', 'pis cofins', 'devolucoes', 'devolucoes e abatimentos', 'abatimentos',
    'descontos concedidos', 'descontos incondicionais', 'cancelamentos', 'devolucoes de vendas',
  ],
  cmv: [
    'cmv', 'custo das mercadorias vendidas', 'custo da mercadoria vendida', 'custo dos produtos vendidos',
    'cpv', 'custo dos servicos prestados', 'csp', 'custos variaveis', 'custo variavel', 'custos diretos',
    'custo de mercadoria', 'custos', 'custo das vendas', 'custo de vendas', 'insumos', 'materia prima',
    'mercadorias', 'custo dos produtos', 'custo de producao', 'custos de producao', 'custo',
  ],
  despesas_pessoal: [
    'despesas com pessoal', 'pessoal', 'folha', 'folha de pagamento', 'salarios', 'salarios e encargos',
    'salarios e ordenados', 'encargos', 'encargos sociais', 'encargos trabalhistas', 'fgts', 'inss',
    'inss patronal', 'pro labore', 'prolabore', 'beneficios', 'vale transporte', 'vale refeicao',
    'vale alimentacao', 'ferias', '13o salario', 'decimo terceiro', 'mao de obra', 'rescisoes',
    'rescisao', 'plano de saude', 'treinamento', 'estagiarios', 'freelancers', 'horas extras',
    'despesas de pessoal', 'gastos com pessoal', 'equipe',
  ],
  despesas_administrativas: [
    'despesas administrativas', 'administrativas', 'administrativo', 'despesas gerais e administrativas',
    'gerais e administrativas', 'despesas gerais', 'contabilidade', 'honorarios contabeis', 'contador',
    'escritorio', 'material de escritorio', 'material de expediente', 'software', 'softwares', 'sistemas',
    'assinaturas', 'assinaturas e sistemas', 'telefone', 'telefonia', 'internet', 'telefone e internet',
    'juridico', 'honorarios', 'honorarios advocaticios', 'consultoria', 'consultorias', 'seguros',
    'servicos de terceiros', 'terceiros', 'manutencao', 'manutencao e reparos', 'limpeza',
    'limpeza e conservacao', 'seguranca', 'vigilancia', 'viagens', 'viagens e estadias',
    'correios', 'cartorio', 'taxas e licencas', 'alvara', 'uniformes', 'copa e cozinha',
    'despesas administrativas gerais', 'servicos profissionais', 'associacoes', 'sindicato',
  ],
  despesas_comerciais: [
    'despesas comerciais', 'comerciais', 'comercial', 'despesas com vendas', 'despesas de vendas',
    'vendas e comercial', 'comissoes', 'comissao', 'comissoes sobre vendas', 'taxas de cartao',
    'taxa de cartao', 'taxas de cartoes', 'cartao de credito', 'taxas de marketplace', 'marketplace',
    'taxa de entrega', 'frete', 'fretes', 'fretes e entregas', 'delivery', 'ifood', 'embalagens',
    'embalagem', 'brindes', 'representantes', 'representacao comercial', 'despesas com entregas',
    'logistica', 'taxas de aplicativos', 'aplicativos de entrega',
  ],
  despesas_ocupacao: [
    'ocupacao', 'despesas de ocupacao', 'aluguel', 'alugueis', 'aluguel e condominio', 'condominio',
    'iptu', 'energia', 'energia eletrica', 'luz', 'agua', 'agua e esgoto', 'gas', 'ocupacao e utilidades',
    'utilidades', 'infraestrutura', 'aluguel do ponto', 'aluguel da loja', 'aluguel de imovel',
    'agua luz e telefone', 'agua e luz', 'luz e agua', 'contas de consumo',
  ],
  despesas_marketing: [
    'marketing', 'propaganda', 'publicidade', 'propaganda e publicidade', 'publicidade e propaganda',
    'anuncios', 'midia', 'midia paga', 'trafego pago', 'google ads', 'meta ads', 'facebook ads',
    'instagram ads', 'agencia', 'agencia de marketing', 'eventos', 'promocoes', 'marketing e publicidade',
    'marketing digital', 'redes sociais', 'influenciadores', 'material grafico', 'panfletagem',
    'despesas de marketing', 'despesas com marketing', 'comunicacao',
  ],
  outras_despesas: [
    'outras despesas', 'outras despesas operacionais', 'despesas diversas', 'diversos', 'diversas',
    'outros', 'outras', 'depreciacao', 'depreciacao e amortizacao', 'amortizacao', 'perdas', 'multas',
    'contingencias', 'outros gastos', 'despesas nao operacionais', 'despesas eventuais', 'doacoes',
    'outras despesas gerais',
  ],
  receitas_financeiras: [
    'receitas financeiras', 'receita financeira', 'rendimentos', 'rendimentos financeiros',
    'juros recebidos', 'juros ativos', 'rendimento de aplicacoes', 'rendimentos de aplicacoes',
    'descontos obtidos', 'receitas de aplicacoes', 'variacao cambial ativa',
  ],
  despesas_financeiras: [
    'despesas financeiras', 'despesa financeira', 'juros', 'juros pagos', 'juros passivos',
    'tarifas bancarias', 'despesas bancarias', 'taxas bancarias', 'iof', 'emprestimos',
    'juros de emprestimos', 'juros sobre emprestimos', 'antecipacao de recebiveis', 'multas e juros',
    'juros e multas', 'encargos financeiros', 'custo financeiro', 'variacao cambial passiva',
  ],
  impostos_resultado: [
    'irpj', 'csll', 'ir e csll', 'irpj e csll', 'irpj csll', 'imposto de renda', 'contribuicao social',
    'provisao para ir', 'provisao para irpj', 'impostos sobre o lucro', 'impostos sobre resultado',
    'imposto de renda e contribuicao social', 'ir', 'provisao ir csll',
  ],
  // ---- subtotais (linhas que a planilha ja traz calculadas) ----
  receita_liquida: [
    'receita liquida', 'receita operacional liquida', 'receita liquida de vendas', 'vendas liquidas',
    'faturamento liquido', 'receita liquida operacional',
  ],
  lucro_bruto: ['lucro bruto', 'resultado bruto', 'margem bruta', 'lucro bruto operacional'],
  despesas_operacionais: [
    'despesas operacionais', 'total de despesas', 'total despesas', 'despesas', 'total das despesas',
    'total das despesas operacionais', 'total de despesas operacionais', 'despesas totais',
    'total gastos', 'total de gastos', 'gastos',
  ],
  resultado_operacional: [
    'resultado operacional', 'lucro operacional', 'ebit', 'ebitda', 'lajir', 'lajida',
    'resultado antes do resultado financeiro', 'lucro operacional antes do resultado financeiro',
    'resultado operacional liquido',
  ],
  resultado_financeiro: ['resultado financeiro', 'resultado financeiro liquido'],
  resultado_antes_impostos: [
    'resultado antes do ir', 'resultado antes dos impostos', 'lucro antes do imposto',
    'lucro antes do imposto de renda', 'lair', 'resultado antes do irpj', 'resultado antes do irpj e csll',
    'lucro antes do ir e csll', 'resultado antes de impostos', 'lucro antes dos impostos',
  ],
  resultado_liquido: [
    'resultado liquido', 'lucro liquido', 'lucro prejuizo', 'lucro ou prejuizo', 'resultado do periodo',
    'resultado do exercicio', 'lucro liquido do periodo', 'lucro liquido do exercicio', 'resultado',
    'lucro prejuizo do periodo', 'lucro prejuizo do exercicio', 'resultado liquido do periodo',
    'resultado liquido do exercicio', 'lucro', 'prejuizo',
  ],
};

const SUBTOTAL_KEYS: ReadonlySet<string> = new Set<SubtotalKey>([
  'receita_liquida',
  'lucro_bruto',
  'despesas_operacionais',
  'resultado_operacional',
  'resultado_financeiro',
  'resultado_antes_impostos',
  'resultado_liquido',
]);

interface Candidate {
  readonly key: AccountKey;
  readonly synonym: string;
  readonly confidence: number;
}

function wholeWordIncludes(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 ? ' ' : haystack[idx - 1];
  const afterIdx = idx + needle.length;
  const after = afterIdx >= haystack.length ? ' ' : haystack[afterIdx];
  return before === ' ' && after === ' ';
}

/**
 * Classifica um rotulo de linha da DRE. Retorna null quando nao reconhece.
 */
export function detectAccount(rawLabel: string): AccountMatch | null {
  const normalized = normalizeLabel(rawLabel);
  if (normalized.length === 0) return null;
  const looksLikeTotal = /\(\s*=\s*\)/.test(rawLabel) || /\btotal\b/.test(normalized);

  let best: Candidate | null = null;
  for (const key of Object.keys(SYNONYMS) as AccountKey[]) {
    for (const syn of SYNONYMS[key]) {
      let confidence = 0;
      if (normalized === syn) confidence = 1.0;
      else if (wholeWordIncludes(normalized, syn)) confidence = 0.8;
      else continue;
      // Preferencia: maior confianca; empate → sinonimo mais longo (mais especifico);
      // novo empate → subtotal perde para conta de entrada (evita "despesas" engolir "despesas com pessoal").
      if (
        best === null ||
        confidence > best.confidence ||
        (confidence === best.confidence && syn.length > best.synonym.length) ||
        (confidence === best.confidence &&
          syn.length === best.synonym.length &&
          SUBTOTAL_KEYS.has(best.key) &&
          !SUBTOTAL_KEYS.has(key))
      ) {
        best = { key, synonym: syn, confidence };
      }
    }
  }
  if (best === null || best.confidence < 0.7) return null;
  return { key: best.key, confidence: best.confidence, normalized, looksLikeTotal };
}
