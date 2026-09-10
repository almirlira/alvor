import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function syncAlphaNames() {
  const documentPath = 'private/convites-alpha.md';
  const envPath = 'private/alpha-invites.env';
  const document = fs.readFileSync(documentPath, 'utf8');
  const env = fs.readFileSync(envPath, 'utf8');
  const names = Object.fromEntries([...document.matchAll(/^- (P\d+) — (.+?):\s*`[^`]+`/gm)]
    .map(([, id, name]) => [id, name.replace(/ \(organizador\)$/, '').trim()]));
  if (Object.keys(names).length === 0) throw new Error('Nenhum fundador encontrado no documento');
  for (const name of Object.values(names)) {
    if (!name || /[|,\r\n'"`$\\]/.test(name)) throw new Error('Nome contém separador ou caractere incompatível com os convites');
  }
  const line = env.split('\n').find((item) => item.startsWith('ALPHA_INVITES='));
  if (!line) throw new Error('Configuração dos convites não encontrada');
  const value = line.slice('ALPHA_INVITES='.length).replace(/^['"]|['"]$/g, '');
  const entries = value.split(',').map((entry) => {
    const [id, , token] = entry.split('|');
    if (!id || !token || !names[id]) throw new Error('Documento e configuração têm participantes diferentes');
    return `${id}|${names[id]}|${token}`;
  });
  if (entries.length !== Object.keys(names).length) throw new Error('Participante sem convite; gere um acesso antes de sincronizar');
  const updatedLine = `ALPHA_INVITES='${entries.join(',')}'`;
  fs.writeFileSync(envPath, env.replace(line, updatedLine), { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  fs.writeFileSync(documentPath, document.replace(/^ALPHA_INVITES=.*$/m, updatedLine), { mode: 0o600 });
  fs.chmodSync(documentPath, 0o600);
  return names;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(syncAlphaNames(), null, 2));
}
