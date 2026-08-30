// Gera samples/dre_exemplo_12m.xlsx — DRE ficticia de uma PME (restaurante/varejo),
// set/2025 a ago/2026, com padroes que disparam regras: receita sobe e margem cai
// (CMV crescendo), marketing dispara em 2 meses, resultado negativo em 2 meses,
// despesa de pessoal crescendo acima da receita no fim do periodo.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.cwd(), 'packages/ingest/package.json'));
const XLSX = require('xlsx');

const months = ['set/25', 'out/25', 'nov/25', 'dez/25', 'jan/26', 'fev/26', 'mar/26', 'abr/26', 'mai/26', 'jun/26', 'jul/26', 'ago/26'];

const receita = [182000, 188500, 195200, 231400, 176300, 171900, 189700, 198400, 206900, 214800, 221300, 236500];
const pct = (arr, p) => arr.map((v) => Math.round(v * p));
const cmvPct = [0.36, 0.36, 0.37, 0.37, 0.38, 0.39, 0.40, 0.41, 0.42, 0.43, 0.44, 0.45]; // margem bruta caindo
const rows = [
  ['DRE — Sabor & Cia Alimentacao Ltda', ...months.map(() => '')],
  ['Conta', ...months],
  ['Receita Bruta de Vendas', ...receita],
  ['   Vendas no balcao', ...pct(receita, 0.58)],
  ['   Vendas delivery', ...receita.map((v, i) => v - Math.round(v * 0.58))],
  ['(-) Deducoes da Receita', ...pct(receita, 0.062)],
  ['   Simples Nacional', ...pct(receita, 0.052)],
  ['   Cancelamentos e devolucoes', ...pct(receita, 0.01)],
  ['(=) Receita Liquida', ...receita.map((v) => v - Math.round(v * 0.062))],
  ['(-) CMV — Custo das Mercadorias Vendidas', ...receita.map((v, i) => Math.round(v * cmvPct[i]))],
  ['(=) Lucro Bruto', ...receita.map((v, i) => v - Math.round(v * 0.062) - Math.round(v * cmvPct[i]))],
  ['Despesas com Pessoal', ...[52000, 52000, 52400, 61800, 53100, 53100, 53500, 54200, 56900, 58700, 60300, 63900]],
  ['   Salarios e encargos', ...[41000, 41000, 41300, 49600, 41900, 41900, 42200, 42800, 45000, 46400, 47700, 50600]],
  ['   Pro-labore', ...[8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000]],
  ['   Beneficios (VT/VR)', ...[3000, 3000, 3100, 4200, 3200, 3200, 3300, 3400, 3900, 4300, 4600, 5300]],
  ['Ocupacao', ...[14200, 14200, 14200, 14900, 15100, 15100, 15100, 15100, 15300, 15300, 15300, 16400]],
  ['   Aluguel e condominio', ...[9500, 9500, 9500, 9500, 9900, 9900, 9900, 9900, 9900, 9900, 9900, 10900]],
  ['   Energia eletrica', ...[3600, 3600, 3600, 4200, 4000, 4000, 4000, 4000, 4200, 4200, 4200, 4300]],
  ['   Agua e gas', ...[1100, 1100, 1100, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200]],
  ['Despesas Administrativas', ...[7800, 7900, 7900, 8100, 8400, 8400, 8600, 8600, 8900, 9100, 9100, 9600]],
  ['   Contabilidade', ...[1800, 1800, 1800, 1800, 1900, 1900, 1900, 1900, 1900, 1900, 1900, 2100]],
  ['   Sistemas e assinaturas', ...[2100, 2200, 2200, 2300, 2500, 2500, 2700, 2700, 2900, 3100, 3100, 3400]],
  ['   Manutencao e limpeza', ...[2400, 2400, 2400, 2500, 2500, 2500, 2500, 2500, 2600, 2600, 2600, 2600]],
  ['   Telefone e internet', ...[1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500]],
  ['Despesas Comerciais', ...receita.map((v) => Math.round(v * 0.071))],
  ['   Taxas de cartao', ...receita.map((v) => Math.round(v * 0.031))],
  ['   Taxas de aplicativos de entrega', ...receita.map((v) => Math.round(v * 0.04))],
  ['Marketing', ...[4200, 4200, 4500, 9800, 3900, 3900, 4100, 4300, 12600, 4400, 4600, 14200]],
  ['Outras Despesas', ...[1900, 2100, 1800, 2600, 2000, 2200, 1900, 2100, 2300, 2000, 2400, 2500]],
  ['(=) Total de Despesas Operacionais', ...months.map(() => null)],
  ['(=) Resultado Operacional', ...months.map(() => null)],
  ['Receitas Financeiras', ...[350, 380, 360, 400, 300, 280, 310, 330, 340, 360, 370, 390]],
  ['Despesas Financeiras', ...[2100, 2100, 2300, 2600, 3900, 4100, 3800, 3600, 3400, 3300, 3200, 3100]],
  ['(=) Resultado Liquido', ...months.map(() => null)],
];

// Preenche subtotais reais (linhas marcadas com null)
const idx = (label) => rows.findIndex((r) => r[0] === label);
const num = (label, i) => Number(rows[idx(label)][i + 1]) || 0;
for (let i = 0; i < months.length; i++) {
  const despesas =
    num('Despesas com Pessoal', i) + num('Ocupacao', i) + num('Despesas Administrativas', i) +
    num('Despesas Comerciais', i) + num('Marketing', i) + num('Outras Despesas', i);
  rows[idx('(=) Total de Despesas Operacionais')][i + 1] = despesas;
  const lucroBruto = num('(=) Lucro Bruto', i);
  const resOp = lucroBruto - despesas;
  rows[idx('(=) Resultado Operacional')][i + 1] = resOp;
  rows[idx('(=) Resultado Liquido')][i + 1] = resOp + num('Receitas Financeiras', i) - num('Despesas Financeiras', i);
}

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 42 }, ...months.map(() => ({ wch: 12 }))];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'DRE 2025-2026');
mkdirSync('samples', { recursive: true });
XLSX.writeFile(wb, 'samples/dre_exemplo_12m.xlsx');
console.log('gerado samples/dre_exemplo_12m.xlsx');
console.log('resultado liquido por mes:', rows[idx('(=) Resultado Liquido')].slice(1).join(', '));
