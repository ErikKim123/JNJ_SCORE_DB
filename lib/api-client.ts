// Browser-side wrapper around the /api/db/* routes. Same contract as the old
// lib/apps-script.ts so pages can swap imports with minimal diff.

import type {
  ApiResponse, Competition, Contestant, Event, Judge, Round, SubmitPayload,
} from './sheet-schema';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'API' | 'PARSE' | 'NOT_CONFIGURED'
      | 'UNAUTHORIZED',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(input, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function call<T>(input: string, init: RequestInit = {}, retries = DEFAULT_RETRIES): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(input, init, DEFAULT_TIMEOUT_MS);
      let body: ApiResponse<T> | null = null;
      try { body = (await res.json()) as ApiResponse<T>; } catch { /* handled below */ }
      // 401/403 means no usable session — retrying will not help, and callers
      // send the judge back to /enter on this code.
      if (body && !body.ok) {
        const unauthorized = res.status === 401 || res.status === 403;
        throw new ApiError(body.error, unauthorized ? 'UNAUTHORIZED' : 'API');
      }
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'HTTP');
      if (!body) throw new ApiError('Malformed JSON', 'PARSE');
      return body.data;
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiError && (err.code === 'API' || err.code === 'UNAUTHORIZED')) throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt)));
        continue;
      }
    }
  }
  if (lastErr instanceof ApiError) throw lastErr;
  if (lastErr instanceof DOMException && lastErr.name === 'AbortError') {
    throw new ApiError('Request timed out', 'TIMEOUT', lastErr);
  }
  throw new ApiError('Network error', 'NETWORK', lastErr);
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const u = new URL(path, 'http://x'); // dummy base for parsing
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.pathname + (u.search ? u.search : '');
}

export async function getCompetitions(): Promise<Competition[]> {
  return call<Competition[]>('/api/db/competitions');
}

export async function getJudges(competitionId?: string): Promise<Judge[]> {
  return call<Judge[]>(withQuery('/api/db/judges', { competitionId }));
}

export async function getEvent(competitionId?: string): Promise<Event> {
  return call<Event>(withQuery('/api/db/event', { competitionId }));
}

/** Which judge's marks come back is decided by the session cookie, not the caller. */
export async function getRound(round: Round, competitionId?: string): Promise<Contestant[]> {
  return call<Contestant[]>(withQuery('/api/db/round', { round, competitionId }));
}

export async function login(
  competitionId: string,
  judgeId: string,
  pin: string,
): Promise<{ name: string; claimed: boolean }> {
  return call<{ name: string; claimed: boolean }>(
    '/api/db/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitionId, judgeId, pin }),
    },
    0, // never retry a PIN — retries burn the lockout budget
  );
}

export async function logout(): Promise<null> {
  return call<null>('/api/db/logout', { method: 'POST' }, 0);
}

export async function submitRound<R extends Round>(
  payload: SubmitPayload<R>,
  competitionId?: string,
): Promise<{ written: number }> {
  return call<{ written: number }>('/api/db/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, competitionId }),
  });
}
