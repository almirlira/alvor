/**
 * routes-dre.ts — upload da DRE (multipart) e leitura do estado atual.
 *
 *   POST /dre/upload   (campo "file": .xlsx | .xls | .csv)  → DreImport
 *   GET  /dre/current                                       → DreImport | 404
 *   POST /dre/load-sample                                   → carrega samples/dre_exemplo_12m.xlsx
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDreFromBuffer, type DreImport } from '@dre/ingest';
import { readJson, writeJson, SAMPLES_DIR } from './store.js';

export const SAMPLE_FILE = 'dre_exemplo_12m.xlsx';

export function getCurrentImport(): DreImport | null {
  return readJson<DreImport | null>('statement', null);
}

export async function importBuffer(buffer: Buffer, fileName: string): Promise<DreImport> {
  const result = await readDreFromBuffer(buffer, { fileName });
  writeJson('statement', result);
  // Insights e chat anteriores pertencem a outra DRE — limpa.
  writeJson('insights', null);
  writeJson('chat', []);
  return result;
}

export async function dreRoutes(app: FastifyInstance): Promise<void> {
  app.post('/dre/upload', async (req, reply) => {
    const file = await req.file();
    if (file === undefined) {
      return reply.code(400).send({ message: 'Envie um arquivo no campo "file" (.xlsx ou .csv).' });
    }
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ message: 'Arquivo vazio.' });
    try {
      const result = await importBuffer(buffer, file.filename);
      return reply.send(result);
    } catch (err) {
      req.log.warn({ err }, 'falha ao ler DRE');
      return reply.code(422).send({ message: err instanceof Error ? err.message : 'Nao consegui ler a planilha.' });
    }
  });

  app.get('/dre/current', async (_req, reply) => {
    const current = getCurrentImport();
    if (current === null) return reply.code(404).send({ message: 'Nenhuma DRE enviada ainda.' });
    return reply.send(current);
  });

  app.post('/dre/load-sample', async (req, reply) => {
    try {
      const buffer = readFileSync(join(SAMPLES_DIR, SAMPLE_FILE));
      const result = await importBuffer(buffer, SAMPLE_FILE);
      return reply.send(result);
    } catch (err) {
      req.log.warn({ err }, 'falha ao carregar exemplo');
      return reply.code(500).send({ message: err instanceof Error ? err.message : 'Falha ao carregar exemplo.' });
    }
  });
}
