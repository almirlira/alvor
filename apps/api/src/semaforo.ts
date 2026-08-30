/**
 * semaforo.ts — Semaforo de Autonomia.
 *
 * Classifica cada problema/oportunidade encontrado na DRE pelo nivel de autonomia
 * do dono para agir:
 *   verde    — o dono executa sozinho (renegociar fornecedor, cortar assinatura, ajustar preco)
 *   amarelo  — exige validacao do contador ou do gerente do banco (impostos sobre vendas,
 *              custo da divida, pro-labore, linhas nao classificadas)
 *   vermelho — nunca sai daqui sem parecer profissional (regime tributario, reclassificacao,
 *              qualquer coisa retroativa)
 *
 * Regras de confiabilidade (arquitetura do owner):
 *   - Nunca emitimos parecer: emitimos HIPOTESE FUNDAMENTADA + pedido de validacao ja escrito.
 *   - Toda sugestao fiscal carrega norma citada, vigencia, nivel de confianca e o semaforo.
 *   - Trilha de auditoria: todo numero aponta para a linha da DRE ou o KPI de origem ([ref:]).
 *
 * Deterministico: sem IA. Roda em milissegundos e sempre tem fonte.
 */

import { ACCOUNT_BY_KEY, type DreImport, type EntryKey } from '@dre/ingest';
import { loadFiscalReference, monthLabel } from './context.js';

export type SemaforoLevel = 'verde' | 'amarelo' | 'vermelho';

export interface SemaforoEvidence {
  readonly label: string;
  readonly value: number;
  readonly unit: 'BRL' | '%' | 'pp' | 'meses';
  readonly refId: string;
  readonly period?: string;
}

export interface SemaforoNorma {
  readonly citada: string;
  readonly vigencia: string;
  readonly fonte_url?: string;
}

export interface SemaforoCard {
  readonly id: string;
  readonly level: SemaforoLevel;
  /** Ordem dentro do nivel (menor = mais importante). */
  readonly priority: number;
  readonly title: string;
  /** O problema em uma frase, linguagem de dono. */
  readonly problem: string;
  readonly evidence: readonly SemaforoEvidence[];
  /** Quem age. */
  readonly who: 'voce' | 'contador' | 'gerente do banco' | 'contador ou consultor tributario';
  readonly actions: readonly string[];
  /** Valor em jogo (nunca "economia prometida"). */
  readonly impact: { readonly label: string; readonly value: number; readonly refId: string } | null;
  /** Texto pronto para mandar ao profissional (amarelo/vermelho). */
  readonly validationRequest: string | null;
  readonly norma: SemaforoNorma | null;
  readonly confidence: 'alta' | 'media' | 'baixa';
  readonly triggeredRule: string | null;
  readonly month: string;
}

export interface SemaforoResult {
  readonly month: string;
  readonly cards: readonly SemaforoCard[];
  readonly counts: Readonly<Record<SemaforoLevel, number>>;
  /** Um card por nivel, o mais importante de cada — para o hero do painel. */
  readonly hero: readonly SemaforoCard[];
}

const fmt = (n: number): string => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number): string => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

interface LineSnapshot {
  readonly rowIndex: number;
  readonly label: string;
  readonly key: EntryKey;
  readonly value: number;
  readonly previous: number | null;
}

function expenseLines(data: DreImport, mi: number): LineSnapshot[] {
  const out: LineSnapshot[] = [];
  for (const line of data.statement.lines) {
    if (line.key === null || line.isSubtotal || line.isGroupHeader) continue;
    const def = ACCOUNT_BY_KEY.get(line.key);
    if (def === undefined || def.kind === 'subtotal' || def.kind === 'revenue' || def.kind === 'financial_income') continue;
    const raw = line.values[mi];
    if (raw === null || raw === undefined || raw === 0) continue;
    const prevRaw = mi > 0 ? line.values[mi - 1] : null;
    out.push({
      rowIndex: line.rowIndex,
      label: line.rawLabel,
      key: line.key as EntryKey,
      value: Math.abs(raw),
      previous: prevRaw === null || prevRaw === undefined ? null : Math.abs(prevRaw),
    });
  }
  return out;
}

