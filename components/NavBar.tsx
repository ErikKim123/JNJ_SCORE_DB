// 화면 상단 공용 네비게이션 — 이전단계 / 홈 / 갱신 / 대회목록 4개 아이콘 버튼.
// /competitions, /enter, /event, /round/* 에서 동일한 위치/모양으로 노출된다.

'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

export type NavBarProps = {
  loading?: boolean;
  onRefresh?: () => void;
  // 현재 화면 강조용 — 'home' | 'competitions' 등을 주면 해당 버튼이 활성 표시.
  active?: 'home' | 'competitions' | null;
  // 이전단계 경로. 지정하지 않으면 이전단계 버튼이 비활성화된다.
  back?: string;
};

export function NavBar({
  loading = false,
  onRefresh,
  active = null,
  back,
}: NavBarProps): React.ReactElement {
  const router = useRouter();
  return (
    <nav
      aria-label="Page navigation"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--jnj-space-2)',
      }}
    >
      <IconButton
        label="Back"
        disabled={!back}
        onClick={() => back && router.push(back)}
        icon={<BackIcon />}
      />
      <IconButton
        label="Home"
        active={active === 'home'}
        onClick={() => router.push('/')}
        icon={<HomeIcon />}
      />
      <IconButton
        label="Refresh"
        loading={loading}
        disabled={loading || !onRefresh}
        onClick={() => onRefresh?.()}
        icon={<RefreshIcon spinning={loading} />}
      />
      <IconButton
        label="Competitions"
        active={active === 'competitions'}
        onClick={() => router.push('/competitions')}
        icon={<TrophyIcon />}
      />
    </nav>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  loading = false,
  disabled = false,
  active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        appearance: 'none',
        cursor: disabled ? (loading ? 'wait' : 'not-allowed') : 'pointer',
        background: active ? 'var(--jnj-text-primary)' : 'transparent',
        color: active ? 'var(--jnj-white)' : 'var(--jnj-text-primary)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: active ? 'var(--jnj-text-primary)' : 'var(--jnj-grey-300)',
        borderRadius: '999px',
        width: 36,
        height: 36,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled && !loading ? 0.5 : 1,
        transition: 'var(--jnj-transition)',
      }}
    >
      {icon}
      <style>{`
        @keyframes jnj-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
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
      style={{ animation: spinning ? 'jnj-spin 1s linear infinite' : 'none' }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 5h2a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3" />
      <path d="M7 5H5a2 2 0 0 0-2 2v1a3 3 0 0 0 3 3" />
    </svg>
  );
}
