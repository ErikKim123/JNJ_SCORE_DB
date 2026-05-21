import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import type { Judge, JudgeVoteTarget, Round } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

// The new `judges` table stores one row per (contest, round, display_order).
// Same person has 3 rows (prelim/semi/final). For the UI's `/enter` flow we
// dedupe by display_order — `display_order` is the stable person identity.
//
// The returned `id` is the prelim-row UUID (so the UI gets a stable key the
// other endpoints can resolve back to (contest, display_order) and look up
// the round-specific row).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const contestId = url.searchParams.get('competitionId') || url.searchParams.get('sheetId');
  const roundParam = url.searchParams.get('round') as Round | null;
  if (!contestId) {
    return NextResponse.json({ ok: false, error: 'Missing competitionId' }, { status: 400 });
  }
  const sb = getServiceClient();
  const q = sb
    .from('judges')
    .select('id, display_order, name, alias, max_votes, target_role, round')
    .eq('contest_id', contestId)
    .order('display_order', { ascending: true });
  const { data, error } = roundParam
    ? await q.eq('round', roundParam)
    : await q;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  // round 별로 max_votes 가 다르므로 (judges 는 round-당 row 1개) prelim/semi 를
  // 각각 별도로 보관해 maxPrelimVotes / maxSemiVotes 에 분리해 담는다. id 는
  // prelim row 우선(없으면 semi → final) — 다른 라우트들이 prelim id 를 받아
  // (contest, display_order) 로 round-specific row 를 resolve 하기 때문.
  const rows = data ?? [];
  type Row = typeof rows[number];
  type Slot = { prelim?: Row; semi?: Row; final?: Row };
  const byOrder = new Map<number, Slot>();
  for (const r of rows) {
    const slot = byOrder.get(r.display_order) ?? {};
    slot[r.round as 'prelim' | 'semi' | 'final'] = r;
    byOrder.set(r.display_order, slot);
  }
  const ordered = Array.from(byOrder.entries()).sort((a, b) => a[0] - b[0]);
  const judges: Judge[] = ordered
    .map(([, slot]) => {
      const head = slot.prelim ?? slot.semi ?? slot.final;
      if (!head) return null;
      return {
        id: head.id,
        name: head.name,
        active: true,
        maxPrelimVotes: slot.prelim?.max_votes ?? undefined,
        maxSemiVotes: slot.semi?.max_votes ?? undefined,
        voteTarget: targetRoleToVoteTarget(head.target_role),
      } as Judge;
    })
    .filter((j): j is Judge => j !== null);
  return NextResponse.json({ ok: true, data: judges });
}

function targetRoleToVoteTarget(t: string | null | undefined): JudgeVoteTarget {
  if (t === 'leader') return 'leader';
  if (t === 'follower') return 'follower';
  return 'all'; // 'both' or any other value
}
