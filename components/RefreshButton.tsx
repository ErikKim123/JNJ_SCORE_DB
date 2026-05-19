'use client';

import * as React from 'react';

export function RefreshButton({
  loading,
  onClick,
  label = 'Refresh',
}: {
  loading: boolean;
  onClick: () => void;
  label?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label="Reload data"
      style={{
        appearance: 'none',
        cursor: loading ? 'wait' : 'pointer',
        background: 'transparent',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'var(--jnj-grey-300)',
        borderRadius: 'var(--jnj-radius-pill)',
        padding: 'var(--jnj-space-1) var(--jnj-space-3)',
        fontFamily: 'var(--jnj-font-text-medium)',
        fontSize: 'var(--jnj-size-link-sm)',
        color: 'var(--jnj-text-primary)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        opacity: loading ? 0.6 : 1,
        transition: 'var(--jnj-transition)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          lineHeight: 1,
          animation: loading ? 'jnj-spin 1s linear infinite' : 'none',
        }}
      >
        ↻
      </span>
      {loading ? 'Loading' : label}
      <style>{`
        @keyframes jnj-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}
