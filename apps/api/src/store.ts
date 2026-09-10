/**
 * store.ts — persistencia em JSON (prototipo). Um arquivo por colecao em data/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATA_DIR = process.env['ALVOR_DATA_DIR'] || join(ROOT, 'data');
export const KB_DIR = join(ROOT, 'packages', 'kb', 'content');
export const SAMPLES_DIR = join(ROOT, 'samples');

function pathFor(name: string): string {
  return join(DATA_DIR, `${name}.json`);
}

export function readJson<T>(name: string, fallback: T): T {
  const p = pathFor(name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(pathFor(name), JSON.stringify(value, null, 2), 'utf-8');
}
