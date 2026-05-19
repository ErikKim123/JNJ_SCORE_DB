import { NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/supabase';
import type { Competition } from '../../../../lib/sheet-schema';

export const dynamic = 'force-dynamic';

// Reads from the `contests` table — the canonical competition list.
// Output keeps the legacy Competition shape so existing UI continues working.
export async function GET() {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('contests')
    .select('id, name, host_org, period_start, period_end, festival_header, legacy_spreadsheet_id')
    .order('id', { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const items: Competition[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    date: formatPeriod(r.period_start, r.period_end),
    organizer: r.host_org || undefined,
    contactName: undefined,
    contactPhone: undefined,
    contactEmail: undefined,
    masterFileId: r.id, // legacy field name; UI passes this as competitionId
    masterFileUrl: undefined,
    masterFileName: r.festival_header || undefined,
  }));
  return NextResponse.json({ ok: true, data: items });
}

function formatPeriod(start: string | null, end: string | null): string {
  const s = (start ?? '').slice(0, 10);
  const e = (end ?? '').slice(0, 10);
  if (s && e && s !== e) return `${s} ~ ${e}`;
  return s || e || '';
}
