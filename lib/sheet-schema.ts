// Design Ref: §3 Data Model — schema mapping is centralized here so future sheet
// structure changes only touch this file (Plan SC-01..SC-03 traceability).

export type Round = 'prelim' | 'semi' | 'final';

export const ROUNDS: readonly Round[] = ['prelim', 'semi', 'final'] as const;

export const ROUND_LABEL: Record<Round, string> = {
  prelim: 'PRELIM',
  semi: 'SEMI',
  final: 'FINAL',
};

// `2.심사위원` 시트의 `대상` 컬럼 → 본인이 투표할 참가자 역할 필터.
//   all      = 모두 (default — 라더/팔로워 전부 표출)
//   leader   = 리더만 (팔로워는 화면에서 제외)
//   follower = 팔로워만 (리더는 화면에서 제외)
// 시트에 컬럼이 없거나 빈값/오타 → 'all' 로 폴백 (운영 안전성).
export type JudgeVoteTarget = 'all' | 'leader' | 'follower';

export type Judge = {
  id: string;
  name: string;
  active: boolean;
  // Per-round vote ceilings from `2.심사위원` sheet (예선투표최대수 / 본선투표최대수).
  // Optional for back-compat with sheets that don't have these columns.
  maxPrelimVotes?: number;
  maxSemiVotes?: number;
  // `2.심사위원` 의 `대상` 컬럼 — 화면에 표출/투표할 참가자 역할 필터.
  voteTarget?: JudgeVoteTarget;
};

// 시트의 `대상` 셀 값을 정규화. 운영자 자유 입력에 강건하게 한국어/영어 모두 수용.
export function parseVoteTarget(raw: string | undefined): JudgeVoteTarget {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'all';
  if (v === '리더' || v === 'leader' || v.includes('리더')) return 'leader';
  if (v === '팔로워' || v === '팔로어' || v === 'follower' || v.includes('팔로'))
    return 'follower';
  return 'all'; // '모두', 'all', 빈값, 미인식 → 전체
}

// 참가자가 해당 심사위원의 voteTarget 에 해당하는지. 'all' 은 무조건 통과.
// 참가자 role 이 비어있으면 (솔로 등) 보수적으로 표출 — 누락보다 노출이 안전.
export function contestantMatchesTarget(
  role: string | undefined,
  target: JudgeVoteTarget,
): boolean {
  if (target === 'all') return true;
  if (!role) return true;
  const r = role.trim().toLowerCase();
  if (target === 'leader') return r === '리더' || r === 'leader';
  if (target === 'follower')
    return r === '팔로워' || r === '팔로어' || r === 'follower';
  return true;
}

// `1.대회정보` 시트의 라운드별 "대회 상태" 셀 값.
// 시트 드롭다운: Prep / Pairing / Open / Live / Calculate Total / Close / Result.
//   prep      = 준비 중 (라운드 데이터 세팅 전)
//   pairing   = 조 편성 / 매칭 진행
//   open      = 대기/시작 전 (심사위원 진입 가능, 반영은 보통 Live 부터)
//   live      = 진행 중 (심사 활성)
//   calculate = 집계 중 (입력 잠금)
//   close     = 종료 (입력 잠금)
//   result    = 결과 발표 (입력 잠금)
export type RoundLifecycle =
  | 'prep'
  | 'pairing'
  | 'open'
  | 'live'
  | 'calculate'
  | 'close'
  | 'result';

export const ROUND_LIFECYCLE_LABEL: Record<RoundLifecycle, string> = {
  prep: 'PREP',
  pairing: 'PAIRING',
  open: 'OPEN',
  live: 'LIVE',
  calculate: 'CALCULATING',
  close: 'CLOSED',
  result: 'RESULT',
};

// 심사위원이 진입/입력/반영 가능한 상태(화이트리스트).
// 그 외 상태(prep/pairing/calculate/close/result)는 표출만 하고 인터랙션을 막는다.
export const ROUND_LIFECYCLE_INTERACTIVE: ReadonlySet<RoundLifecycle> = new Set([
  'open',
  'live',
]);

export function isRoundInteractive(status: RoundLifecycle): boolean {
  return ROUND_LIFECYCLE_INTERACTIVE.has(status);
}

// Final-round scoring criteria. Keys match `contests.scoring_items` jsonb
// values. The judge_votes table stores scores in differently-named columns;
// see CRITERION_COLUMN below for the wire mapping.
export const FINAL_CRITERIA = [
  'fundamentals',
  'connection',
  'musicality',
  'creativity',
  'crowd_reaction',
  'showmanship',
] as const;
export type FinalCriterion = typeof FINAL_CRITERIA[number];

