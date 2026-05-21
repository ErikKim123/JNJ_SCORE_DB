// Design Ref: §7.2 /event header — current judge name + logout link.
// Re-used across /event and /round/* pages.

'use client';

import * as React from 'react';
import { useJudge } from '../hooks/useJudge';
import type { JudgeVoteTarget } from '../lib/sheet-schema';

function targetLabel(t: JudgeVoteTarget | undefined): string {
  if (t === 'leader') return 'Leader';
  if (t === 'follower') return 'Follower';
  return 'All';
}

function targetBg(t: JudgeVoteTarget | undefined): string {
  if (t === 'leader') return 'var(--jnj-blue-50, #DBEAFE)';
  if (t === 'follower') return 'var(--jnj-pink-50, #FCE7F3)';
  return 'var(--jnj-grey-200)';
}

function targetFg(t: JudgeVoteTarget | undefined): string {
  if (t === 'leader') return 'var(--jnj-blue, #1D4ED8)';
  if (t === 'follower') return 'var(--jnj-pink, #BE185D)';
  return 'var(--jnj-text-primary)';
}

export function JudgeBadge(): React.ReactElement | null {
  const { judge, hydrated, logout } = useJudge();

  if (!hydrated || !judge) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--jnj-space-3)',
        padding: 'var(--jnj-space-2) var(--jnj-space-4)',
        borderRadius: 'var(--jnj-radius-pill)',
        background: 'var(--jnj-grey-100)',
        fontFamily: 'var(--jnj-font-text-medium)',
        fontSize: 'var(--jnj-size-link-sm)',
      }}
    >
      <span
        aria-label="Judge"
        title="Judge"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--jnj-text-secondary)',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* 채점 = 점수표에 체크. lucide 'clipboard-check'. */}
          <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      </span>
      <span style={{ color: 'var(--jnj-text-primary)' }}>{judge.name}</span>
      <span
        style={{
          padding: '2px var(--jnj-space-2)',
          borderRadius: 'var(--jnj-radius-pill)',
          background: targetBg(judge.voteTarget),
          color: targetFg(judge.voteTarget),
          fontSize: 'var(--jnj-size-small)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {targetLabel(judge.voteTarget)}
      </span>
      <button
        type="button"
        onClick={logout}
        aria-label="Logout"
        title="Logout"
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          padding: 0,
          marginLeft: 'var(--jnj-space-1)',
          color: 'var(--jnj-text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  );
}
