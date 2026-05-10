import { NextResponse } from 'next/server';
import type { Contestant, Round } from '../../../../lib/sheet-schema';
import { fetchSheetTab, parseCsvLine } from '../../../../lib/sheet-fetch';

// 대회 001 원본시트 — dev fallback. 운영에서는 클라이언트가 ?sheetId= 로
// 선택된 대회의 masterFileId 를 전달한다.
const DEFAULT_SHEET_ID = '1gzX4kidjg4J6Qj5g1ANX9ibdeGaK_KkLTgU6xoQVn80';

// Source tabs (gid is legacy fallback only — gviz uses tabName which is gid-independent).
// 본선(semi)도 prelim과 동일한 `3.참가자` 탭을 읽는다 — `4.예선통과` 탭은 자동
// 집계 결과(참가자 명단)만 있고 심사위원별 O/X VOTE 컬럼이 없기 때문이다.
// `3.참가자` 탭은 예선·본선 양쪽의 심사위원별 VOTE 컬럼을 모두 포함하므로,
// 본선도 여기서 읽고 `예선통과 == TRUE` 인 참가자만 필터링하면 된다.
const TAB_BY_ROUND: Record<Round, { name: string; gid: string }> = {
  prelim: { name: '3.참가자', gid: '732295429' },
  semi: { name: '3.참가자', gid: '732295429' },
  // 결승도 3.참가자 탭에서 읽는다 — 5.본선통과 탭은 자동집계 명단만 있고
  // 심사위원별 결승 점수(기본기/연결성/음악성) 컬럼이 없기 때문이다.
  final: { name: '3.참가자', gid: '732295429' },
};

// Column whose value is the round's pass/fail/absent record.
const OUTCOME_COL_BY_ROUND: Record<Round, string> = {
  prelim: '예선통과',
  semi: '본선통과',
  final: '결승진출',
};

// 본선/결승 채점 시 화면에 보여줄 참가자 필터 — 직전 라운드 통과자만 표출.
// 3.참가자 탭의 자동 통과 컬럼은 헤더 라벨이 비어있다.
//   - `예선 등수` + 1 → 예선통과(자동)
//   - `본선 등수` + 1 → 본선통과(자동)
//   - `본선 등수` + 2 → 결승진출(자동, top N 컷)
// → 라벨 검색 대신 등수 컬럼 위치 + offset 으로 위치를 잡는다.
function findEligibilityIdx(
  headers: string[],
  rankCol: '예선 등수' | '본선 등수',
  offset: 1 | 2 = 1,
): number {
  const r = headers.indexOf(rankCol);
  return r >= 0 ? r + offset : -1;
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const round = url.searchParams.get('round') as Round | null;
  if (!round || !(round in TAB_BY_ROUND)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid round (prelim|semi|final)' },
      { status: 400 },
    );
  }
  const sheetId = url.searchParams.get('sheetId') || DEFAULT_SHEET_ID;
  const judgeId = url.searchParams.get('judgeId') || undefined;
  const tab = TAB_BY_ROUND[round];
  const result = await fetchSheetTab({
    sheetId,
    tabName: tab.name,
    publicGid: tab.gid,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    data: parseContestants(
      result.csv ?? '',
      OUTCOME_COL_BY_ROUND[round],
      round,
      judgeId,
    ),
    via: result.via,
  });
}