export const FINAL_CRITERION_LABEL: Record<FinalCriterion, string> = {
  fundamentals: 'Fundamentals',
  connection: 'Connection',
  musicality: 'Musicality',
  creativity: 'Creativity',
  crowd_reaction: 'Crowd Reaction',
  showmanship: 'Showmanship',
};

// scoring_items key → judge_votes column name. The column names in the DB
// don't match the keys verbatim (e.g. fundamentals → basic_score) so we
// translate at the API boundary.
export const CRITERION_COLUMN: Record<FinalCriterion, string> = {
  fundamentals: 'basic_score',
  connection: 'connectivity_score',
  musicality: 'musicality_score',
  creativity: 'creativity_score',
  crowd_reaction: 'crowd_reaction_score',
  showmanship: 'showmanship_score',
};

export const DEFAULT_FINAL_CRITERIA: readonly FinalCriterion[] = [
  'fundamentals',
  'connection',
  'musicality',
];

export type Event = {
  name: string;
  date: string; // ISO 8601
  venue: string;
  currentRound: Round;
  // Per-round lifecycle from `1.대회정보` (예선/본선/결승 대회 상태).
  roundStatus: Record<Round, RoundLifecycle>;
  // Active final-round criteria for this competition (defaults to the
  // original 3 when not configured).
  finalCriteria: FinalCriterion[];
};

export type Competition = {
  id: string; // 고유번호 (e.g. "202606-0001")
  name: string; // 대회명
  date: string; // 대회 일시
  organizer?: string; // 주최
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  masterFileId?: string; // spreadsheet ID extracted from masterFileUrl
  masterFileUrl?: string;
  masterFileName?: string;
};

export type RoundStatus = 'ready' | 'pass' | 'fail' | 'absent';

export const ROUND_STATUS_LABEL: Record<RoundStatus, string> = {
  ready: 'READY',
  pass: 'PASS',
  fail: 'FAIL',
  absent: 'ABSENT',
};

// Sheet cell value (string) ↔ app status mapping.
// READY = before judging, TRUE = 통과, FALSE = 불합격, Non = 불참.
export const ROUND_STATUS_SHEET_VALUE: Record<RoundStatus, string> = {
  ready: 'READY',
  pass: 'TRUE',
  fail: 'FALSE',
  absent: 'Non',
};

export type Contestant = {
  id: string;
  number: string;
  name1: string;
  name2: string;
  // 역할 — '리더' or '팔로워' (or empty for solo / unspecified).
  role?: string;
  // 사진 — public image URL when present in sheet. Empty string treated as
  // missing → UI shows a number-based placeholder.
  photoUrl?: string;
  // Optional prefill: current sheet value parsed for this round.
  // null = empty cell (treated as ready).
  outcome?: RoundStatus | null;
  // 결승(final) 라운드 — 본인(심사위원) 이 DB에 저장해 둔 점수.
  // Partial: 비활성 criterion 키는 아예 안 들어오거나 null.
  finalScores?: Partial<Record<FinalCriterion, number | null>>;
};

export type PassFailEntry = {
  contestantId: string;
  status: 'pass' | 'fail' | 'absent';
};

// Final-round submit payload. Each active criterion gets a
// FINAL_SCORE_MIN..FINAL_SCORE_MAX integer. Disabled criteria simply omit
// the key.
export type FinalEntry = {
  contestantId: string;
} & Partial<Record<FinalCriterion, number>>;

// Design Ref: §12 Q2 — final score range. 0 점 입력도 허용(운영자 요청).
// UI inputs read these constants; total denominator = MAX * 활성 기준 수.
export const FINAL_SCORE_MIN = 0;
export const FINAL_SCORE_MAX = 10;
// 결승 점수 입력 기본값 — 휠 picker 가 처음 노출될 때의 시드 값.
export const FINAL_SCORE_DEFAULT = 5;

export type RoundEntry<R extends Round> = R extends 'final'
  ? FinalEntry
  : PassFailEntry;

export type SubmitPayload<R extends Round = Round> = {
  judgeId: string;
  round: R;
  entries: Array<RoundEntry<R>>;
};

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function isFinalEntry(
  entry: PassFailEntry | FinalEntry,
): entry is FinalEntry {
  // PassFailEntry has `status`, FinalEntry never does. Use the absence of
  // `status` to discriminate so disabling 'basics' still works.
  return !('status' in entry);
}

export function totalFinalScore(e: FinalEntry): number {
  let sum = 0;
  for (const k of FINAL_CRITERIA) {
    const v = e[k];
    if (typeof v === 'number') sum += v;
  }
  return sum;
}
