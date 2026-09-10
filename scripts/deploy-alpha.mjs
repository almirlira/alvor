import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { syncAlphaNames } from './sync-alpha-names.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const participantNames = syncAlphaNames();
const target = 'root@204.168.173.123';
const release = `alpha-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const run = (name, args, options = {}) => execFileSync(name, args, { encoding: 'utf8', ...options });
const remote = (config) => {
  const output = run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, 'node /opt/alvor-alpha/incoming/deploy.mjs'], {
    input: JSON.stringify(config), maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(output.trim().split('\n').at(-1));
};
const fingerprint = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  return { status: response.status, hash: createHash('sha256').update(await response.text()).digest('hex') };
};
const existing = ['https://brainora.ai/', 'https://voko.brainora.ai/', 'https://staging.voko.brainora.ai/v2-validacao/'];
const before = await Promise.all(existing.map(fingerprint));
fs.mkdirSync('private', { recursive: true, mode: 0o700 });
console.log('Validando e compilando ALVOR...');
run('pnpm', ['typecheck'], { stdio: 'inherit' });
run('pnpm', ['--filter', '@dre/web', 'build', '--base=/alvor/'], {
  env: { ...process.env, VITE_ALPHA_INVITE_AUTH: 'on', VITE_API_BASE_URL: '' }, stdio: 'inherit',
});
const files = run('git', ['ls-files', '-z']).split('\0').filter((path) =>
  /^(apps\/api\/|packages\/|pnpm-|package.json$|tsconfig|samples\/dre_exemplo_12m.xlsx$)/.test(path));
files.push('apps/web/dist', 'apps/web/package.json', 'scripts/deploy-alpha-remote.mjs');
const archive = `${root}/private/${release}.tgz`;
run('tar', ['--no-xattrs', '-czf', archive, ...files], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
fs.chmodSync(archive, 0o600);
const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
run('ssh', ['-o', 'BatchMode=yes', target, 'install -d -m 700 /opt/alvor-alpha/incoming']);
run('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', archive, `${target}:/opt/alvor-alpha/incoming/${release}.tgz`]);
run('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'scripts/deploy-alpha-remote.mjs', `${target}:/opt/alvor-alpha/incoming/deploy.mjs`]);
console.log('Preparando dependências na VPS...');
const prepared = remote({ stage: 'prepare', release, sha256 });
let stoppedLocal = false;
try {
  const config = { stage: 'activate', release, participantNames };
  if (prepared.firstDeploy) {
    const invites = fs.readFileSync('private/alpha-invites.env', 'utf8').split('\n').find((line) => line.startsWith('ALPHA_INVITES='));
    if (!invites) throw new Error('Convites não encontrados');
    console.log('Transferindo os dados e convites existentes...');
    run('pm2', ['stop', 'alvor-api'], { stdio: 'ignore' });
    stoppedLocal = true;
    config.invites = invites;
    config.initialData = Object.fromEntries(fs.readdirSync('data').filter((name) => /^invite-P\d+-[a-z-]+\.json$/.test(name))
      .map((name) => [name, JSON.parse(fs.readFileSync(`data/${name}`, 'utf8'))]));
  }
  const deployed = remote(config);
  const response = await fetch('https://brainora.ai/alvor/api/health');
  if (!response.ok || (await response.json()).app !== 'ALVOR') throw new Error('Health público falhou');
  const after = await Promise.all(existing.map(fingerprint));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Resposta de um endereço existente mudou; conferir');
  const result = { ...deployed, sha256, checkedAt: new Date().toISOString(), existingSitesUnchanged: true };
  fs.writeFileSync('private/deployment-alpha.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (stoppedLocal) run('pm2', ['start', 'alvor-api'], { stdio: 'ignore' });
  // Não imprime stdin, convites ou dados mesmo se SSH falhar.
  console.error('Publicação incompleta:', error.status ? `processo terminou com status ${error.status}; consulte os logs do serviço na VPS` : error.message);
  process.exitCode = 1;
}