function parseContestants(
  csv: string,
  outcomeCol: string,
  round: Round,
  judgeId?: string,
): Contestant[] {
  const lines = csv.split(/\r?\n/);
  // Find any row starting with 참가번호 (cell may be quoted with checkbox prefix).
  const headerIdx = lines.findIndex((l) => {
    const first = parseCsvLine(l)[0]?.replace(/^☑\s*/, '').trim() ?? '';
    return first === '참가번호';
  });
  if (headerIdx < 0) return [];
  const headers = parseCsvLine(lines[headerIdx]).map((h) =>
    h.replace(/^☑\s*/, '').trim(),
  );
  // sub-header (헤더 다음 줄) — 결승 영역의 기본기/연결성/음악성 라벨이 여기에
  // 들어있다. 데이터 행은 이 줄도 건너뛰어 시작한다.
  const subHeaders = parseCsvLine(lines[headerIdx + 1] ?? '').map((h) =>
    h.trim(),
  );
  const dataStartIdx = subHeaders.some((h) => h === '기본기')
    ? headerIdx + 2
    : headerIdx + 1;
  const numIdx = headers.indexOf('참가번호');
  const teamIdx = findCol(headers, ['팀명/참가자명', '팀명', '참가자명']);
  const leaderIdx = findCol(headers, ['대표자명', '대표자', '리더']);
  // Sheet uses "역활" (intentional typo of 역할 in source) — accept both.
  const roleIdx = findCol(headers, ['역활', '역할']);
  // 시트 업데이트(2026-05): 표시용 `사진` 컬럼은 비어있고(또는 `#REF!`),
  // 실제 이미지 URL 은 `사진원본` 컬럼(Google Drive 공유 링크)에 들어온다.
  // 둘 다 찾아서 유효한 URL 을 우선 사용한다.
  const photoIdx = findCol(headers, ['사진', '사진 URL', 'photo']);
  const photoOriginalIdx = findCol(headers, ['사진원본', '사진 원본', '원본사진']);
  // Auto-computed outcome column (final pass/fail by sheet formulas).
  const outcomeIdx = headers.findIndex((h) => h.startsWith(outcomeCol));
  // Per-judge VOTE column for prelim/semi (mirrors Apps Script logic).
  const judgeVoteIdx =
    judgeId && (round === 'prelim' || round === 'semi')
      ? findJudgeVoteColumn(headers, round, judgeId)
      : -1;
  // 본선(semi)/결승(final)일 때 자동 통과 컬럼을 별도로 찾아, TRUE 인
  // 참가자만 화면에 보낸다. (TAB을 3.참가자로 바꾸면서 전체 명단이 들어옴)
  // semi  → `예선 등수` + 1 (예선통과 자동)
  // final → `본선 등수` + 2 (결승진출 자동 — top N 컷; 본선통과만 봐선 안 됨)
  const eligibilityIdx =
    round === 'semi'
      ? findEligibilityIdx(headers, '예선 등수', 1)
      : round === 'final'
        ? findEligibilityIdx(headers, '본선 등수', 2)
        : -1;
  // final 본인 점수 컬럼 (기본기/연결성/음악성). gviz CSV 에서는 결승 영역의
  // 메인 헤더가 비어있고 sub-header 행에 `기본기/연결성/음악성` 이 반복된다.
  // sub-header 의 첫 `기본기` 위치를 J01 의 basics 로 잡고, 심사위원 N 마다
  // 3컬럼씩 오프셋으로 잡는다.
  const finalScoreCols =
    judgeId && round === 'final'
      ? findFinalScoreColumns(headers, subHeaders, judgeId)
      : null;
  const out: Contestant[] = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const number = cols[numIdx]?.trim() ?? '';
    if (!/^\d+/.test(number)) continue;
    // 본선 라운드: 예선통과(자동) == TRUE 인 참가자만 통과.
    // 결승 라운드: 본선통과(자동) == TRUE 인 참가자만 통과.
    if ((round === 'semi' || round === 'final') && eligibilityIdx >= 0) {
      const eligible = (cols[eligibilityIdx] ?? '').trim().toUpperCase();
      if (eligible !== 'TRUE') continue;
    }
    const name1 = (teamIdx >= 0 ? cols[teamIdx] : '')?.trim() ?? '';
    const name2 = (leaderIdx >= 0 ? cols[leaderIdx] : '')?.trim() ?? '';
    const role =
      roleIdx >= 0 ? cols[roleIdx]?.trim() || undefined : undefined;
    // `사진` 우선 → 비어있거나 `#REF!` 면 `사진원본`(Drive URL) 폴백.
    const photoUrl = pickPhotoUrl(
      photoIdx >= 0 ? cols[photoIdx] : undefined,
      photoOriginalIdx >= 0 ? cols[photoOriginalIdx] : undefined,
    );
    // Per-judge VOTE column policy (strict): ONLY 'O' → 'pass' (VOTE ON).
    // Everything else ('X', empty, 'READY', anything) → 'fail' (VOTE OFF).
    // 'absent' (Non) on the auto-outcome column still wins to lock the row.
    let outcome: ReturnType<typeof parseOutcome> = 'fail';
    if (judgeVoteIdx >= 0) {
      const v = (cols[judgeVoteIdx] ?? '').trim().toUpperCase();
      outcome = v === 'O' ? 'pass' : 'fail';
    } else if (outcomeIdx >= 0) {
      // No judgeId provided — fall back to auto column for read-only display.
      outcome = parseOutcome(cols[outcomeIdx]);
    }
    if (outcomeIdx >= 0) {
      const auto = parseOutcome(cols[outcomeIdx]);
      if (auto === 'absent') outcome = 'absent';
    }
    // 결승: 본인의 기본기/연결성/음악성 셀을 읽어 finalScores 로 보낸다.
    let finalScores:
      | { basics: number | null; connection: number | null; musicality: number | null }
      | undefined;
    if (round === 'final' && finalScoreCols) {
      finalScores = {
        basics: parseScoreCell(cols[finalScoreCols.basics]),
        connection: parseScoreCell(cols[finalScoreCols.connection]),
        musicality: parseScoreCell(cols[finalScoreCols.musicality]),
      };
    }
    out.push({
      id: `C${number}`,
      number,
      name1,
      name2,
      role,
      photoUrl,
      outcome,
      finalScores,
    });
  }
  return out;
}

