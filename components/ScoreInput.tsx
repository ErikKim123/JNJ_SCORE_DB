// Design Ref: §7.2 final — 점수 stepper.
// 휠 스크롤 대신 좌(−)/우(+) 버튼으로 한 번 누를 때마다 1점씩 이동한다.
// 가운데에 현재 점수를 크게 표시. MIN~MAX 범위에서 clamp.

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

const HEIGHT = 56; // stepper 높이(px).

export function ScoreInput({
  label,
  value,
  onChange,
  disabled = false,
  invalid = false,
}: Props): React.ReactElement {
  const id = React.useId();

  // value 가 null 이면 기본값으로 시드 — 항상 어떤 값이 표시되도록.
  React.useEffect(() => {
    if (value === null && !disabled) onChange(FINAL_SCORE_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const current = value ?? FINAL_SCORE_DEFAULT;
  const canDec = !disabled && current > FINAL_SCORE_MIN;
  const canInc = !disabled && current < FINAL_SCORE_MAX;

  function step(delta: number) {
    if (disabled) return;
    const next = Math.max(
      FINAL_SCORE_MIN,
      Math.min(FINAL_SCORE_MAX, current + delta),
    );
    if (next !== value) onChange(next);
  }

  const arrowBtn: React.CSSProperties = {
    appearance: 'none',
    flex: '0 0 auto',
    width: HEIGHT,
    height: '100%',
    border: 'none',
    background: 'transparent',
    color: 'var(--jnj-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    lineHeight: 1,
    transition: 'color 120ms ease, opacity 120ms ease',
  };

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
        role="spinbutton"
        aria-label={`${label} score (${FINAL_SCORE_MIN}~${FINAL_SCORE_MAX})`}
        aria-valuemin={FINAL_SCORE_MIN}
        aria-valuemax={FINAL_SCORE_MAX}
        aria-valuenow={value ?? undefined}
        className={['jnj-input', invalid ? 'jnj-input--error' : '']
          .filter(Boolean)
          .join(' ')}
        style={{
          position: 'relative',
          width: '100%',
          minWidth: 0,
          padding: 0,
          height: HEIGHT,
          background: 'var(--jnj-grey-100)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'stretch',
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
        }}
      >
        <button
          type="button"
          aria-label={`${label} decrease`}
          onClick={() => step(-1)}
          disabled={!canDec}
          style={{
            ...arrowBtn,
            cursor: canDec ? 'pointer' : 'not-allowed',
            opacity: canDec ? 1 : 0.3,
          }}
        >
          −
        </button>
        <span
          aria-hidden
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--jnj-font-display)',
            fontSize: 'var(--jnj-size-h2)',
            fontWeight: 600,
            color: 'var(--jnj-text-primary)',
            fontVariantNumeric: 'tabular-nums',
            borderLeft: '1px solid var(--jnj-grey-300)',
            borderRight: '1px solid var(--jnj-grey-300)',
            background: 'var(--jnj-white)',
          }}
        >
          {current}
        </span>
        <button
          type="button"
          aria-label={`${label} increase`}
          onClick={() => step(1)}
          disabled={!canInc}
          style={{
            ...arrowBtn,
            cursor: canInc ? 'pointer' : 'not-allowed',
            opacity: canInc ? 1 : 0.3,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function isValidScore(n: number | null): n is number {
  if (n === null) return false;
  if (!Number.isInteger(n)) return false;
  return n >= FINAL_SCORE_MIN && n <= FINAL_SCORE_MAX;
}
