// Design Ref: §5 routing — single dynamic route, branches by `round`.
// Plan SC-02 (pass/fail records), SC-03 (final scores), SC-04 (P95 ≤ 3s),
// SC-07 (network-failure resilience via localStorage drafts).

'use client';

import { notFound, useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { JudgeBadge } from '../../../components/JudgeBadge';
import { LoadingSkeleton } from '../../../components/LoadingSkeleton';
import { NavBar } from '../../../components/NavBar';
import {
  PassFailToggle,
  type RowStatus,
} from '../../../components/PassFailToggle';
import { ScoreInput, isValidScore } from '../../../components/ScoreInput';
import { ToastViewport, useToasts } from '../../../components/Toast';
import { useCompetition } from '../../../hooks/useCompetition';
import { useDraft } from '../../../hooks/useDraft';
import { useJudge } from '../../../hooks/useJudge';
import {
  AppsScriptError,
  getEvent,
  getJudges,
  getRound,
  submitRound,
} from '../../../lib/apps-script';
import {
  contestantMatchesTarget,
  FINAL_SCORE_DEFAULT,
  FINAL_SCORE_MAX,
  isRoundInteractive,
  ROUND_LABEL,
  ROUND_LIFECYCLE_LABEL,
  ROUND_STATUS_LABEL,
  ROUNDS,
  type Contestant,
  type FinalEntry,
  type JudgeVoteTarget,
  type PassFailEntry,
  type Round,
  type RoundLifecycle,
  type RoundStatus,
  totalFinalScore,
} from '../../../lib/sheet-schema';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; contestants: Contestant[] }
  | { kind: 'error'; message: string };

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'locked' };

export default function RoundPage() {
  const params = useParams<{ round: string }>();
  const round = params.round as Round;

  if (!ROUNDS.includes(round)) notFound();

  const { judge, hydrated } = useJudge({ requireJudge: true });
  const { competition, hydrated: compHydrated } = useCompetition({
    requireSelection: true,
  });
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  // 시트의 `1.대회정보` 라운드별 대회 상태. 'open'으로 낙관적 시작 — 실패해도
  // 채점 페이지가 막히지 않도록 한다(시트 일시적 장애 시 운영 지속).
  const [lifecycle, setLifecycle] = useState<RoundLifecycle>('open');
  // 본인의 `대상` (모두/리더/팔로워) — 매 로드마다 시트에서 fresh 하게 가져온다.
  // localStorage 의 voteTarget 이 legacy(undefined) 이거나 운영자가 시트에서
  // 변경한 경우에도 즉시 반영되도록 한다. 초기값은 localStorage 또는 'all'.
  const [voteTarget, setVoteTarget] = useState<JudgeVoteTarget>(
    judge?.voteTarget ?? 'all',
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!hydrated || !compHydrated || !judge) return;
    let cancelled = false;
    setLoaded({ kind: 'loading' });
    Promise.all([
      getRound(round, competition?.masterFileId, judge?.id),
      // 라운드 상태도 함께 갱신해, 운영자가 시트에서 'Close'로 바꾸면 즉시 반영.
      getEvent(competition?.masterFileId).catch(() => null),
      // 본인의 `대상` 컬럼을 fresh 하게 — legacy localStorage 호환 + 시트
      // 변경 즉시 반영. 실패 시 기존 값 유지(채점 페이지 자체는 막지 않음).
      getJudges(competition?.masterFileId).catch(() => null),
    ])
      .then(([cs, ev, judges]) => {
        if (cancelled) return;
        if (ev) setLifecycle(ev.roundStatus[round]);
        if (judges) {
          const me = judges.find((j) => j.id === judge.id);
          if (me) setVoteTarget(me.voteTarget ?? 'all');
        }
        setLoaded({ kind: 'ready', contestants: cs });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({ kind: 'error', message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, compHydrated, judge, round, competition?.masterFileId, reloadKey]);

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 'var(--jnj-space-5) var(--jnj-space-4) calc(var(--jnj-space-10) + env(safe-area-inset-bottom, 0px))',
        maxWidth: 720,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-5)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--jnj-space-3)',
        }}
      >
        <NavBar
          loading={loaded.kind === 'loading'}
          back="/event"
          onRefresh={() => {
            // 갱신 = 시트가 진실의 원천. 시트의 본인(심사위원) O/X 값을 다시
            // 읽어 VOTE ON/OFF 토글에 반영해야 하므로 localStorage draft 를
            // 먼저 비운다. (draft 가 남아있으면 useDraft 가 시트 outcome 시드를
            // 덮어써 이전에 화면에서 누른 값이 그대로 보인다.)
            if (judge) {
              try {
                window.localStorage.removeItem(`jnj.draft.${round}.${judge.id}`);
              } catch {
                // 무시 — quota / disabled storage
              }
            }
            // 제출 잠금/수정 상태도 초기화하기 위해 reloadKey 증가 → 본문 재마운트.
            setReloadKey((k) => k + 1);
          }}
        />
        <JudgeBadge />
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--jnj-space-2)' }}>
        <span
          className="jnj-small"
          style={{ color: 'var(--jnj-text-secondary)', letterSpacing: '0.08em' }}
        >
          ROUND
        </span>
        <h1
          style={{
            fontFamily: 'var(--jnj-font-display)',
            fontSize: 'clamp(40px, 11vw, 88px)',
            fontWeight: 500,
            lineHeight: 0.9,
            letterSpacing: '-0.01em',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          {ROUND_LABEL[round]}
        </h1>
      </section>

      {loaded.kind === 'loading' && <LoadingSkeleton count={5} height={72} />}
      {loaded.kind === 'error' && (
        <ErrorBlock
          message={loaded.message}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      )}
      {loaded.kind === 'ready' && judge && (
        <>
          {lifecycle !== 'live' && <LifecycleBanner round={round} lifecycle={lifecycle} />}
          <RoundBody
            // 갱신(reloadKey 증가) 시 본문을 강제 재마운트해, useDraft 가
            // 비워진 localStorage 대신 시트 outcome 으로 깨끗이 시드되도록 한다.
            key={`${round}-${reloadKey}`}
            round={round}
            contestants={loaded.contestants}
            judgeId={judge.id}
            sheetId={competition?.masterFileId}
            maxPrelimVotes={judge.maxPrelimVotes}
            maxSemiVotes={judge.maxSemiVotes}
            voteTarget={voteTarget}
            lifecycle={lifecycle}
          />
        </>
      )}
    </main>
  );
}

