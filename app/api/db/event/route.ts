import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import type { Event, FinalCriterion, Round, RoundLifecycle } from '../../../../lib/sheet-schema';
import { DEFAULT_FINAL_CRITERIA, FINAL_CRITERIA } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

const VALID_CRITERIA = new Set<string>(FINAL_CRITERIA);

// Reads contest meta + per-round status + scoring_items from the contests table.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const contestId = url.searchParams.get('competitionId') || url.searchParams.get('sheetId');
  if (!contestId) {
    return NextResponse.json({ ok: false, error: 'Missing competitionId' }, { status: 400 });
  }
  const sb = getServiceClient();
  const { data: row, error } = await sb
    .from('contests')
    .select('id, name, festival_header, period_start, period_end, prelim_status, semi_status, final_status, scoring_items')
    .eq('id', contestId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ ok: false, error: 'Competition not found' }, { status: 404 });

  const roundStatus: Record<Round, RoundLifecycle> = {
    prelim: (row.prelim_status as RoundLifecycle) ?? 'prep',
    semi: (row.semi_status as RoundLifecycle) ?? 'prep',
    final: (row.final_status as RoundLifecycle) ?? 'prep',
  };
  const rawCriteria: unknown = row.scoring_items;
  const criteriaArr = Array.isArray(rawCriteria) ? rawCriteria : DEFAULT_FINAL_CRITERIA;
  const finalCriteria: FinalCriterion[] = criteriaArr
    .filter((c): c is FinalCriterion => typeof c === 'string' && VALID_CRITERIA.has(c));
  const event: Event = {
    name: row.festival_header || row.name,
    date: formatPeriod(row.period_start, row.period_end),
    venue: '', // not in contests table
    currentRound: deriveCurrent(roundStatus),
    roundStatus,
    finalCriteria: finalCriteria.length ? finalCriteria : [...DEFAULT_FINAL_CRITERIA],
  };
  return NextResponse.json({ ok: true, data: event });
}

function deriveCurrent(s: Record<Round, RoundLifecycle>): Round {
  const order: Round[] = ['prelim', 'semi', 'final'];
  return order.find((r) => s[r] === 'live') ?? order.find((r) => s[r] === 'open') ?? 'prelim';
}

function formatPeriod(start: string | null, end: string | null): string {
  const s = (start ?? '').slice(0, 10);
  const e = (end ?? '').slice(0, 10);
  if (s && e && s !== e) return `${s} ~ ${e}`;
  return s || e || '';
}
