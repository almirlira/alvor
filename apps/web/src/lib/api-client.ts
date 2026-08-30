/**
 * API client fino sobre fetch — ALVOR (protótipo, sem autenticação).
 * Todas as chamadas vão para /api/* e o Vite encaminha para a API local (:3800).
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  public constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const BASE = '/api';

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let message = `Erro ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { message?: string; error?: string; code?: string };
    message = body.message ?? body.error ?? message;
    code = body.code;
  } catch {
    // corpo nao-JSON — mantem mensagem padrao
  }
  throw new ApiError(message, res.status, code);
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    return handle<T>(res);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handle<T>(res);
  },
  async postFile<T>(path: string, file: File): Promise<T> {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
    return handle<T>(res);
  },
};
