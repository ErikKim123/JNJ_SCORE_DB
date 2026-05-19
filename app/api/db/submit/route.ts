import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import { CRITERION_COLUMN, FINAL_CRITERIA } from '../../../../lib/sheet-schema';
import type { FinalCriterion, Round, SubmitPayload } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

// Writes judge_votes rows.
//   prelim/semi → set vote_mark ('O' / 'X')
//   final       → set per-criterion score columns (basic_score / connectivity_score / ...)
//
// The UI's judgeId is the prelim-row UUID returned by /api/db/judges. We
// resolve to the round-specific judges.id before writing.
export async function POST(req: Request) {
  let body: SubmitPayload & { competitionId?: string; sheetId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const contestId = body.competitionId || body.sheetId;
  const { judgeId, round, entries } = body;
  if (!contestId || !judgeId || !round || !Array.isArray(entries)) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
  }
  if (round !== 'prelim' && round !== 'semi' && round !== 'final') {
    return NextResponse.json({ ok: false, error: 'Invalid round' }, { status: 400 });
  }
  if (!entries.length) {
    return NextResponse.json({ ok: true, data: { written: 0 } });
  }

  const sb = getServiceClient();

  // Resolve judgeId → the round-specific judges.id (same display_order, different round).
  const { data: jOriginal, error: jErr } = await sb
    .from('judges')
    .select('contest_id, display_order')
    .eq('id', judgeId)
    .maybeSingle();
  if (jErr || !jOriginal) {
    return NextResponse.json({ ok: false, error: 'Judge not found' }, { status: 404 });
  }
  if (jOriginal.contest_id !== contestId) {
    return NextResponse.json({ ok: false, error: 'Judge does not belong to this competition' }, { status: 400 });
  }
  const { data: jRound, error: jrErr } = await sb
    .from('judges')
    .select('id')
    .eq('contest_id', contestId)
    .eq('display_order', jOriginal.display_order)
    .eq('round', round)
    .maybeSingle();
  if (jrErr) return NextResponse.json({ ok: false, error: jrErr.message }, { status: 500 });
  if (!jRound) {
    return NextResponse.json({ ok: false, error: `Judge has no ${round} record` }, { status: 404 });
  }
  const targetJudgeId = jRound.id;

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
