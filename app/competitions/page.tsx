'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { NavBar } from '../../components/NavBar';
import { setCompetition } from '../../hooks/useCompetition';
import type { Competition } from '../../lib/sheet-schema';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: Competition[] }
  | { kind: 'error'; message: string };

export default function CompetitionsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetch('/api/db/competitions', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as
          | { ok: true; data: Competition[] }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!body.ok) {
          setState({ kind: 'error', message: body.error });
          return;
        }
        setState({ kind: 'ready', items: body.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load competitions.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function pick(c: Competition) {
    setCompetition({
      id: c.id,
      name: c.name,
      masterFileId: c.masterFileId,
    });
    router.push('/enter');
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 'var(--jnj-space-7) var(--jnj-space-5) var(--jnj-space-9)',
        maxWidth: 960,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-7)',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--jnj-space-2)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: 'var(--jnj-space-2)',
          }}
        >
          <NavBar
            loading={state.kind === 'loading'}
            onRefresh={() => setReloadKey((k) => k + 1)}
            active="competitions"
            back="/"
          />
        </div>
        <h1
          className="jnj-display"
          style={{
            fontSize: 'clamp(40px, 10vw, 72px)',
            margin: 0,
          }}
        >
          COMPETITIONS
        </h1>
        <p className="jnj-body" style={{ color: 'var(--jnj-text-secondary)', margin: 0 }}>
          Select a competition to join.
        </p>
      </header>

      <section>
        {state.kind === 'loading' && <LoadingSkeleton count={3} height={88} />}

        {state.kind === 'error' && (
          <ErrorBlock message={state.message} onRetry={() => setReloadKey((k) => k + 1)} />
        )}

        {state.kind === 'ready' && state.items.length === 0 && (
          <p className="jnj-body" style={{ color: 'var(--jnj-text-secondary)' }}>
            No competitions registered.
          </p>
        )}

        {state.kind === 'ready' && state.items.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--jnj-space-3)',
            }}
          >
            {state.items.map((c) => (
              <li key={c.id}>
                <CompetitionRow item={c} onClick={() => pick(c)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function CompetitionRow({
  item,
  onClick,
}: {
  item: Competition;
  onClick: () => void;
}) {
  const disabled = !item.masterFileId;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={{
        appearance: 'none',
        width: '100%',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'var(--jnj-white)',
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: 'var(--jnj-grey-300)',
        borderRadius: 'var(--jnj-radius-lg)',
        padding: 'var(--jnj-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-2)',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--jnj-transition)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--jnj-space-3)',
        }}
      >
        <span
          className="jnj-small"
          style={{
            color: 'var(--jnj-text-secondary)',
            letterSpacing: '0.06em',
            fontFamily: 'var(--jnj-font-text-medium)',
          }}
        >
          {item.id}
        </span>
        {disabled && (
          <span
            className="jnj-small"
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--jnj-radius-pill)',
              background: 'var(--jnj-grey-200)',
              color: 'var(--jnj-grey-600)',
            }}
          >
            Preparing
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--jnj-font-text-medium)',
          fontSize: 'var(--jnj-size-h3)',
          fontWeight: 500,
          color: 'var(--jnj-text-primary)',
        }}
      >
        {item.name}
      </div>
      <div
        className="jnj-caption"
        style={{ color: 'var(--jnj-text-secondary)' }}
      >
        {formatDate(item.date)}
      </div>
    </button>
  );
}

function formatDate(raw: string): string {
  // Accept "20260601-20260630" → "2026-06-01 ~ 2026-06-30", or pass through.
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const [, y1, mo1, d1, y2, mo2, d2] = m;
    return `${y1}-${mo1}-${d1} ~ ${y2}-${mo2}-${d2}`;
  }
  return raw || 'Date TBD';
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
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'var(--jnj-red)',
        borderRadius: 'var(--jnj-radius-lg)',
        background: 'var(--jnj-red-50)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-3)',
      }}
    >
      <p className="jnj-body-medium" style={{ color: 'var(--jnj-red)', margin: 0 }}>
        {message}
      </p>
      <button
        type="button"
        className="jnj-btn jnj-btn-primary jnj-btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