// 사진 URL 선택 + 정규화. 시트 업데이트로 표시용 `사진` 컬럼이 비고
// `사진원본`(Drive 공유 링크)만 채워지는 경우가 생겼다. 두 후보를 순서대로
// 검사해 첫 번째로 유효한 URL 을 반환한다. Drive `/file/d/{ID}/view` 형식은
// `<img>` 에 그대로 박으면 동작하지 않으므로 `lh3.googleusercontent.com/d/{ID}`
// (공개 파일에 대해 인증 없이 이미지 바이트를 반환, CORS 지원) 로 변환한다.
function pickPhotoUrl(...candidates: (string | undefined)[]): string | undefined {
  for (const raw of candidates) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    if (v.toUpperCase() === '#REF!' || v.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(v)) continue;
    return normalizeImageUrl(v);
  }
  return undefined;
}

function normalizeImageUrl(url: string): string {
  // Drive: /file/d/{ID}/view?usp=... → 직접 표시 가능한 image URL.
  const m1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}=w400`;
  // Drive 단축형: /open?id={ID} 또는 /uc?id={ID}
  const m2 = url.match(
    /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/,
  );
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}=w400`;
  return url;
}

function parseScoreCell(raw: string | undefined): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// 결승 점수 컬럼 위치 — 심사위원 N(1-based) 마다 (기본기/연결성/음악성)
// 3컬럼씩 반복된다. 시트마다 첫 심사위원(J01) 의 sub-header 가 비어있고
// J02 부터 라벨이 시작되는 케이스가 있어, 라벨 한 줄만 보고 위치를 잡으면
// 모든 심사위원이 한 칸씩 밀려 잘못된 셀을 읽는다 → `본선 등수` 기준으로
// 결정적으로 위치를 계산하고, sub-header 라벨은 검증 용도로만 사용한다.
//
// 시트 구조: 본선 등수 | 본선통과(자동) | 결승진출(자동) | J01.기본기 | J01.연결성 | J01.음악성 | J02.기본기 ...
// 따라서 결승 점수 그룹의 시작은 (본선 등수 index + 3).
function findFinalScoreColumns(
  headers: string[],
  subHeaders: string[],
  judgeId: string,
): { basics: number; connection: number; musicality: number } | null {
  const rank = parseInt(judgeId.replace(/^J/, ''), 10);
  if (!Number.isFinite(rank) || rank < 1) return null;

  // Strategy 1 (preferred): `본선 등수` + 3 으로 J01.기본기 위치를 결정.
  const semiRankIdx = headers.indexOf('본선 등수');
  if (semiRankIdx >= 0) {
    const groupStart = semiRankIdx + 3;
    // Validate: J01 본인의 sub-header 가 `기본기` 이거나, J01 sub-header 가
    // 비어있더라도 J02 의 sub-header 가 `기본기` 면 위치를 신뢰한다.
    const j1Sub = (subHeaders[groupStart] ?? '').trim();
    const j2Sub = (subHeaders[groupStart + 3] ?? '').trim();
    if (j1Sub === '기본기' || j2Sub === '기본기') {
      const base = groupStart + (rank - 1) * 3;
      return { basics: base, connection: base + 1, musicality: base + 2 };
    }
  }

  // Strategy 2: sub-header `기본기` 첫 위치를 J01 로 가정 (legacy 호환).
  const subFirst = subHeaders.indexOf('기본기');
  if (subFirst >= 0) {
    const base = subFirst + (rank - 1) * 3;
    return { basics: base, connection: base + 1, musicality: base + 2 };
  }

  // Strategy 3: 결승전 라벨 다음 컬럼부터 시작 (예전 시트 구조).
  const startIdx = headers.findIndex((h) => h.startsWith('결승전'));
  if (startIdx >= 0) {
    const groupStart = startIdx + 1;
    const base = groupStart + (rank - 1) * 3;
    return { basics: base, connection: base + 1, musicality: base + 2 };
  }
  return null;
}

