import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Invocado por SSH; segredos e dados chegam somente pelo stdin.
const config = JSON.parse(fs.readFileSync(0, 'utf8'));
const root = '/opt/alvor-alpha';
const dataDir = '/var/lib/alvor-alpha';
const envFile = '/etc/alvor-alpha.env';
const service = 'alvor-alpha';
if (!/^alpha-\d{14}$/.test(config.release)) throw new Error('Release inválida');
const releaseDir = `${root}/releases/${config.release}`;
const run = (name, args, options = {}) => execFileSync(name, args, { encoding: 'utf8', ...options });

if (config.stage === 'prepare') {
  const archive = `${root}/incoming/${config.release}.tgz`;
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (digest !== config.sha256) throw new Error('Checksum divergente');
  fs.mkdirSync(releaseDir, { recursive: true, mode: 0o755 });
  run('tar', ['-xzf', archive, '-C', releaseDir]);
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: releaseDir, stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(JSON.stringify({ firstDeploy: !fs.existsSync(envFile) }));
  process.exit(0);
}
if (config.stage !== 'activate') throw new Error('Etapa inválida');
try { run('id', ['alvor-alpha'], { stdio: 'ignore' }); }
catch { run('useradd', ['--system', '--home-dir', root, '--shell', '/usr/sbin/nologin', 'alvor-alpha']); }
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (!fs.existsSync(envFile)) {
  if (!config.invites?.startsWith('ALPHA_INVITES=')) throw new Error('Convites obrigatórios');
  for (const [name, value] of Object.entries(config.initialData ?? {})) {
    if (!/^invite-P\d+-[a-z-]+\.json$/.test(name)) throw new Error('Nome de dados inválido');
    fs.writeFileSync(`${dataDir}/${name}`, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  }
  fs.writeFileSync(envFile, `${config.invites}\nNODE_ENV=production\nAPI_HOST=127.0.0.1\nAPI_PORT=3900\nALVOR_DATA_DIR=${dataDir}\nAPP_ORIGIN=https://brainora.ai\nLLM_PROVIDER=mock\n`, { mode: 0o600 });
}
run('chown', ['-R', 'alvor-alpha:alvor-alpha', dataDir]);
// Atualiza apenas nomes. Códigos, identificadores e dados remotos são preservados.
if (config.participantNames) {
  const env = fs.readFileSync(envFile, 'utf8');
  const updated = env.replace(/^ALPHA_INVITES=['"]?(.*?)['"]?$/m, (_line, value) => {
    const entries = value.split(',').map((entry) => {
      const [id, oldName, token] = entry.split('|');
      const name = config.participantNames[id] ?? oldName;
      if (!id || !token || !name || /[|,\r\n'"`$\\]/.test(name)) throw new Error('Convite inválido');
      return `${id}|${name}|${token}`;
    });
    return `ALPHA_INVITES='${entries.join(',')}'`;
  });
  fs.writeFileSync(envFile, updated, { mode: 0o600 });
}
const unit = `[Unit]
Description=ALVOR alpha dos fundadores
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=alvor-alpha
Group=alvor-alpha
WorkingDirectory=${root}/current
ExecStart=/usr/bin/node --import tsx apps/api/src/server.ts
EnvironmentFile=${envFile}
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=${dataDir}
MemoryMax=512M
CPUQuota=50%
[Install]
WantedBy=multi-user.target
`;
fs.writeFileSync(`/etc/systemd/system/${service}.service`, unit);
const current = `${root}/current`;
const previous = fs.existsSync(current) ? fs.readlinkSync(current) : null;
const pointTo = (path) => {
  fs.symlinkSync(path, `${root}/next-${config.release}`);
  fs.renameSync(`${root}/next-${config.release}`, current);
};
pointTo(releaseDir);
run('systemctl', ['daemon-reload']);
run('systemctl', ['enable', service]);
run('systemctl', ['restart', service]);
let healthy = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:3900/health');
    healthy = response.ok && (await response.json()).app === 'ALVOR';
    if (healthy) break;
  } catch { /* processo iniciando */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!healthy) {
  if (previous) { pointTo(previous); run('systemctl', ['restart', service]); }
  else run('systemctl', ['stop', service]);
  throw new Error('API não ficou saudável; publicação interrompida');
}
const caddy = '/etc/caddy/Caddyfile';
const old = fs.readFileSync(caddy, 'utf8');
const marker = '# ALVOR-ALPHA';
if (!old.includes(marker)) {
  // Confere arquivo x configuração viva antes de alterar o proxy compartilhado.
  const adapted = JSON.parse(run('caddy', ['adapt', '--config', caddy, '--adapter', 'caddyfile']));
  // A API administrativa rejeita o Sec-Fetch-Mode enviado pelo fetch do Node.
  const live = JSON.parse(run('curl', ['--fail', '--silent', 'http://127.0.0.1:2019/config/']));
  const canonical = (value) => JSON.stringify(value, function (_key, item) {
    return item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
  });
  if (canonical(adapted) !== canonical(live)) throw new Error('Caddy possui alterações pendentes; investigar antes de aplicar');
  const start = old.indexOf('\nbrainora.ai {');
  if (start < 0) throw new Error('Domínio brainora.ai não encontrado');
  const point = old.indexOf('\n', start + 1);
  const route = `
      ${marker}
      redir /alvor /alvor/ 308
      handle_path /alvor/api/* {
              header Cache-Control "no-store"
              reverse_proxy 127.0.0.1:3900
      }
      handle_path /alvor/* {
              header {
                      Cache-Control "no-cache"
                      X-Content-Type-Options nosniff
                      X-Frame-Options DENY
                      Referrer-Policy no-referrer
                      X-Robots-Tag "noindex, nofollow"
              }
              root * ${root}/current/apps/web/dist
              route {
                      @private path /.env* /.git* /src/* /data/* /private/* /packages/* /node_modules/* /apps/*
                      respond @private 404
                      try_files {path} /index.html
                      file_server
              }
      }
`;
  fs.mkdirSync(`${root}/backups`, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${root}/backups/Caddyfile-${config.release}`, old, { mode: 0o600 });
  const candidate = '/etc/caddy/Caddyfile-alvor-next';
  fs.writeFileSync(candidate, old.slice(0, point) + route + old.slice(point), { mode: 0o644 });
  run('caddy', ['validate', '--config', candidate, '--adapter', 'caddyfile']);
  if (fs.readFileSync(caddy, 'utf8') !== old) throw new Error('Proxy alterado por outra operação; repetir a publicação');
  fs.renameSync(candidate, caddy);
  try { run('caddy', ['reload', '--config', caddy, '--adapter', 'caddyfile']); }
  catch (error) {
    fs.writeFileSync(caddy, old);
    run('caddy', ['reload', '--config', caddy, '--adapter', 'caddyfile']);
    throw error;
  }
}
console.log(JSON.stringify({ release: config.release, previous, service: run('systemctl', ['is-active', service]).trim(), url: 'https://brainora.ai/alvor/' }));