function LifecycleBanner({
  round,
  lifecycle,
}: {
  round: Round;
  lifecycle: RoundLifecycle;
}) {
  // OPEN 만 "시작 전 안내"(중립 톤). 그 외 비-LIVE 상태는 입력 잠금(경고 톤).
  const isOpen = lifecycle === 'open';
  const message = isOpen
    ? `${ROUND_LABEL[round]} round has not started yet (${ROUND_LIFECYCLE_LABEL[lifecycle]}). Wait for the operator to set it to 'Live', then refresh.`
    : `${ROUND_LABEL[round]} round is ${ROUND_LIFECYCLE_LABEL[lifecycle]} — input and submission are locked.`;
  return (
    <div
      role="status"
      style={{
        padding: 'var(--jnj-space-3) var(--jnj-space-4)',
        borderRadius: 'var(--jnj-radius-md)',
        border: `1px solid ${isOpen ? 'var(--jnj-grey-300)' : 'var(--jnj-red)'}`,
        background: isOpen ? 'var(--jnj-grey-50)' : 'var(--jnj-red-50)',
        color: isOpen ? 'var(--jnj-text-primary)' : 'var(--jnj-red)',
        fontFamily: 'var(--jnj-font-text-medium)',
        fontSize: 'var(--jnj-size-small)',
      }}
    >
      {message}
    </div>
  );
}

