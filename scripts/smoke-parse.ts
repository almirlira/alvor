// Smoke: le uma DRE do disco e imprime o resumo. Uso: pnpm tsx scripts/smoke-parse.ts <arquivo>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readDreFromBuffer } from '../packages/ingest/src/index.js';

const file = process.argv[2] ?? 'samples/dre_exemplo_12m.xlsx';
const result = await readDreFromBuffer(readFileSync(file), { fileName: basename(file) });
const { statement, kpis } = result;
console.log('aba:', statement.sheetName, '| meses:', statement.months.join(', '));
console.log('resumo:', JSON.stringify(statement.summary));
console.log('warnings:', statement.warnings);
console.log('reconciliation:', statement.reconciliation.slice(0, 6));
console.log('\nlinhas:');
for (const l of statement.lines) {
  const flag = l.isSubtotal ? 'SUB' : l.isGroupHeader ? 'GRP' : '   ';
  console.log(`  ${flag} ${String(l.key ?? '—').padEnd(26)} ${l.confidence.toFixed(1)} ${l.rawLabel}${l.inheritedFrom ? ' (herdado de ' + l.inheritedFrom + ')' : ''}`);
}
console.log('\nKPIs do ultimo mes:');
const last = kpis[kpis.length - 1]!;
const { top_despesas, participacao_despesas, ...rest } = last;
console.log(rest);
console.log('top despesas:', top_despesas.slice(0, 5));
