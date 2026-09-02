import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  createSessionToken,
  hashPin,
  isValidPinFormat,
  sessionCookie,
  verifyPin,
} from '../../../../lib/judge-session';

export const dynamic = 'force-dynamic';

// Judge login. The first login for a given judge claims that name with the PIN
// entered; every later login must match it.
//
// `judgeId` here only names *which* judge is logging in — it grants nothing on
// its own. The PIN is what authenticates, and the resulting cookie is what the
// other routes trust.
export async function POST(req: Request) {
  let body: { competitionId?: string; judgeId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const { competitionId, judgeId, pin } = body;
  if (!competitionId || !judgeId) {
    return NextResponse.json({ ok: false, error: 'Missing competitionId or judgeId' }, { status: 400 });
  }
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ ok: false, error: 'PIN must be 4 digits' }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: judge, error: jErr } = await sb
    .from('judges')
    .select('contest_id, display_order, name')
    .eq('id', judgeId)
    .maybeSingle();
  if (jErr) return NextResponse.json({ ok: false, error: jErr.message }, { status: 500 });
  if (!judge || judge.contest_id !== competitionId) {
    return NextResponse.json({ ok: false, error: 'Judge not found' }, { status: 404 });
  }

  const key = { contest_id: judge.contest_id, display_order: judge.display_order };
  const { data: account, error: aErr } = await sb
    .from('judge_accounts')
    .select('pin_hash, failed_attempts, locked_until')
    .match(key)
    .maybeSingle();
  if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 500 });

  // ---- first login: claim the name with this PIN ----
  if (!account) {
    const { error: insErr } = await sb
      .from('judge_accounts')
      .insert({ ...key, pin_hash: hashPin(pin) });
    if (insErr) {
      // 23505 = someone claimed it between our read and this insert. Fall
      // through to the normal check so the real owner still gets in.
      if (insErr.code !== '23505') {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
      return verifyExisting(sb, key, pin, judge.name);
    }
    return ok(judge.name, judge.contest_id, judge.display_order, true);
  }

  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    return NextResponse.json(
      { ok: false, error: `Too many wrong PINs. Try again in ${LOCKOUT_MINUTES} minutes.` },
      { status: 423 },
    );
  }

  if (!verifyPin(pin, account.pin_hash)) {
    const attempts = account.failed_attempts + 1;
    await sb
      .from('judge_accounts')
      .update({
        failed_attempts: attempts,
        locked_until:
          attempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
            : null,
        updated_at: new Date().toISOString(),
      })
      .match(key);
    return NextResponse.json({ ok: false, error: 'Wrong PIN' }, { status: 401 });
  }

  if (account.failed_attempts !== 0 || account.locked_until) {
    await sb
      .from('judge_accounts')
      .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
      .match(key);
  }
  return ok(judge.name, judge.contest_id, judge.display_order, false);
}

type Key = { contest_id: string; display_order: number };

// Re-read after a lost claim race and check the PIN against the winner's row.
async function verifyExisting(
  sb: ReturnType<typeof getServiceClient>,
  key: Key,
  pin: string,
  name: string,
) {
  const { data } = await sb
    .from('judge_accounts')
    .select('pin_hash')
    .match(key)
    .maybeSingle();
  if (!data || !verifyPin(pin, data.pin_hash)) {
    return NextResponse.json({ ok: false, error: 'Wrong PIN' }, { status: 401 });
  }
  return ok(name, key.contest_id, key.display_order, false);
}

function ok(name: string, contestId: string, displayOrder: number, claimed: boolean) {
  const res = NextResponse.json({ ok: true, data: { name, claimed } });
  res.headers.set('Set-Cookie', sessionCookie(createSessionToken(contestId, displayOrder, name)));
  return res;
}