function RoundBody({
  round,
  contestants,
  judgeId,
  sheetId,
  maxPrelimVotes,
  maxSemiVotes,
  voteTarget,
  lifecycle,
}: {
  round: Round;
  contestants: Contestant[];
  judgeId: string;
  sheetId?: string;
  maxPrelimVotes?: number;
  maxSemiVotes?: number;
  voteTarget: JudgeVoteTarget;
  lifecycle: RoundLifecycle;
}) {
  const toastApi = useToasts();
  // `2.심사위원` 의 `대상` 컬럼에 따라 본인 채점 대상만 화면에 노출.
  // 'all' = 전부, 'leader' = 리더만, 'follower' = 팔로워만. 모든 라운드 동일 적용.
  // 헬퍼(리더)/헬퍼(팔로워) 등 헬퍼 역할은 채점 대상이 아니므로 목록에서 제외.
  // 시트 값에 보이지 않는 공백/제어문자가 섞일 수 있어 includes 로 관대하게 매칭.
  const visible = useMemo(
    () =>
      contestants.filter(
        (c) =>
          !(c.role ?? '').includes('헬퍼') &&
          contestantMatchesTarget(c.role, voteTarget),
      ),
    [contestants, voteTarget],
  );
  if (round === 'final') {
    return (
      <FinalBody
        contestants={visible}
        judgeId={judgeId}
        sheetId={sheetId}
        lifecycle={lifecycle}
        {...toastApi}
      />
    );
  }
  const maxVotes = round === 'prelim' ? maxPrelimVotes : maxSemiVotes;
  return (
    <PassFailBody
      round={round}
      contestants={visible}
      judgeId={judgeId}
      sheetId={sheetId}
      maxVotes={maxVotes}
      lifecycle={lifecycle}
      {...toastApi}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass/Fail (prelim, semi)
// ─────────────────────────────────────────────────────────────────────────────

// 'absent' is a sheet-side status only — judges set pass/fail via UI; absent
// (Non) is recorded externally and shown via the read-only StatusBadge.
type Verdict = 'pass' | 'fail';
type PassFailDraft = Record<string, Verdict | null>;

function PassFailBody({
  round,
  contestants,
  judgeId,
  sheetId,
  maxVotes,
  lifecycle,
  toasts,
  push,
  dismiss,
}: {
  round: Exclude<Round, 'final'>;
  contestants: Contestant[];
  judgeId: string;
  sheetId?: string;
  maxVotes?: number;
  lifecycle: RoundLifecycle;
  toasts: ReturnType<typeof useToasts>['toasts'];
  push: ReturnType<typeof useToasts>['push'];
  dismiss: ReturnType<typeof useToasts>['dismiss'];
}) {
  // 입력/반영은 OPEN/LIVE 에서만 허용. 그 외(prep/pairing/calculate/close/result)는 잠금.
  const submitBlocked = !isRoundInteractive(lifecycle);
  const draftKey = `jnj.draft.${round}.${judgeId}`;
  const initial: PassFailDraft = useMemo(() => {
    const o: PassFailDraft = {};
    // Prefill from sheet outcome; READY/null = no toggle preselected.
    for (const c of contestants) {
      o[c.id] = outcomeToVerdict(c.outcome);
    }
    return o;
  }, [contestants]);
  const { value: draft, setValue: setDraft, clear } = useDraft<PassFailDraft>(
    draftKey,
    initial,
  );
  // Single batch submit — one 반영 button at the bottom for all rows.
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });
  const locked = submitState.kind === 'locked';
  const submitting = submitState.kind === 'submitting';

  // Ensure every contestant has a verdict — if missing or null (e.g. stale
  // localStorage from before the 'fail' default was added), seed from sheet
  // outcome (READY → 'fail').
  useEffect(() => {
    setDraft((cur) => {
      const next: PassFailDraft = { ...cur };
      let changed = false;
      for (const c of contestants) {
        if (next[c.id] == null) {
          next[c.id] = outcomeToVerdict(c.outcome);
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [contestants, setDraft]);

  const total = contestants.length;
  const votableContestants = useMemo(
    () => contestants.filter((c) => c.outcome !== 'absent'),
    [contestants],
  );
  const voteOnCount = useMemo(
    () =>
      votableContestants.filter((c) => draft[c.id] === 'pass').length,
    [votableContestants, draft],
  );
  // Vote-cap accounting. When `maxVotes` is undefined (legacy judge in
  // localStorage), treat as unlimited — Infinity remaining, gating disabled.
  const cap = typeof maxVotes === 'number' ? maxVotes : Infinity;
  const remaining = cap - voteOnCount;
  const capExhausted = remaining <= 0 && Number.isFinite(cap);

  function handleVoteChange(c: Contestant, next: Verdict | null) {
    const current = draft[c.id] ?? null;
    // Block ON when cap reached. OFF→ON only allowed when remaining > 0.
    if (
      next === 'pass' &&
      current !== 'pass' &&
      Number.isFinite(cap) &&
      voteOnCount >= cap
    ) {
      push(
        'error',
        `Vote cap (${cap}) exceeded — turn OFF another contestant's vote first.`,
      );
      return;
    }
    setDraft((cur) => ({ ...cur, [c.id]: next }));
  }

  function handleSubmit() {
    if (submitBlocked) {
      push(
        'error',
        `Round is ${ROUND_LIFECYCLE_LABEL[lifecycle]} — submission is only allowed in OPEN/LIVE.`,
      );
      return;
    }
    const entries: (PassFailEntry & { pass: boolean })[] = [];
    for (const c of votableContestants) {
      const val = draft[c.id] ?? 'fail';
      // Send both `status` (new) and `pass` (legacy) for Apps Script back-compat.
      entries.push({
        contestantId: c.id,
        status: val,
        pass: val === 'pass',
      });
    }
    if (entries.length === 0) {
      push('error', 'No contestants to submit.');
      return;
    }
    setSubmitState({ kind: 'submitting' });
    submitRound({ judgeId, round, entries }, sheetId)
      .then((res) => {
        setSubmitState({ kind: 'locked' });
        push('success', `Saved ${res.written}.`);
        clear();
      })
      .catch((err) => {
        setSubmitState({ kind: 'idle' });
        push('error', errorMessage(err));
      });
  }

  return (
    <>
      <VoteCounter
        used={voteOnCount}
        cap={cap}
        round={round}
      />
      <ProgressLine done={voteOnCount} total={total} />

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--jnj-space-2)',
        }}
      >
        {contestants.map((c, i) => {
          const verdict = draft[c.id];
          const isAbsent = c.outcome === 'absent';
          // While locked (post-submit), reflect the just-submitted verdict in
          // the badge instead of the stale sheet snapshot from page load.
          const displayedStatus: RoundStatus =
            locked && verdict
              ? verdict
              : c.outcome ?? 'ready';
          const rowStatus: RowStatus = locked
            ? 'saved'
            : submitting
              ? 'submitting'
              : 'idle';
          return (
            <li
              key={c.id}
              style={{
                padding: 'var(--jnj-space-3) 0',
                borderTop:
                  i === 0 ? 'none' : '1px solid var(--jnj-grey-200)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--jnj-space-3)',
                opacity: isAbsent ? 0.45 : locked ? 0.7 : 1,
                pointerEvents: isAbsent ? 'none' : 'auto',
              }}
              aria-disabled={isAbsent || undefined}
            >
              <div
                style={{
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--jnj-space-3)',
                }}
              >
                <ContestantAvatar
                  photoUrl={c.photoUrl}
                  number={c.number}
                  size={56}
                />
                <div
                  style={{
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--jnj-space-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--jnj-font-display)',
                      fontSize: 'clamp(28px, 6vw, 36px)',
                      fontWeight: 500,
                      lineHeight: 1,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    #{c.number}
                  </span>
                  {c.role && <RoleBadge role={c.role} />}
                  {/* Hide PASS/READY/FAIL badges — only surface ABSENT for visual disability cue. */}
                  {displayedStatus === 'absent' && (
                    <StatusBadge value={displayedStatus} />
                  )}
                </div>
              </div>
              <PassFailToggle
                value={draft[c.id] ?? null}
                status={rowStatus}
                disabled={
                  isAbsent ||
                  submitting ||
                  submitBlocked ||
                  // Once cap reached, freeze rows that are still OFF so judge
                  // can only flip OFF on already-ON rows to free up budget.
                  (capExhausted && draft[c.id] !== 'pass')
                }
                onChange={(next) => handleVoteChange(c, next)}
              />
            </li>
          );
        })}
      </ul>

      <SubmitFooter
        primaryLabel={
          submitBlocked
            ? `Locked (${ROUND_LIFECYCLE_LABEL[lifecycle]})`
            : submitting
              ? 'Saving…'
              : locked
                ? 'Saved'
                : `Submit (VOTE ON ${voteOnCount}/${total})`
        }
        onPrimary={locked || submitBlocked ? undefined : handleSubmit}
        disabled={submitting || locked || submitBlocked}
        secondary={
          locked
            ? { label: 'Edit', onClick: () => setSubmitState({ kind: 'idle' }) }
            : undefined
        }
      />

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Final scores
// ─────────────────────────────────────────────────────────────────────────────

type FinalDraft = Record<
  string,
  { basics: number | null; connection: number | null; musicality: number | null }
>;

function FinalBody({
  contestants,
  judgeId,
  sheetId,
  lifecycle,
  toasts,
  push,
  dismiss,
}: {
  contestants: Contestant[];
  judgeId: string;
  sheetId?: string;
  lifecycle: RoundLifecycle;
  toasts: ReturnType<typeof useToasts>['toasts'];
  push: ReturnType<typeof useToasts>['push'];
  dismiss: ReturnType<typeof useToasts>['dismiss'];
}) {
  // 결승 점수 입력/반영도 OPEN/LIVE 에서만 허용. 그 외 상태는 잠금.
  const submitBlocked = !isRoundInteractive(lifecycle);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' });
  const draftKey = `jnj.draft.final.${judgeId}`;

  // 결승은 useDraft 를 사용하지 않는다 — useDraft 의 mount 후 hydrate 가
  // localStorage 의 이전 값(예: 5점) 으로 시트 시드를 덮어쓰는 race condition
  // 때문이다. 결승은 시트가 진실의 원천이므로 contestants(시트 응답) 기반으로
  // 직접 state 를 시드하고, 사용자 입력은 별도 effect 로 localStorage 에 백업.
  function seedFromContestants(list: Contestant[]): FinalDraft {
    const o: FinalDraft = {};
    for (const c of list) {
      const fs = c.finalScores;
      o[c.id] = {
        basics: fs?.basics ?? FINAL_SCORE_DEFAULT,
        connection: fs?.connection ?? FINAL_SCORE_DEFAULT,
        musicality: fs?.musicality ?? FINAL_SCORE_DEFAULT,
      };
    }
    return o;
  }
  const [draft, setDraft] = useState<FinalDraft>(() =>
    seedFromContestants(contestants),
  );
  // contestants 가 새로 들어오면(=API 재조회 = 갱신 버튼) 무조건 시트값으로 reseed.
  const lastContestantsRef = useRef(contestants);
  useEffect(() => {
    if (lastContestantsRef.current !== contestants) {
      lastContestantsRef.current = contestants;
      setDraft(seedFromContestants(contestants));
    }
  }, [contestants]);
  // draft 변경 시 localStorage 에 백업(네트워크 오류 복구용).
  useEffect(() => {
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, draftKey]);
  function clear() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  const validCount = useMemo(
    () =>
      contestants.filter((c) => {
        const e = draft[c.id];
        return (
          e &&
          isValidScore(e.basics) &&
          isValidScore(e.connection) &&
          isValidScore(e.musicality)
        );
      }).length,
    [contestants, draft],
  );
  const total = contestants.length;
  const locked = submitState.kind === 'locked';
  const submitting = submitState.kind === 'submitting';
  const allValid = validCount === total && total > 0;

  function handleSubmit() {
    if (submitBlocked) {
      push(
        'error',
        `Round is ${ROUND_LIFECYCLE_LABEL[lifecycle]} — submission is only allowed in OPEN/LIVE.`,
      );
      return;
    }
    const entries: FinalEntry[] = [];
    for (const c of contestants) {
      const e = draft[c.id];
      if (
        !e ||
        !isValidScore(e.basics) ||
        !isValidScore(e.connection) ||
        !isValidScore(e.musicality)
      ) {
        push('error', `#${c.number} score is empty.`);
        return;
      }
      entries.push({
        contestantId: c.id,
        basics: e.basics,
        connection: e.connection,
        musicality: e.musicality,
      });
    }

    setSubmitState({ kind: 'submitting' });
    submitRound({ judgeId, round: 'final', entries }, sheetId)
      .then((res) => {
        push('success', `Saved ${res.written}.`);
        setSubmitState({ kind: 'locked' });
        clear();
      })
      .catch((err) => {
        setSubmitState({ kind: 'idle' });
        push('error', errorMessage(err));
      });
  }

  return (
    <>
      <ProgressLine done={validCount} total={total} />

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--jnj-space-5)',
        }}
      >
        {contestants.map((c) => {
          const entry =
            draft[c.id] ?? {
              basics: FINAL_SCORE_DEFAULT,
              connection: FINAL_SCORE_DEFAULT,
              musicality: FINAL_SCORE_DEFAULT,
            };
          const sum = totalFinalScore({
            contestantId: c.id,
            basics: entry.basics ?? 0,
            connection: entry.connection ?? 0,
            musicality: entry.musicality ?? 0,
          });
          const allFilled =
            isValidScore(entry.basics) &&
            isValidScore(entry.connection) &&
            isValidScore(entry.musicality);
          return (
            <li
              key={c.id}
              style={{
                padding: 'var(--jnj-space-4)',
                borderRadius: 'var(--jnj-radius-lg)',
                border: '1px solid var(--jnj-grey-200)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--jnj-space-3)',
                opacity: allFilled ? 1 : 0.85,
                background: 'var(--jnj-white)',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--jnj-space-3)',
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--jnj-space-3)',
                  }}
                >
                  <ContestantAvatar
                    photoUrl={c.photoUrl}
                    number={c.number}
                    size={64}
                  />
                  <div
                    style={{
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--jnj-space-2)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--jnj-font-display)',
                        fontSize: 'clamp(32px, 7vw, 44px)',
                        fontWeight: 500,
                        lineHeight: 1,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      #{c.number}
                    </span>
                    {c.role && <RoleBadge role={c.role} />}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--jnj-font-display)',
                    fontSize: 32,
                    lineHeight: 1,
                    color: allFilled
                      ? 'var(--jnj-text-primary)'
                      : 'var(--jnj-text-disabled)',
                  }}
                >
                  {allFilled ? sum : '—'}
                  <span
                    style={{
                      fontFamily: 'var(--jnj-font-text-medium)',
                      fontSize: 'var(--jnj-size-small)',
                      letterSpacing: '0.08em',
                      marginLeft: 6,
                      color: 'var(--jnj-text-secondary)',
                    }}
                  >
                    /{FINAL_SCORE_MAX * 3}
                  </span>
                </div>
              </header>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 'var(--jnj-space-3)',
                }}
              >
                <ScoreInput
                  label="Basics"
                  value={entry.basics}
                  invalid={entry.basics !== null && !isValidScore(entry.basics)}
                  disabled={locked || submitting || submitBlocked}
                  onChange={(n) =>
                    setDraft((cur) => ({
                      ...cur,
                      [c.id]: { ...cur[c.id]!, basics: n },
                    }))
                  }
                />
                <ScoreInput
                  label="Connection"
                  value={entry.connection}
                  invalid={
                    entry.connection !== null && !isValidScore(entry.connection)
                  }
                  disabled={locked || submitting || submitBlocked}
                  onChange={(n) =>
                    setDraft((cur) => ({
                      ...cur,
                      [c.id]: { ...cur[c.id]!, connection: n },
                    }))
                  }
                />
                <ScoreInput
                  label="Musicality"
                  value={entry.musicality}
                  invalid={
                    entry.musicality !== null && !isValidScore(entry.musicality)
                  }
                  disabled={locked || submitting || submitBlocked}
                  onChange={(n) =>
                    setDraft((cur) => ({
                      ...cur,
                      [c.id]: { ...cur[c.id]!, musicality: n },
                    }))
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>

      <SubmitFooter
        primaryLabel={
          submitBlocked
            ? `Locked (${ROUND_LIFECYCLE_LABEL[lifecycle]})`
            : submitting
              ? 'Saving…'
              : locked
                ? 'Saved'
                : `Submit (${validCount}/${total})`
        }
        onPrimary={locked || submitBlocked ? undefined : handleSubmit}
        disabled={submitting || submitBlocked || (!allValid && !locked)}
        secondary={
          locked
            ? { label: 'Edit', onClick: () => setSubmitState({ kind: 'idle' }) }
            : undefined
        }
      />

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI bits
// ─────────────────────────────────────────────────────────────────────────────

function outcomeToVerdict(o: RoundStatus | null | undefined): Verdict | null {
  if (o === 'pass' || o === 'fail') return o;
  // READY (or absent / unknown) defaults the VOTE switch to OFF (= 'fail');
  // the judge explicitly flips to ON (= 'pass') to cast a vote.
  return 'fail';
}

function ContestantAvatar({
  photoUrl,
  number,
  size,
}: {
  photoUrl?: string;
  number: string;
  size: number;
}) {
  // Number-derived stable placeholder (5 monochrome shades from design tokens).
  const palette = [
    'var(--jnj-grey-200)',
    'var(--jnj-grey-300)',
    'var(--jnj-grey-500)',
    'var(--jnj-text-primary)',
    'var(--jnj-grey-600, #707072)',
  ];
  const numHash = parseInt(number.replace(/\D/g, ''), 10) || 0;
  const bg = palette[numHash % palette.length];
  // White text for the two darkest shades.
  const dark = bg.includes('text-primary') || bg.includes('500') || bg.includes('600');
  const fg = dark ? 'var(--jnj-white)' : 'var(--jnj-text-primary)';
  const common: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    border: '1px solid var(--jnj-grey-200)',
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: bg,
    color: fg,
    fontFamily: 'var(--jnj-font-display)',
    fontSize: Math.round(size * 0.4),
    fontWeight: 500,
    letterSpacing: '0.02em',
    lineHeight: 1,
  };
  if (photoUrl) {
    return (
      <span style={common} aria-label={`Contestant ${number} photo`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={`#${number}`}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
          onError={(e) => {
            // Hide broken image; placeholder bg + number remain visible.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </span>
    );
  }
  return (
    <span style={common} aria-label={`Contestant ${number}`}>
      {number.replace(/^0+/, '') || number}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  // Only LEADER/FOLLOWER render — helper rows (헬퍼(리더)/헬퍼(팔로워)) and others stay unbadged.
  const isLeader = role === '리더' || role.toLowerCase() === 'leader';
  const isFollower = role === '팔로워' || role.toLowerCase() === 'follower';
  if (!isLeader && !isFollower) return null;
  let bg: string;
  let fg: string;
  let border: string;
  let label: string;
  if (isLeader) {
    bg = 'var(--jnj-text-primary)';
    fg = 'var(--jnj-white)';
    border = '1px solid var(--jnj-text-primary)';
    label = 'LEADER';
  } else {
    bg = 'var(--jnj-white)';
    fg = 'var(--jnj-text-primary)';
    border = '1px solid var(--jnj-text-primary)';
    label = 'FOLLOWER';
  }
  return (
    <span
      aria-label={`Role ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: bg,
        color: fg,
        border,
        fontFamily: 'var(--jnj-font-text-medium)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.06em',
        padding: '2px 8px',
        borderRadius: 'var(--jnj-radius-pill)',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ value }: { value: RoundStatus }) {
  const palette: Record<RoundStatus, { bg: string; fg: string }> = {
    ready: { bg: 'var(--jnj-grey-100)', fg: 'var(--jnj-grey-600)' },
    pass: { bg: 'var(--jnj-green)', fg: 'var(--jnj-white)' },
    fail: { bg: 'var(--jnj-red)', fg: 'var(--jnj-white)' },
    absent: { bg: 'var(--jnj-grey-500)', fg: 'var(--jnj-white)' },
  };
  const c = palette[value];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: c.bg,
        color: c.fg,
        fontFamily: 'var(--jnj-font-text-medium)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.06em',
        padding: '2px 8px',
        borderRadius: 'var(--jnj-radius-pill)',
        textTransform: 'uppercase',
      }}
    >
      {ROUND_STATUS_LABEL[value]}
    </span>
  );
}

function ProgressLine({ done, total }: { done: number; total: number }) {
  return (
    <div
      className="jnj-small"
      style={{
        color: 'var(--jnj-text-secondary)',
        letterSpacing: '0.06em',
      }}
    >
      {done} / {total}
    </div>
  );
}

function VoteCounter({
  used,
  cap,
  round,
}: {
  used: number;
  cap: number;
  round: Exclude<Round, 'final'>;
}) {
  // No cap configured for this judge → hide counter (legacy / missing column).
  if (!Number.isFinite(cap)) return null;
  const remaining = Math.max(0, cap - used);
  const exhausted = remaining === 0;
  return (
    <section
      aria-label="VOTE budget"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 'var(--jnj-space-3)',
        padding: 'var(--jnj-space-4)',
        borderRadius: 'var(--jnj-radius-lg)',
        border: `1.5px solid ${exhausted ? 'var(--jnj-red)' : 'var(--jnj-text-primary)'}`,
        background: exhausted ? 'var(--jnj-red-50, #FFF1F1)' : 'var(--jnj-white)',
        transition: 'border-color var(--jnj-transition), background var(--jnj-transition)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          className="jnj-small"
          style={{
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--jnj-text-secondary)',
          }}
        >
          {round === 'prelim' ? 'Prelim' : 'Semi'} · Votes Left
        </span>
        <span
          style={{
            fontFamily: 'var(--jnj-font-display)',
            fontSize: 48,
            fontWeight: 500,
            lineHeight: 1,
            color: exhausted
              ? 'var(--jnj-red)'
              : 'var(--jnj-text-primary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {remaining}
          <span
            style={{
              fontFamily: 'var(--jnj-font-text-medium)',
              fontSize: 'var(--jnj-size-small)',
              letterSpacing: '0.08em',
              marginLeft: 8,
              color: 'var(--jnj-text-secondary)',
            }}
          >
            / {cap}
          </span>
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 4,
          minWidth: 0,
        }}
      >
        <span
          className="jnj-small"
          style={{
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--jnj-text-secondary)',
          }}
        >
          Vote On
        </span>
        <span
          style={{
            fontFamily: 'var(--jnj-font-text-medium)',
            fontSize: 'var(--jnj-size-h3)',
            fontWeight: 500,
            color: 'var(--jnj-green)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {used}
        </span>
        {exhausted && (
          <span
            className="jnj-small"
            style={{
              color: 'var(--jnj-red)',
              fontFamily: 'var(--jnj-font-text-medium)',
              letterSpacing: '0.04em',
            }}
          >
            Cap Reached
          </span>
        )}
      </div>
    </section>
  );
}

function SubmitFooter({
  primaryLabel,
  onPrimary,
  disabled,
  secondary,
}: {
  primaryLabel: string;
  onPrimary?: () => void;
  disabled: boolean;
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 'env(safe-area-inset-bottom, 0px)',
        marginInline: 'calc(-1 * var(--jnj-space-4))',
        padding: 'var(--jnj-space-3) var(--jnj-space-4) calc(var(--jnj-space-3) + env(safe-area-inset-bottom, 0px))',
        background: 'var(--jnj-white)',
        boxShadow: '0px -1px 0px 0px var(--jnj-grey-200) inset',
        display: 'flex',
        gap: 'var(--jnj-space-2)',
      }}
    >
      {secondary && (
        <button
          type="button"
          className="jnj-btn jnj-btn-secondary"
          onClick={secondary.onClick}
          style={{ flexShrink: 0 }}
        >
          {secondary.label}
        </button>
      )}
      <button
        type="button"
        className="jnj-btn jnj-btn-primary"
        onClick={onPrimary}
        disabled={disabled || !onPrimary}
        style={{ flex: 1 }}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--jnj-space-5)',
        border: '1px solid var(--jnj-red)',
        borderRadius: 'var(--jnj-radius-lg)',
        background: 'var(--jnj-red-50)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-3)',
      }}
    >
      <p
        className="jnj-body-medium"
        style={{ color: 'var(--jnj-red)', margin: 0 }}
      >
        {message}
      </p>
      <button
        type="button"
        className="jnj-btn jnj-btn-primary jnj-btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof AppsScriptError) {
    switch (err.code) {
      case 'NOT_CONFIGURED':
        return 'Apps Script URL not set. Update .env.local.';
      case 'TIMEOUT':
        return 'Server took too long. Try again.';
      case 'NETWORK':
        return 'No connection. Try again.';
      case 'API':
        return `Server: ${err.message}`;
      case 'HTTP':
        return `Server error: ${err.message}.`;
      default:
        return 'Couldn’t complete. Try again.';
    }
  }
  return 'Couldn’t complete. Try again.';
}
