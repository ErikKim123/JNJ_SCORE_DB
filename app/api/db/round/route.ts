import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import { CRITERION_COLUMN, FINAL_CRITERIA } from '../../../../lib/sheet-schema';
import type { Contestant, FinalCriterion, Round, RoundStatus } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

const VALID_ROUNDS = new Set<Round>(['prelim', 'semi', 'final']);

// Reads contestants for a round.
//   prelim → all participants
//   semi   → qualifiers where round='prelim' and passed=true
//   final  → qualifiers where round='semi' and passed=true
// When `judgeId` is provided, also seeds the contestant's `outcome` from the
// judge's prior vote_mark in judge_votes (prelim/semi) or final scores.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const round = url.searchParams.get('round') as Round | null;
  const contestId = url.searchParams.get('competitionId') || url.searchParams.get('sheetId');
  const judgeId = url.searchParams.get('judgeId') || undefined;
  if (!round || !VALID_ROUNDS.has(round)) {
    return NextResponse.json({ ok: false, error: 'Invalid round' }, { status: 400 });
  }
  if (!contestId) {
    return NextResponse.json({ ok: false, error: 'Missing competitionId' }, { status: 400 });
  }
  const sb = getServiceClient();

  // 1) Eligible participants
  let eligibleNums: Set<string> | null = null;
  if (round === 'semi' || round === 'final') {
    const sourceRound = round === 'semi' ? 'prelim' : 'semi';
    const { data: q, error: qErr } = await sb
      .from('qualifiers')
      .select('participant_num')
      .eq('contest_id', contestId)
      .eq('round', sourceRound)
      .eq('passed', true);
    if (qErr) return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
    eligibleNums = new Set((q ?? []).map((r) => r.participant_num));
  }

  const { data: rows, error } = await sb
    .from('participants')
    .select('id, num, team_name, representative, role, photo_url')
    .eq('contest_id', contestId)
    .order('num', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const participants = (rows ?? []).filter((r) => !eligibleNums || eligibleNums.has(r.num));

  // 2) If judgeId provided, resolve to the round-specific judges.id (the UI's
  //    judgeId is the prelim-row UUID from /api/db/judges; we look up the
  //    matching display_order for the requested round).
  let roundJudgeId: string | null = null;
  if (judgeId) {
    const { data: jrow } = await sb
      .from('judges')
      .select('contest_id, display_order')
      .eq('id', judgeId)
      .maybeSingle();
    if (jrow) {
      const { data: rj } = await sb
        .from('judges')
        .select('id')
        .eq('contest_id', jrow.contest_id)
        .eq('display_order', jrow.display_order)
        .eq('round', round)
        .maybeSingle();
      roundJudgeId = rj?.id ?? null;
    }
  }

  // 3) Pull this judge's votes (vote_mark for prelim/semi, scores for final)
  const voteMarkByNum = new Map<string, string>();
  const scoresByNum = new Map<string, Partial<Record<FinalCriterion, number | null>>>();
  if (roundJudgeId && participants.length) {
    const cols = round === 'final'
      ? `participant_num, ${FINAL_CRITERIA.map((k) => CRITERION_COLUMN[k]).join(', ')}`
      : 'participant_num, vote_mark';
    const { data: votes } = await sb
      .from('judge_votes')
      .select(cols)
      .eq('judge_id', roundJudgeId);
    for (const v of ((votes ?? []) as unknown[]) as Record<string, unknown>[]) {
      const num = String(v.participant_num);
      if (round === 'final') {
        const row: Partial<Record<FinalCriterion, number | null>> = {};
        for (const k of FINAL_CRITERIA) {
          const raw = v[CRITERION_COLUMN[k]];
          const n = raw == null ? null : Number(raw);
          row[k] = Number.isFinite(n as number) ? (n as number) : null;
        }
        scoresByNum.set(num, row);
      } else if (typeof v.vote_mark === 'string') {
        voteMarkByNum.set(num, v.vote_mark);
      }
    }
  }

  const out: Contestant[] = participants.map((c) => {
    let outcome: RoundStatus = roundJudgeId ? 'fail' : 'ready';
    if (judgeId && (round === 'prelim' || round === 'semi')) {
      outcome = voteMarkByNum.get(c.num) === 'O' ? 'pass' : 'fail';
    }
    const finalScores = round === 'final' && roundJudgeId
      ? scoresByNum.get(c.num) ?? {}
      : undefined;
    return {
      id: c.num, // expose participant_num as the wire ID — submit echoes it back
      number: c.num,
      name1: c.team_name ?? '',
      name2: c.representative ?? '',
      role: mapRole(c.role),
      photoUrl: c.photo_url ? normalizePhoto(c.photo_url) : undefined,
      outcome,
      finalScores,
    };
  });
  return NextResponse.json({ ok: true, data: out });
}

function mapRole(r: string | null): string | undefined {
  if (!r) return undefined;
  if (r === 'leader') return 'Leader';
  if (r === 'follower') return 'Follower';
  return undefined;
}

function normalizePhoto(url: string): string {
  const m1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}=w400`;
  const m2 = url.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/);
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}=w400`;
  return url;
}
