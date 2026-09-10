import { createServer } from 'node:http';

// Mantém o link temporário anterior útil durante a troca para a VPS.
const aliases = { '/alpha': '/gestao', '/observacoes': '/relatos' };
createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(410, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message: 'O ALVOR mudou de endereço. Recarregue a página para continuar.' }));
    return;
  }
  response.writeHead(302, {
    Location: `https://brainora.ai/alvor${aliases[path] ?? path}`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  response.end();
}).listen(Number(process.env.ALVOR_REDIRECT_PORT ?? 5180), '127.0.0.1');
