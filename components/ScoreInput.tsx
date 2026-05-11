// Design Ref: §7.2 final — 1..FINAL_SCORE_MAX 점수 휠(스크롤) picker.
// 셀 안에서 세로 스크롤(터치 swipe / 마우스 휠 / 클릭) 만으로 1~100 사이의
// 점수를 선택한다. iOS picker 스타일 — scroll-snap 으로 가운데 행이 선택값.

'use client';

import * as React from 'react';
import {
  FINAL_SCORE_DEFAULT,
  FINAL_SCORE_MAX,
  FINAL_SCORE_MIN,
} from '../lib/sheet-schema';

type Props = {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
};

const ROW_HEIGHT = 40; // 각 점수 행의 높이(px). 컨테이너 높이 = ROW_HEIGHT * 3.
const VISIBLE_ROWS = 3; // 위 1 / 가운데 1 (선택) / 아래 1.

export function ScoreInput({
  label,
  value,
  onChange,
  disabled = false,
  invalid = false,
}: Props): React.ReactElement {
  const id = React.useId();
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // 사용자가 스크롤 중인지 — 스크롤 종료 후에만 onChange 호출.
  const settleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 외부 value 변경(초기값/외부 reset) 을 내부 스크롤 위치에 반영할 때
  // 발생하는 onScroll 콜백을 자기 변경으로 인식해 onChange 재호출을 막는다.
  const programmaticScrollRef = React.useRef(false);

  const scores = React.useMemo(() => {
    const arr: number[] = [];
    for (let n = FINAL_SCORE_MIN; n <= FINAL_SCORE_MAX; n++) arr.push(n);
    return arr;
  }, []);

  const indexFor = (n: number) => n - FINAL_SCORE_MIN;
  const scoreFor = (idx: number) => FINAL_SCORE_MIN + idx;

  // value 가 null 인 경우 기본값(5점)으로 즉시 시드 — 휠 picker 가 항상
  // 어떤 값에 정렬된 채로 노출되도록 보장한다.
  React.useEffect(() => {
    if (value === null && !disabled) onChange(FINAL_SCORE_DEFAULT);
    // disabled/onChange 변경에 반응할 필요는 없다 — value 가 null 인 경우만 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // value 가 외부에서 바뀌면 스크롤 위치 동기화.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const seed = value ?? FINAL_SCORE_DEFAULT;
    const target = indexFor(seed) * ROW_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      programmaticScrollRef.current = true;
      el.scrollTop = target;
      // 다음 tick 에 플래그 해제 (programmatic onScroll 다 처리된 뒤).
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    }
  }, [value]);

  function handleScroll() {
    if (programmaticScrollRef.current) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollTop / ROW_HEIGHT);
      const clamped = Math.max(0, Math.min(scores.length - 1, idx));
      const next = scoreFor(clamped);
      if (next !== value) onChange(next);
    }, 90);
  }

  function handleSelect(n: number) {
    if (disabled) return;
    onChange(n);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--jnj-space-1)' }}>
      <label
        htmlFor={id}
        style={{
          fontFamily: 'var(--jnj-font-text-medium)',
          fontWeight: 500,
          fontSize: 'var(--jnj-size-small)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--jnj-text-secondary)',
        }}
      >
        {label}
      </label>
      <div
        id={id}
        role="listbox"
        aria-label={`${label} score selector (${FINAL_SCORE_MIN}~${FINAL_SCORE_MAX})`}
        aria-activedescendant={value !== null ? `${id}-opt-${value}` : undefined}
        className={['jnj-input', invalid ? 'jnj-input--error' : '']
          .filter(Boolean)
          .join(' ')}
        style={{
          position: 'relative',
          padding: 0,
          height: ROW_HEIGHT * VISIBLE_ROWS,
          background: 'var(--jnj-grey-100)',
          overflow: 'hidden',
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
        }}
      >
        {/* 가운데 선택 영역 강조 라인 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: ROW_HEIGHT,
            height: ROW_HEIGHT,
            borderTop: '1px solid var(--jnj-grey-300)',
            borderBottom: '1px solid var(--jnj-grey-300)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          style={{
            height: '100%',
            overflowY: 'auto',
            scrollSnapType: 'y mandatory',
            scrollbarWidth: 'none',
            // 위/아래 1행씩 비워둠 → 첫/마지막 점수도 가운데에 올 수 있게.
            paddingTop: ROW_HEIGHT,
            paddingBottom: ROW_HEIGHT,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {scores.map((n) => {
            const selected = n === value;
            return (
              <button
                id={`${id}-opt-${n}`}
                key={n}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(n)}
                style={{
                  appearance: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: ROW_HEIGHT,
                  border: 'none',
                  background: 'transparent',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontFamily: selected
                    ? 'var(--jnj-font-display)'
                    : 'var(--jnj-font-text-medium)',
                  fontSize: selected
                    ? 'var(--jnj-size-h2)'
                    : 16,
                  fontWeight: selected ? 600 : 400,
                  color: selected
                    ? 'var(--jnj-text-primary)'
                    : 'var(--jnj-text-secondary)',
                  scrollSnapAlign: 'center',
                  scrollSnapStop: 'always',
                  transition: 'font-size 120ms ease, color 120ms ease',
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <style>{`
          /* 휠 영역의 WebKit 스크롤바 숨김 */
          .jnj-input [role="listbox"] > div::-webkit-scrollbar { display: none; }
        `}</style>
      </div>
    </div>
  );
}

export function isValidScore(n: number | null): n is number {
  if (n === null) return false;
  if (!Number.isInteger(n)) return false;
  return n >= FINAL_SCORE_MIN && n <= FINAL_SCORE_MAX;
}