export function buildSemaforo(data: DreImport, month?: string): SemaforoResult {
  const months = data.statement.months;
  const ym = month !== undefined && months.includes(month) ? month : months[months.length - 1]!;
  const mi = months.indexOf(ym);
  const prevYm = mi > 0 ? months[mi - 1] : undefined;
  const c = data.statement.canonical[ym]!;
  const cp = prevYm === undefined ? undefined : data.statement.canonical[prevYm];
  const k = data.kpis[mi]!;
  const kp = mi > 0 ? data.kpis[mi - 1] : undefined;
  const mes = monthLabel(ym);
  const mesAnt = prevYm === undefined ? null : monthLabel(prevYm);
  const cards: SemaforoCard[] = [];
  const lines = expenseLines(data, mi);
  const fiscal = loadFiscalReference();

  const ev = (label: string, value: number, unit: SemaforoEvidence['unit'], refId: string, period?: string): SemaforoEvidence =>
    period === undefined ? { label, value, unit, refId } : { label, value, unit, refId, period };
  const lineRef = (l: LineSnapshot, m: string): string => `linha#${l.rowIndex}#${m}`;

  // =========================================================================
  // VERDE — o dono resolve sozinho
  // =========================================================================

  // V1. Despesa de decisao que mais cresceu (marketing, administrativas, outras, ocupacao)
  const decisionKeys: readonly EntryKey[] = ['despesas_marketing', 'despesas_administrativas', 'outras_despesas', 'despesas_ocupacao'];
  const grown = lines
    .filter((l) => decisionKeys.includes(l.key) && l.previous !== null && l.previous > 0 && l.value - l.previous >= 300 && (l.value - l.previous) / l.previous >= 0.15)
    .sort((a, b) => (b.value - (b.previous ?? 0)) - (a.value - (a.previous ?? 0)));
  grown.slice(0, 2).forEach((l, i) => {
    const delta = l.value - (l.previous ?? 0);
    const isMkt = l.key === 'despesas_marketing';
    cards.push({
      id: `verde-cresceu-${l.rowIndex}`,
      level: 'verde',
      priority: 10 + i,
      title: `${l.label} saltou em ${mes}`,
      problem: `A linha "${l.label}" foi de ${fmt(l.previous ?? 0)} em ${mesAnt ?? 'mes anterior'} para ${fmt(l.value)} em ${mes}. E gasto de decisao: voce controla sem depender de ninguem.`,
      evidence: [
        ev(`${l.label} — ${mes}`, l.value, 'BRL', lineRef(l, ym), mes),
        ...(prevYm !== undefined ? [ev(`${l.label} — ${mesAnt}`, l.previous ?? 0, 'BRL', lineRef(l, prevYm), mesAnt ?? undefined)] : []),
      ],
      who: 'voce',
      actions: isMkt
        ? [
            'Separe o que foi campanha pontual do que virou recorrente.',
            'Confira se a receita respondeu neste mes ou no seguinte antes de repetir o gasto.',
            'Defina um teto mensal de marketing ligado a uma meta de receita e corte por campanha, nao no atacado.',
          ]
        : [
            'Abra a linha e liste cada item: o que e contrato, o que e assinatura, o que foi avulso.',
            'Cancele o que nao foi usado nos ultimos meses e renegocie o maior contrato.',
            'Defina um teto mensal para essa linha e acompanhe no fechamento.',
          ],
      impact: { label: 'Aumento vs mes anterior', value: Math.round(delta * 100) / 100, refId: lineRef(l, ym) },
      validationRequest: null,
      norma: null,
      confidence: 'alta',
      triggeredRule: isMkt ? 'rule_marketing_dispara' : 'rule_despesas_crescem_acima_receita',
      month: ym,
    });
  });

  // V2. Margem bruta caindo — preco e insumo sao do dono
  if (k.margem_bruta_pct !== null && kp?.margem_bruta_pct != null && k.margem_bruta_pct < kp.margem_bruta_pct - 0.8 && cp !== undefined) {
    cards.push({
      id: 'verde-margem-bruta',
      level: 'verde',
      priority: 5,
      title: 'Margem bruta cedeu: preco nao acompanhou o custo',
      problem: `A margem bruta caiu de ${pct(kp.margem_bruta_pct)} para ${pct(k.margem_bruta_pct)}; o CMV foi de ${fmt(cp.cmv)} para ${fmt(c.cmv)}. Preco, fornecedor e mix sao decisoes suas.`,
      evidence: [
        ev(`Margem bruta — ${mes}`, k.margem_bruta_pct, '%', `kpi#kpi_margem_bruta#${ym}`, mes),
        ev(`Margem bruta — ${mesAnt}`, kp.margem_bruta_pct, '%', `kpi#kpi_margem_bruta#${prevYm}`, mesAnt ?? undefined),
        ev(`CMV — ${mes}`, c.cmv, 'BRL', `dre#cmv#${ym}`, mes),
      ],
      who: 'voce',
      actions: [
        'Reajuste o preco dos itens de maior volume para repor o aumento de custo.',
        'Cote os tres insumos de maior peso com fornecedores alternativos.',
        'Reduza descontos e promocoes que nao trazem volume adicional comprovado.',
      ],
      impact: { label: 'CMV do mes', value: Math.round(c.cmv * 100) / 100, refId: `dre#cmv#${ym}` },
      validationRequest: null,
      norma: null,
      confidence: 'alta',
      triggeredRule: 'rule_cmv_pressiona_margem',
      month: ym,
    });
  }

  // V3. Taxas de cartao / aplicativos / comissoes — negociaveis por volume
  const taxas = lines.filter((l) => l.key === 'despesas_comerciais' && /taxa|cartao|aplicativo|marketplace|comiss/i.test(l.label));
  if (taxas.length > 0) {
    const total = taxas.reduce((a, l) => a + l.value, 0);
    const top = [...taxas].sort((a, b) => b.value - a.value)[0]!;
    cards.push({
      id: 'verde-taxas',
      level: 'verde',
      priority: 20,
      title: 'Taxas de venda: renegociar por volume',
      problem: `Voce pagou ${fmt(total)} em taxas de cartao, aplicativos e comissoes em ${mes}. Sao custos variaveis negociaveis — cada ponto a menos baixa a meta minima de vendas.`,
      evidence: taxas.map((l) => ev(`${l.label} — ${mes}`, l.value, 'BRL', lineRef(l, ym), mes)),
      who: 'voce',
      actions: [
        'Peca a adquirente e ao aplicativo a tabela por faixa de volume e negocie com o faturamento em maos.',
        'Compare o custo por canal (balcao × delivery) e estimule o canal mais barato nos horarios cheios.',
        'Revise o repasse: taxa de aplicativo pode entrar no preco do canal.',
      ],
      impact: { label: 'Maior taxa do mes', value: top.value, refId: lineRef(top, ym) },
      validationRequest: null,
      norma: null,
      confidence: 'media',
      triggeredRule: null,
      month: ym,
    });
  }

  // =========================================================================
  // AMARELO — valida com contador ou gerente do banco
  // =========================================================================

  // A1. Impostos sobre vendas mudaram de proporcao vs receita bruta
  if (cp !== undefined && c.receita_bruta > 0 && cp.receita_bruta > 0 && c.deducoes > 0) {
    const r = (c.deducoes / c.receita_bruta) * 100;
    const rp = (cp.deducoes / cp.receita_bruta) * 100;
    if (Math.abs(r - rp) >= 0.5) {
      cards.push({
        id: 'amarelo-impostos-vendas',
        level: 'amarelo',
        priority: 5,
        title: 'Impostos sobre vendas mudaram de peso',
        problem: `As deducoes ficaram em ${pct(r)} da receita bruta em ${mes} contra ${pct(rp)} em ${mesAnt}. Faixa de aliquota, base de calculo ou classificacao podem ter mudado — isso quem confirma e o contador.`,
        evidence: [
          ev(`Deducoes e impostos sobre vendas — ${mes}`, c.deducoes, 'BRL', `dre#deducoes#${ym}`, mes),
          ev(`Receita bruta — ${mes}`, c.receita_bruta, 'BRL', `dre#receita_bruta#${ym}`, mes),
          ev(`Deducoes — ${mesAnt}`, cp.deducoes, 'BRL', `dre#deducoes#${prevYm}`, mesAnt ?? undefined),
        ],
        who: 'contador',
        actions: [
          'Nao mude nada na apuracao por conta propria.',
          'Envie ao contador o pedido de validacao abaixo com os dois meses.',
          'Pergunte se a receita acumulada esta perto de mudar de faixa ou de sublimite.',
        ],
        impact: { label: 'Deducoes do mes', value: Math.round(c.deducoes * 100) / 100, refId: `dre#deducoes#${ym}` },
        validationRequest:
          `Ola, [contador]. Na DRE de ${mes}, as deducoes e impostos sobre vendas somaram ${fmt(c.deducoes)} sobre receita bruta de ${fmt(c.receita_bruta)} (${pct(r)}), contra ${pct(rp)} em ${mesAnt}. ` +
          `Pode confirmar se houve mudanca de faixa, de base de calculo ou de classificacao de receita? Se a receita acumulada em 12 meses estiver perto de algum limite ou sublimite, me avise o que muda e quando.`,
        norma: { citada: 'Lei Complementar 123/2006 (Simples Nacional) — apuracao por faixa de receita bruta acumulada', vigencia: 'vigente; confirmar tabela do ano com o contador' },
        confidence: 'media',
        triggeredRule: null,
        month: ym,
      });
    }
  }

  // A2. Despesas financeiras subindo — gerente do banco
  if (cp !== undefined && c.despesas_financeiras > 0 && cp.despesas_financeiras > 0 && c.despesas_financeiras >= cp.despesas_financeiras * 1.15) {
    cards.push({
      id: 'amarelo-juros',
      level: 'amarelo',
      priority: 10,
      title: 'Juros crescendo: caixa financiado com dinheiro caro',
      problem: `As despesas financeiras foram de ${fmt(cp.despesas_financeiras)} para ${fmt(c.despesas_financeiras)}. Antes de trocar divida ou antecipar recebiveis, o gerente do banco precisa mostrar o custo efetivo de cada linha.`,
      evidence: [
        ev(`Despesas financeiras — ${mes}`, c.despesas_financeiras, 'BRL', `dre#despesas_financeiras#${ym}`, mes),
        ev(`Despesas financeiras — ${mesAnt}`, cp.despesas_financeiras, 'BRL', `dre#despesas_financeiras#${prevYm}`, mesAnt ?? undefined),
      ],
      who: 'gerente do banco',
      actions: [
        'Levante cada operacao que gerou juros (limite, antecipacao, emprestimo) e o custo efetivo de cada uma.',
        'Peca ao gerente uma proposta de troca da linha mais cara por uma mais barata com garantia.',
        'Antes de antecipar recebiveis, tente prazo com fornecedores.',
      ],
      impact: { label: 'Despesas financeiras do mes', value: Math.round(c.despesas_financeiras * 100) / 100, refId: `dre#despesas_financeiras#${ym}` },
      validationRequest:
        `Ola, [gerente]. Minhas despesas financeiras subiram de ${fmt(cp.despesas_financeiras)} em ${mesAnt} para ${fmt(c.despesas_financeiras)} em ${mes}. ` +
        `Preciso do custo efetivo total (CET) de cada linha que uso hoje e de uma proposta para trocar a mais cara por uma mais barata. Pode me enviar ate o fim da semana?`,
      norma: null,
      confidence: 'media',
      triggeredRule: 'rule_juros_pesam',
      month: ym,
    });
  }

  // A3. Reforma tributaria — campos CBS/IBS nas notas (referencia verificada)
  const cbs = fiscal.find((f) => f.id === 'cbs_teste_2026');
  const ibs = fiscal.find((f) => f.id === 'ibs_teste_2026');
  if (cbs !== undefined && ibs !== undefined && ym >= '2026-01' && ym <= '2026-12') {
    cards.push({
      id: 'amarelo-reforma-2026',
      level: 'amarelo',
      priority: 20,
      title: 'Reforma tributaria: suas notas ja destacam CBS e IBS?',
      problem: `2026 e o ano-teste da reforma: a CBS (${cbs.value.toLocaleString('pt-BR')}%) e o IBS (${ibs.value.toLocaleString('pt-BR')}%) precisam sair destacados nas notas, sem custo adicional. Quem confirma o preenchimento e o contador.`,
      evidence: [
        ev('Aliquota-teste CBS 2026', cbs.value, '%', `fiscal#${cbs.id}`),
        ev('Aliquota-teste IBS 2026', ibs.value, '%', `fiscal#${ibs.id}`),
      ],
      who: 'contador',
      actions: [
        'Pergunte ao contador se o emissor de notas ja preenche os campos de CBS e IBS.',
        'Confirme que o valor destacado esta sendo compensado com PIS/COFINS no mesmo periodo.',
        'Anote: a partir de 2027 a composicao da linha de impostos sobre vendas muda.',
      ],
      impact: null,
      validationRequest:
        `Ola, [contador]. Estamos em ${mes}, ano-teste da reforma tributaria do consumo. Pode confirmar que as nossas notas ja saem com CBS (${cbs.value.toLocaleString('pt-BR')}%) e IBS (${ibs.value.toLocaleString('pt-BR')}%) destacados e que o valor esta sendo compensado com PIS/COFINS? Se faltar algo no emissor, me diga o que precisa mudar.`,
      norma: { citada: 'Reforma Tributaria do Consumo — Receita Federal (ano-teste 2026)', vigencia: cbs.vigencia, fonte_url: cbs.source_url },
      confidence: 'alta',
      triggeredRule: null,
      month: ym,
    });
  }

  // A4. Pro-labore fixo — proporcao com o contador
  const prolabore = lines.find((l) => /pro.?labore/i.test(l.label));
  if (prolabore !== undefined && k.resultado_liquido < 0) {
    cards.push({
      id: 'amarelo-prolabore',
      level: 'amarelo',
      priority: 30,
      title: 'Pro-labore com o mes no vermelho',
      problem: `O pro-labore foi de ${fmt(prolabore.value)} num mes com resultado de ${fmt(k.resultado_liquido)}. A proporcao entre pro-labore e distribuicao de lucros tem efeito tributario — ajuste so com o contador.`,
      evidence: [
        ev(`${prolabore.label} — ${mes}`, prolabore.value, 'BRL', lineRef(prolabore, ym), mes),
        ev(`Resultado liquido — ${mes}`, k.resultado_liquido, 'BRL', `kpi#kpi_resultado_liquido#${ym}`, mes),
      ],
      who: 'contador',
      actions: [
        'Nao reduza nem zere o pro-labore por conta propria: ha minimo legal e efeito na previdencia.',
        'Peca ao contador a simulacao do valor adequado para o momento da empresa.',
      ],
      impact: { label: 'Pro-labore do mes', value: prolabore.value, refId: lineRef(prolabore, ym) },
      validationRequest:
        `Ola, [contador]. O mes de ${mes} fechou com resultado de ${fmt(k.resultado_liquido)} e pro-labore de ${fmt(prolabore.value)}. Qual e o valor minimo e o mais adequado de pro-labore para o meu caso agora, e o que muda em INSS e imposto se eu ajustar?`,
      norma: { citada: 'Regras de pro-labore e distribuicao de lucros (Lei 8.212/1991 e legislacao do regime tributario da empresa)', vigencia: 'vigente; confirmar com o contador' },
      confidence: 'media',
      triggeredRule: null,
      month: ym,
    });
  }

  // A5. Linhas nao classificadas — contador valida a classificacao
  if (data.statement.summary.linesUnmapped > 0) {
    cards.push({
      id: 'amarelo-nao-classificadas',
      level: 'amarelo',
      priority: 40,
      title: `${data.statement.summary.linesUnmapped} linha(s) da DRE fora dos totais`,
      problem: `Nao reconheci: ${data.statement.summary.unmappedLabels.slice(0, 5).join('; ')}. Ficaram fora dos KPIs. A classificacao contabil e do contador.`,
      evidence: [ev('Linhas nao classificadas', data.statement.summary.linesUnmapped, 'meses', `kpi#linhas_nao_classificadas#${ym}`)],
      who: 'contador',
      actions: ['Envie a lista ao contador e pergunte em que grupo cada linha entra.', 'Reenvie a DRE com os nomes padronizados.'],
      impact: null,
      validationRequest: `Ola, [contador]. Na DRE que estou analisando ha linhas que nao sei classificar: ${data.statement.summary.unmappedLabels.join('; ')}. Em que grupo cada uma entra (receita, deducao, custo, despesa administrativa, comercial, financeira)?`,
      norma: null,
      confidence: 'alta',
      triggeredRule: null,
      month: ym,
    });
  }

  // =========================================================================
  // VERMELHO — nunca sem parecer profissional
  // =========================================================================

  // R1. Regime tributario — receita bruta acumulada 12 meses
  const last12 = months.slice(Math.max(0, mi - 11), mi + 1);
  const receita12 = last12.reduce((a, m) => a + (data.statement.canonical[m]?.receita_bruta ?? 0), 0);
  if (last12.length >= 6 && receita12 > 0) {
    cards.push({
      id: 'vermelho-regime',
      level: 'vermelho',
      priority: 5,
      title: 'Regime tributario: compare a receita acumulada com os limites',
      problem: `Sua receita bruta acumulada nos ultimos ${last12.length} meses e ${fmt(receita12)}. Mudar de regime (Simples, Presumido, Real) ou de faixa tem efeito no ano inteiro e pode ser retroativo — nunca decida sem parecer.`,
      evidence: [
        ev(`Receita bruta acumulada — ${last12.length} meses`, Math.round(receita12 * 100) / 100, 'BRL', `kpi#kpi_receita_bruta_12m#${ym}`),
        ev(`Deducoes e impostos sobre vendas — ${mes}`, c.deducoes, 'BRL', `dre#deducoes#${ym}`, mes),
      ],
      who: 'contador ou consultor tributario',
      actions: [
        'Nao altere regime, CNAE ou enquadramento por conta propria.',
        'Peca um parecer comparando o custo tributario dos regimes possiveis com a sua receita acumulada.',
        'Se houver limite ou sublimite proximo, pergunte a data e o efeito na apuracao.',
      ],
      impact: { label: 'Receita bruta acumulada', value: Math.round(receita12 * 100) / 100, refId: `kpi#kpi_receita_bruta_12m#${ym}` },
      validationRequest:
        `Ola, [contador]. Minha receita bruta acumulada nos ultimos ${last12.length} meses e ${fmt(receita12)}. Preciso de um parecer: estou no regime mais vantajoso? Existe limite, sublimite ou faixa que eu esteja perto de ultrapassar, e o que muda (e a partir de quando) se ultrapassar?`,
      norma: { citada: 'Lei Complementar 123/2006 (Simples Nacional) e Lei 9.718/1998 (Lucro Presumido) — limites de receita bruta', vigencia: 'vigente; valores dos limites confirmados pelo contador' },
      confidence: 'media',
      triggeredRule: null,
      month: ym,
    });
  }

  // R2. Prejuizo recorrente — reestruturacao e obrigacoes
  const negMonths = months.slice(0, mi + 1).filter((m) => (data.statement.canonical[m]?.resultado_liquido ?? 0) < 0);
  const lastTwoNeg = mi >= 1 && (data.statement.canonical[ym]?.resultado_liquido ?? 0) < 0 && (data.statement.canonical[months[mi - 1]!]?.resultado_liquido ?? 0) < 0;
  if (lastTwoNeg || negMonths.length >= 3) {
    const prejuizo = negMonths.reduce((a, m) => a + (data.statement.canonical[m]?.resultado_liquido ?? 0), 0);
    cards.push({
      id: 'vermelho-prejuizo',
      level: 'vermelho',
      priority: 10,
      title: `Prejuizo em ${negMonths.length} mes(es): reestruturacao pede parecer`,
      problem: `Somando os meses negativos do periodo, o prejuizo acumulado e ${fmt(prejuizo)}. Distribuicao de lucros, compensacao de prejuizo e renegociacao de dividas tem regra propria e efeito retroativo.`,
      evidence: [
        ev('Prejuizo acumulado (meses negativos)', Math.round(prejuizo * 100) / 100, 'BRL', `kpi#kpi_prejuizo_acumulado#${ym}`),
        ev(`Resultado liquido — ${mes}`, k.resultado_liquido, 'BRL', `kpi#kpi_resultado_liquido#${ym}`, mes),
        ev('Meses com prejuizo', negMonths.length, 'meses', `kpi#kpi_meses_negativos#${ym}`),
      ],
      who: 'contador ou consultor tributario',
      actions: [
        'Nao distribua lucros nem retire alem do pro-labore enquanto o acumulado for negativo sem parecer.',
        'Peca ao contador o tratamento do prejuizo na apuracao e o que e permitido retirar.',
        'Leve o plano de cortes (cards verdes) e a renegociacao de juros (card amarelo) para a mesma conversa.',
      ],
      impact: { label: 'Prejuizo acumulado', value: Math.round(prejuizo * 100) / 100, refId: `kpi#kpi_prejuizo_acumulado#${ym}` },
      validationRequest:
        `Ola, [contador]. A empresa fechou ${negMonths.length} mes(es) no vermelho, prejuizo acumulado de ${fmt(prejuizo)}; ${mes} fechou em ${fmt(k.resultado_liquido)}. O que posso e o que nao posso retirar agora? Como esse prejuizo entra na apuracao e ha algo retroativo a corrigir?`,
      norma: { citada: 'Apuracao de resultado e distribuicao de lucros conforme o regime tributario da empresa', vigencia: 'vigente; confirmar com o contador' },
      confidence: 'media',
      triggeredRule: 'rule_resultado_negativo',
      month: ym,
    });
  }

  // R3. Impostos sobre vendas com variacao forte entre meses — possivel erro retroativo
  const ratios = months.slice(0, mi + 1).map((m) => {
    const cm = data.statement.canonical[m];
    return cm !== undefined && cm.receita_bruta > 0 ? (cm.deducoes / cm.receita_bruta) * 100 : null;
  }).filter((r): r is number => r !== null);
  if (ratios.length >= 4) {
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    if (max - min >= 2) {
      cards.push({
        id: 'vermelho-apuracao-retroativa',
        level: 'vermelho',
        priority: 20,
        title: 'Impostos sobre vendas oscilam demais entre meses',
        problem: `A proporcao de deducoes sobre a receita bruta variou de ${pct(min)} a ${pct(max)} no periodo. Se houve erro de apuracao, a correcao e retroativa — so com parecer.`,
        evidence: [
          ev('Menor proporcao de deducoes no periodo', Math.round(min * 100) / 100, '%', `kpi#kpi_deducoes_ratio_min#${ym}`),
          ev('Maior proporcao de deducoes no periodo', Math.round(max * 100) / 100, '%', `kpi#kpi_deducoes_ratio_max#${ym}`),
        ],
        who: 'contador ou consultor tributario',
        actions: ['Nao retifique nada por conta propria.', 'Peca a revisao das apuracoes do periodo e, se houver erro, o plano de retificacao.'],
        impact: null,
        validationRequest:
          `Ola, [contador]. Olhando a DRE, a proporcao de impostos sobre vendas variou de ${pct(min)} a ${pct(max)} da receita bruta entre os meses. Isso e esperado pelo meu regime ou pode haver erro de apuracao? Se houver, o que precisa ser retificado e ha multa?`,
        norma: { citada: 'Apuracao mensal conforme o regime tributario; retificacao de declaracoes', vigencia: 'vigente; confirmar com o contador' },
        confidence: 'baixa',
        triggeredRule: null,
        month: ym,
      });
    }
  }

  const order: Record<SemaforoLevel, number> = { vermelho: 0, amarelo: 1, verde: 2 };
  cards.sort((a, b) => order[a.level] - order[b.level] || a.priority - b.priority);
  const counts: Record<SemaforoLevel, number> = { verde: 0, amarelo: 0, vermelho: 0 };
  for (const cd of cards) counts[cd.level] += 1;
  const hero = (['vermelho', 'amarelo', 'verde'] as const)
    .map((lvl) => cards.find((cd) => cd.level === lvl))
    .filter((cd): cd is SemaforoCard => cd !== undefined);
  return { month: ym, cards, counts, hero };
}
