import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import { requireJudge, resolveRoundJudgeId } from '../../../../lib/judge-auth';
import { CRITERION_COLUMN, FINAL_CRITERIA } from '../../../../lib/sheet-schema';
import type { FinalCriterion, Round, SubmitPayload } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

// Writes judge_votes rows.
//   prelim/semi → set vote_mark ('O' / 'X')
//   final       → set per-criterion score columns (basic_score / connectivity_score / ...)
//
// Whose votes these are comes from the session cookie alone. Any judgeId in
// the body is ignored — trusting it was how anyone could overwrite anyone's
// scores.
export async function POST(req: Request) {
  let body: SubmitPayload & { competitionId?: string; sheetId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const contestId = body.competitionId || body.sheetId;
  const { round, entries } = body;
  if (!contestId || !round || !Array.isArray(entries)) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  const auth = requireJudge(req, contestId);
  if (!auth.ok) return auth.response;
  if (round !== 'prelim' && round !== 'semi' && round !== 'final') {
    return NextResponse.json({ ok: false, error: 'Invalid round' }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ ok: true, data: { written: 0 } });
  }

  const sb = getServiceClient();

  const targetJudgeId = await resolveRoundJudgeId(auth.session, round);
  if (!targetJudgeId) {
    return NextResponse.json({ ok: false, error: `Judge has no ${round} record` }, { status: 404 });
  }

  let written = 0;

  if (round === 'prelim' || round === 'semi') {
    type V = { contestantId: string; status: 'pass' | 'fail' | 'absent' };
    const rows: { judge_id: string; participant_num: string; vote_mark: string }[] = [];
    for (const e of entries as V[]) {
      if (!e.contestantId) continue;
      // 'absent' isn't representable in the new schema (no per-round attendance);
      // record as 'X' (fail/off) — operator handles absence separately.
      const mark = e.status === 'pass' ? 'O' : 'X';
      rows.push({ judge_id: targetJudgeId, participant_num: String(e.contestantId), vote_mark: mark });
    }
    if (rows.length) {
      const { error } = await sb.from('judge_votes').upsert(rows, {
        onConflict: 'judge_id,participant_num',
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      written += rows.length;
    }
    return NextResponse.json({ ok: true, data: { written } });
  }

  // final
  type F = { contestantId: string } & Partial<Record<FinalCriterion, number>>;
  const rows: Array<Record<string, string | number | null>> = [];
  for (const e of entries as F[]) {
    if (!e.contestantId) continue;
    const row: Record<string, string | number | null> = {
      judge_id: targetJudgeId,
      participant_num: String(e.contestantId),
    };
    for (const k of FINAL_CRITERIA) {
      const v = e[k];
      row[CRITERION_COLUMN[k]] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    rows.push(row);
  }
  if (rows.length) {
    const { error } = await sb.from('judge_votes').upsert(rows, {
      onConflict: 'judge_id,participant_num',
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    written += rows.length;
  }
  return NextResponse.json({ ok: true, data: { written } });
}
