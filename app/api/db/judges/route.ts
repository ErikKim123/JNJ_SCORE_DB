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
  // When no round filter is given, dedupe by display_order — prefer prelim, then semi, then final.
  const rows = data ?? [];
  const byOrder = new Map<number, typeof rows[number]>();
  const priority: Record<string, number> = { prelim: 0, semi: 1, final: 2 };
  for (const r of rows) {
    const cur = byOrder.get(r.display_order);
    if (!cur || (priority[r.round] ?? 9) < (priority[cur.round] ?? 9)) {
      byOrder.set(r.display_order, r);
    }
  }
  const deduped = Array.from(byOrder.values()).sort((a, b) => a.display_order - b.display_order);
  const judges: Judge[] = deduped.map((j) => ({
    id: j.id,
    name: j.name,
    active: true,
    maxPrelimVotes: j.max_votes ?? undefined,
    maxSemiVotes: j.max_votes ?? undefined,
    voteTarget: targetRoleToVoteTarget(j.target_role),
  }));
  return NextResponse.json({ ok: true, data: judges });
}

function targetRoleToVoteTarget(t: string | null | undefined): JudgeVoteTarget {
  if (t === 'leader') return 'leader';
  if (t === 'follower') return 'follower';
  return 'all'; // 'both' or any other value
}
