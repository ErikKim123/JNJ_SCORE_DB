'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { NavBar } from '../../components/NavBar';
import { QRCodeImg } from '../../components/QRCode';
import { setCompetition, useCompetition } from '../../hooks/useCompetition';
import { setJudge } from '../../hooks/useJudge';
import type { Competition, Judge } from '../../lib/sheet-schema';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; judges: Judge[] }
  | { kind: 'error'; message: string };

export default function EnterPage() {
  return (
    <Suspense fallback={null}>
      <EnterPageInner />
    </Suspense>
  );
}

function EnterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qrCompetitionId = searchParams.get('c');
  const [qrSyncing, setQrSyncing] = useState<boolean>(Boolean(qrCompetitionId));
  const { competition, hydrated } = useCompetition({
    requireSelection: !qrSyncing,
  });
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // If arrived via QR (?c=JNJ-001), look up the competition and persist it
  // into localStorage so the rest of the flow keeps working unchanged.
  useEffect(() => {
    if (!qrCompetitionId) return;
    if (competition && competition.id === qrCompetitionId) {
      setQrSyncing(false);
      return;
    }
    let cancelled = false;
    fetch('/api/db/competitions', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json()) as
          | { ok: true; data: Competition[] }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!body.ok) {
          setQrSyncing(false);
          return;
        }
        const match = body.data.find((c) => c.id === qrCompetitionId);
        if (match) {
          setCompetition({
            id: match.id,
            name: match.name,
            masterFileId: match.masterFileId,
          });
          // Drop the ?c= param and let the page remount so useCompetition
          // re-reads localStorage with the freshly stored selection.
          window.location.replace('/enter');
          return;
        }
        setQrSyncing(false);
      })
      .catch(() => {
        if (!cancelled) setQrSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [qrCompetitionId, competition]);

  useEffect(() => {
    if (!hydrated || !competition) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    const url = `/api/db/judges?competitionId=${encodeURIComponent(competition.id)}`;
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

  if (!hydrated || qrSyncing) {
    return null; // wait for localStorage check / QR sync / redirect
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

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--jnj-space-4)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--jnj-space-2)',
              flex: 1,
              minWidth: 0,
            }}
          >
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
            <p
              className="jnj-body"
              style={{ color: 'var(--jnj-text-secondary)', margin: 0 }}
            >
              Select your name and log in.
            </p>
          </div>

          {competition && <JudgeLoginQR competitionId={competition.id} />}
        </div>
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

function JudgeLoginQR({ competitionId }: { competitionId: string }) {
  const [open, setOpen] = useState(false);
  const judgeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/enter?c=${encodeURIComponent(competitionId)}`
      : `/enter?c=${encodeURIComponent(competitionId)}`;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show judge login QR"
        title="Judge login QR"
        style={{
          appearance: 'none',
          background: '#fff',
          border: '1.5px solid var(--jnj-grey-300)',
          borderRadius: 'var(--jnj-radius-lg)',
          padding: 'var(--jnj-space-2)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <QRCodeImg value={judgeUrl} size={96} alt="Judge login QR" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--jnj-space-5)',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              color: '#000',
              borderRadius: 'var(--jnj-radius-lg)',
              padding: 'var(--jnj-space-6)',
              maxWidth: 420,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--jnj-space-4)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                className="jnj-small"
                style={{ letterSpacing: '0.06em', opacity: 0.6 }}
              >
                {competitionId}
              </div>
              <div className="jnj-caption" style={{ opacity: 0.7 }}>
                Judge login QR
              </div>
            </div>

            <QRCodeImg value={judgeUrl} size={280} margin={2} alt="Judge login QR large" />

            <div
              style={{
                fontSize: 12,
                opacity: 0.7,
                wordBreak: 'break-all',
                textAlign: 'center',
              }}
            >
              {judgeUrl}
            </div>

            <div style={{ display: 'flex', gap: 'var(--jnj-space-2)' }}>
              <button
                type="button"
                className="jnj-btn jnj-btn-secondary jnj-btn-sm"
                onClick={() => {
                  if (navigator.clipboard) navigator.clipboard.writeText(judgeUrl);
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className="jnj-btn jnj-btn-primary jnj-btn-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
