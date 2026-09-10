import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const numericCount = Number(args[0] ?? 5);
const founderNames = args.length > 0 && !Number.isInteger(numericCount) ? args : [];
const count = founderNames.length > 0 ? founderNames.length : numericCount;

if (!Number.isInteger(count) || count < 1 || count > 20) {
  console.error('Uso: node scripts/make-alpha-invites.mjs 5');
  console.error('Ou:  node scripts/make-alpha-invites.mjs "Almir Lira" "Nome 2" "Nome 3"');
  process.exit(1);
}

mkdirSync('private', { recursive: true });

const entries = [
  { participant: 'P00', name: 'Organizador', token: randomBytes(18).toString('base64url'), organizer: true },
  ...Array.from({ length: count }, (_, index) => {
  const participant = `P${String(index + 1).padStart(2, '0')}`;
  const name = founderNames[index] ?? `Fundador ${index + 1}`;
  const token = randomBytes(18).toString('base64url');
  return { participant, name, token, organizer: false };
})];

const envValue = entries.map((entry) => `${entry.participant}|${entry.name}|${entry.token}`).join(',');
const envLine = `ALPHA_INVITES='${envValue}'`;
const md = [
  '# Convites alpha — ALVOR',
  '',
  'Um codigo por fundador. Nao publique este arquivo.',
  '',
  ...entries.map((entry) => `- ${entry.participant} — ${entry.name}${entry.organizer ? ' (organizador)' : ''}: \`${entry.token}\``),
  '',
  'Variavel para a API:',
  '',
  '```sh',
  envLine,
  '```',
  '',
].join('\n');

writeFileSync(join('private', 'convites-alpha.md'), md, 'utf-8');
writeFileSync(join('private', 'alpha-invites.env'), `${envLine}\n`, 'utf-8');
console.log(`Convites gerados em private/convites-alpha.md e private/alpha-invites.env`);
