'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { NavBar } from '../../components/NavBar';
import { useCompetition } from '../../hooks/useCompetition';
import { setJudge } from '../../hooks/useJudge';
import type { Judge } from '../../lib/sheet-schema';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; judges: Judge[] }
  | { kind: 'error'; message: string };

export default function EnterPage() {
  const router = useRouter();
  const { competition, hydrated } = useCompetition({ requireSelection: true });
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !competition) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    const url = competition.masterFileId
      ? `/api/sheet/judges?sheetId=${encodeURIComponent(competition.masterFileId)}`
      : '/api/sheet/judges';
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json()) as
          | { ok: true; data: Judge[]; via?: string }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!body.ok) {
          setState({ kind: 'error', message: body.error });
          return;
        }
        const active = body.data.filter((j) => j.active);
        setState({ kind: 'ready', judges: active });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Failed to load judges.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, competition, reloadKey]);

  function handleLogin() {
    if (!selectedId || state.kind !== 'ready') return;
    const judge = state.judges.find((j) => j.id === selectedId);
    if (!judge) return;
    setJudge({
      id: judge.id,
      name: judge.name,
      maxPrelimVotes: judge.maxPrelimVotes,
      maxSemiVotes: judge.maxSemiVotes,
      voteTarget: judge.voteTarget,
    });
    router.push('/event');
  }

  if (!hydrated) {
    return null; // wait for localStorage check / redirect
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding:
          'var(--jnj-space-7) var(--jnj-space-5) calc(var(--jnj-space-10) + env(safe-area-inset-bottom, 0px))',
        maxWidth: 960,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--jnj-space-6)',
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
            back="/competitions"
          />
        </div>

        {competition && (
          <span
            className="jnj-small"
            style={{
              color: 'var(--jnj-text-secondary)',
              fontFamily: 'var(--jnj-font-text-medium)',
              letterSpacing: '0.06em',
            }}
          >
            {competition.id} · {competition.name}
          </span>
        )}

        <h1
          className="jnj-display"
          style={{ fontSize: 'clamp(40px, 10vw, 72px)', margin: 0 }}
        >
          JUDGE LOGIN
        </h1>
        <p className="jnj-body" style={{ color: 'var(--jnj-text-secondary)', margin: 0 }}>
          Select your name and log in.
        </p>
      </header>

      <section style={{ flex: 1 }}>
        {state.kind === 'loading' && <LoadingSkeleton count={6} />}

        {state.kind === 'error' && (
          <ErrorBlock
            message={state.message}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        )}

        {state.kind === 'ready' && state.judges.length === 0 && (
          <p className="jnj-body" style={{ color: 'var(--jnj-text-secondary)' }}>
            No active judges. Contact the operator.
          </p>
        )}

        {state.kind === 'ready' && state.judges.length > 0 && (
          <div
            style={{
              display: 'grid',
              gap: 'var(--jnj-space-3)',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            }}
          >
            <ResponsiveGridCols />
            {state.judges.map((j) => (
              <Card
                key={j.id}
                selected={selectedId === j.id}
                onClick={() => setSelectedId(j.id)}
              >
                {j.name}
              </Card>
            ))}
          </div>
        )}
      </section>

      <LoginFooter
        disabled={!selectedId || state.kind !== 'ready'}
        onClick={handleLogin}
      />
    </main>
  );
}

function LoginFooter({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 'env(safe-area-inset-bottom, 0px)',
        marginInline: 'calc(-1 * var(--jnj-space-5))',
        padding:
          'var(--jnj-space-3) var(--jnj-space-5) calc(var(--jnj-space-3) + env(safe-area-inset-bottom, 0px))',
        background: 'var(--jnj-white)',
        boxShadow: '0px -1px 0px 0px var(--jnj-grey-200) inset',
        display: 'flex',
        gap: 'var(--jnj-space-2)',
      }}
    >
      <button
        type="button"
        className="jnj-btn jnj-btn-primary"
        disabled={disabled}
        onClick={onClick}
        style={{ flex: 1, padding: 'var(--jnj-space-3) var(--jnj-space-5)' }}
      >
        Log in
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
        Try again
      </button>
    </div>
  );
}

function ResponsiveGridCols() {
  return (
    <style>{`
      @media (min-width: 600px) {
        section > div { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
      }
      @media (min-width: 960px) {
        section > div { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
      }
    `}</style>
  );
}
