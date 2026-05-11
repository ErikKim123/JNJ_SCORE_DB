'use client';

import * as React from 'react';

type Verdict = 'pass' | 'fail' | null;
export type RowStatus = 'idle' | 'submitting' | 'saved';

type Props = {
  value: Verdict;
  onChange: (next: Verdict) => void;
  onSubmit?: () => void;
  status?: RowStatus;
  disabled?: boolean;
};

export function PassFailToggle({
  value,
  onChange,
  onSubmit,
  status = 'idle',
  disabled = false,
}: Props): React.ReactElement {
  const locked = status === 'saved';
  const submitting = status === 'submitting';
  const togglesDisabled = disabled || locked || submitting;
  const submitDisabled =
    disabled || locked || submitting || value === null || !onSubmit;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--jnj-space-2)',
      }}
    >
      <VoteSwitch
        value={value}
        onChange={onChange}
        disabled={togglesDisabled}
      />
      {onSubmit && (
        <SubmitPill
          active={locked}
          disabled={submitDisabled}
          onClick={() => onSubmit?.()}
          label={submitting ? 'Saving' : locked ? 'Done' : 'Submit'}
        />
      )}
    </div>
  );
}

// VOTE ON/OFF toggle. Data model preserved for backend compatibility:
//   ON  → 'pass' (TRUE in sheet)
//   OFF → 'fail' (FALSE in sheet)
// Initial null is rendered as OFF; clicking flips between pass ↔ fail.
function VoteSwitch({
  value,
  onChange,
  disabled,
}: {
  value: Verdict;
  onChange: (next: Verdict) => void;
  disabled: boolean;
}) {
  const on = value === 'pass';
  const TRACK_W = 132;
  const TRACK_H = 36;
  const THUMB = 28;
  const PAD = (TRACK_H - THUMB) / 2;

  function handleClick() {
    if (disabled) return;
    onChange(on ? 'fail' : 'pass');
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`VOTE ${on ? 'ON' : 'OFF'}`}
      onClick={handleClick}
      disabled={disabled}
      style={{
        position: 'relative',
        appearance: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-start' : 'flex-end',
        width: TRACK_W,
        height: TRACK_H,
        padding: `0 ${PAD + 6}px`,
        background: on ? 'var(--jnj-green)' : 'var(--jnj-grey-100)',
        border: `1px solid ${on ? 'var(--jnj-green)' : 'var(--jnj-grey-300)'}`,
        borderRadius: 'var(--jnj-radius-pill)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition:
          'background var(--jnj-transition), border-color var(--jnj-transition)',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--jnj-font-text-medium)',
          fontWeight: 600,
          fontSize: 'var(--jnj-size-btn-sm)',
          letterSpacing: '0.08em',
          color: on ? 'var(--jnj-white)' : 'var(--jnj-text-secondary)',
          textTransform: 'uppercase',
          transition: 'color var(--jnj-transition)',
        }}
      >
        VOTE {on ? 'ON' : 'OFF'}
      </span>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: PAD,
          left: on ? TRACK_W - THUMB - PAD : PAD,
          width: THUMB,
          height: THUMB,
          borderRadius: '50%',
          background: on ? 'var(--jnj-white)' : 'var(--jnj-text-primary)',
          transition: 'left var(--jnj-transition), background var(--jnj-transition)',
          pointerEvents: 'none',
        }}
      />
    </button>
  );
}

function SubmitPill({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        appearance: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--jnj-font-text-medium)',
        fontWeight: 500,
        fontSize: 'var(--jnj-size-btn-sm)',
        letterSpacing: '0.04em',
        padding: 'var(--jnj-space-2) var(--jnj-space-4)',
        borderRadius: 'var(--jnj-radius-pill)',
        minWidth: 64,
        height: 36,
        background: 'var(--jnj-text-primary)',
        color: 'var(--jnj-white)',
        border: '1.5px solid var(--jnj-text-primary)',
        opacity: disabled ? 0.55 : 1,
        transition: 'var(--jnj-transition)',
      }}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