function parseOutcome(
  raw: string | undefined,
): 'ready' | 'pass' | 'fail' | 'absent' | null {
  const v = (raw ?? '').trim();
  if (!v) return 'ready'; // empty cell treated as ready
  const u = v.toUpperCase();
  // Per-judge VOTE columns store 'O' / 'X'; auto columns store TRUE/FALSE.
  if (u === 'O' || u === 'TRUE') return 'pass';
  if (u === 'X' || u === 'FALSE') return 'fail';
  if (u === 'NON' || v === 'Non') return 'absent';
  if (u === 'READY') return 'ready';
  return null;
}

// Mirrors Apps Script findJudgeVoteColumn: locate the per-judge VOTE column
// for a given round and judgeId (e.g. 'J01' = rank 1 = 1st column in group).
//   prelim group = (col after 비고) ... (col before 예선 등수)
//   semi   group = (col after 예선 등수 + auto-pass) ... (col before 본선 등수)
//
// 시트 헤더에 `예선통과` / `본선통과` 라벨이 없는 시트(자동 컬럼이 빈 헤더로
// 존재하는 경우)에서도 동작하도록, 라벨 대신 `예선 등수` / `본선 등수` 위치를
// 기준으로 그룹 경계를 계산한다. 자동 통과 컬럼은 등수 컬럼 바로 다음 1칸을
// 차지하므로 +2 부터가 심사위원 투표 그룹의 시작이 된다.
function findJudgeVoteColumn(
  headers: string[],
  round: 'prelim' | 'semi',
  judgeId: string,
): number {
  const rank = parseInt(judgeId.replace(/^J/, ''), 10);
  if (!Number.isFinite(rank) || rank < 1) return -1;
  const findStarting = (prefix: string): number =>
    headers.findIndex((h) => h.startsWith(prefix));
  if (round === 'prelim') {
    const startAfter = headers.indexOf('비고');
    let endBefore = headers.indexOf('예선 등수');
    if (endBefore < 0) endBefore = findStarting('예선통과');
    if (startAfter < 0 || endBefore < 0) return -1;
    const groupStart = startAfter + 1;
    const groupSize = endBefore - groupStart;
    if (rank > groupSize) return -1;
    return groupStart + rank - 1;
  }
  // semi: prefer `예선 등수` 기반 (라벨 없는 자동 컬럼 1칸 건너뜀).
  // 라벨 기반 fallback도 유지 — 향후 시트 디자인이 바뀌어 `예선통과` 라벨이
  // 명시되면 그쪽으로 잡힌다.
  let groupStart = -1;
  const rankIdx = headers.indexOf('예선 등수');
  if (rankIdx >= 0) {
    groupStart = rankIdx + 2; // +1: 등수, +1: 자동통과(빈 헤더)
  } else {
    const labeled = findStarting('예선통과');
    if (labeled >= 0) groupStart = labeled + 1;
  }
  let endBefore = headers.indexOf('본선 등수');
  if (endBefore < 0) endBefore = findStarting('본선통과');
  if (groupStart < 0 || endBefore < 0 || endBefore <= groupStart) return -1;
  const groupSize = endBefore - groupStart;
  if (rank > groupSize) return -1;
  return groupStart + rank - 1;
}

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

