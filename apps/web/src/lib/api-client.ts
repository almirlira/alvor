/**
 * API client autenticado — usa a API sob o mesmo caminho base do produto.
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

const BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) || `${import.meta.env.BASE_URL}api`;
let tokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  tokenProvider = provider;
}

async function headers(extra?: HeadersInit): Promise<HeadersInit> {
  const token = tokenProvider === null ? null : await tokenProvider();
  return {
    ...(extra ?? {}),
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
  };
}

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
    const res = await fetch(`${BASE}${path}`, { headers: await headers({ Accept: 'application/json' }) });
    return handle<T>(res);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: await headers({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handle<T>(res);
  },
  async postFile<T>(path: string, file: File): Promise<T> {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: await headers() });
    return handle<T>(res);
  },
};
