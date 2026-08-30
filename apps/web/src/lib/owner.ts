/**
 * Dados do dono da conta e a saudacao diaria do painel.
 *
 * A frase do dia e escolhida de forma DETERMINISTICA pela data: a mesma pessoa
 * ve a mesma frase o dia inteiro, e ela muda sozinha no dia seguinte.
 *
 * As frases nunca prometem resultado ("voce vai lucrar", "vai dar certo") —
 * falam de metodo e decisao, que e o que o produto entrega. O conjunto muda
 * conforme o mes fechou no azul ou no vermelho: em mes apertado, animar sem
 * reconhecer o aperto soa falso.
 */

export const OWNER_NAME = 'João';

const FRASES_APERTO: readonly string[] = [
  'Mes dificil nao se resolve no susto: escolhe-se uma alavanca por vez.',
  'O numero ruim ja aconteceu. O que ainda da para mudar e o do mes que vem.',
  'Cortar bem e diferente de cortar muito — comece pelo que nao vende por voce.',
  'Quem enxerga o buraco cedo tem tempo de escolher como sair dele.',
  'Margem se recupera no preco e no fornecedor, nao na esperanca.',
  'Um mes no vermelho e um aviso, nao uma sentenca.',
  'A estrutura precisa caber no faturamento de hoje, nao no de um ano bom.',
  'Decisao adiada em mes apertado costuma custar caro no seguinte.',
];

const FRASES_AZUL: readonly string[] = [
  'Mes bom e a melhor hora de arrumar a casa — pressao baixa, decisao melhor.',
  'Lucro que aparece uma vez e sorte; o que se repete e metodo.',
  'Crescer sem olhar a margem e correr mais rapido para o lugar errado.',
  'O que voce mede toda semana e o que voce consegue melhorar.',
  'Guardar parte do mes bom e o que sustenta o mes ruim.',
  'Cada real que sobra e uma decisao que voce tomou — repita as que funcionaram.',
  'Manter a disciplina no mes bom e o que separa a boa fase do bom negocio.',
];

const DIAS = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function saudacao(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function dataPorExtenso(now: Date = new Date()): string {
  return `${DIAS[now.getDay()]}, ${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}`;
}

/** Indice estavel dentro do dia: muda a cada virada de data local. */
function indiceDoDia(now: Date): number {
  const inicioDoAno = Date.UTC(now.getFullYear(), 0, 1);
  const hoje = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((hoje - inicioDoAno) / 86_400_000);
}

export function fraseDoDia(mesNoVermelho: boolean, now: Date = new Date()): string {
  const lista = mesNoVermelho ? FRASES_APERTO : FRASES_AZUL;
  return lista[indiceDoDia(now) % lista.length] ?? lista[0]!;
}
