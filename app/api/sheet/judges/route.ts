import { NextResponse } from 'next/server';
import type { Judge } from '../../../../lib/sheet-schema';
import { parseVoteTarget } from '../../../../lib/sheet-schema';
import { fetchSheetTab, parseCsvLine } from '../../../../lib/sheet-fetch';

// 대회 001 원본시트 — dev fallback. 운영에서는 /enter 가 선택된 대회의
// masterFileId 를 ?sheetId= 로 전달한다.
const DEFAULT_SHEET_ID = '1gzX4kidjg4J6Qj5g1ANX9ibdeGaK_KkLTgU6xoQVn80';
const TAB_NAME = '2.심사위원';
const TAB_GID = '1547085887';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sheetId = url.searchParams.get('sheetId') || DEFAULT_SHEET_ID;
  const result = await fetchSheetTab({
    sheetId,
    tabName: TAB_NAME,
    publicGid: TAB_GID,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    data: parseJudges(result.csv ?? '', result.values),
    via: result.via,
  });
}

function parseJudges(csv: string, values?: unknown[][]): Judge[] {
  // Prefer the structured 2D array from Apps Script if present; else parse CSV.
  if (values) return parseJudgesFromValues(values);
  return parseJudgesFromCsv(csv);
}

// Sheet col layout (2.심사위원):
//   0=번호  1=심사위원명  2=예명  3=장르  4=소속  5=경력
//   6=연락처  7=이메일  8=비고  9=예선투표최대수  10=본선투표최대수
//   11=대상 (모두/리더/팔로워 — 본인이 채점할 참가자 역할 필터)
const COL_PRELIM_MAX = 9;
const COL_SEMI_MAX = 10;
const COL_VOTE_TARGET = 11;

function parseInteger(raw: unknown): number | undefined {
  const v = String(raw ?? '').trim();
  if (!/^\d+$/.test(v)) return undefined;
  return Number(v);
}

function parseJudgesFromCsv(csv: string): Judge[] {
  // No fixed header position — scan all rows and accept ones whose col 0 is a
  // pure digit (the row number "1", "2", ...) and col 1 is a non-empty name.
  // This tolerates banner rows, merged-cell headers, and trailing notes.
  const lines = csv.split(/\r?\n/);
  const judges: Judge[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    const num = cols[0]?.trim() ?? '';
    const name = cols[1]?.trim() ?? '';
    if (!/^\d+$/.test(num) || !name) continue;
    judges.push({
      id: `J${num.padStart(2, '0')}`,
      name,
      active: true,
      maxPrelimVotes: parseInteger(cols[COL_PRELIM_MAX]),
      maxSemiVotes: parseInteger(cols[COL_SEMI_MAX]),
      voteTarget: parseVoteTarget(cols[COL_VOTE_TARGET]),
    });
  }
  return judges;
}

function parseJudgesFromValues(values: unknown[][]): Judge[] {
  const judges: Judge[] = [];
  for (const row of values) {
    const num = String(row?.[0] ?? '').trim();
    const name = String(row?.[1] ?? '').trim();
    if (!/^\d+$/.test(num) || !name) continue;
    judges.push({
      id: `J${num.padStart(2, '0')}`,
      name,
      active: true,
      maxPrelimVotes: parseInteger(row?.[COL_PRELIM_MAX]),
      maxSemiVotes: parseInteger(row?.[COL_SEMI_MAX]),
      voteTarget: parseVoteTarget(
        row?.[COL_VOTE_TARGET] != null ? String(row[COL_VOTE_TARGET]) : undefined,
      ),
    });
  }
  return judges;
}
