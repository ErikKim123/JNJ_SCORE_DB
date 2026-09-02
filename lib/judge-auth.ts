// Route-side guard: turn the session cookie into a judge the DB understands.
//
// Server-only. Routes must take identity from here, never from a query param
// or request body.

import { NextResponse } from 'next/server';
import { getServiceClient } from './supabase';
import { readSession, type JudgeSession } from './judge-session';
import type { Round } from './sheet-schema';

export type AuthResult =
  | { ok: true; session: JudgeSession }
  | { ok: false; response: NextResponse };

/**
 * Require a signed-in judge. When `contestId` is given it must match the
 * session's competition — a stale localStorage selection should re-login
 * rather than silently read another contest.
 */
export function requireJudge(req: Request, contestId?: string | null): AuthResult {
  const session = readSession(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 }),
    };
  }
  if (contestId && contestId !== session.c) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Session belongs to a different competition' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

/**
 * The judges row for this person in this round. Each person has one row per
 * round, keyed by (contest_id, display_order).
 */
export async function resolveRoundJudgeId(
  session: JudgeSession,
  round: Round,
): Promise<string | null> {
  const { data } = await getServiceClient()
    .from('judges')
    .select('id')
    .eq('contest_id', session.c)
    .eq('display_order', session.d)
    .eq('round', round)
    .maybeSingle();
  return data?.id ?? null;
}
