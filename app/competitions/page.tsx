'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { NavBar } from '../../components/NavBar';
import { QRCodeImg } from '../../components/QRCode';
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
  const [qrModal, setQrModal] = useState<Competition | null>(null);

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
                <CompetitionRow
                  item={c}
                  onClick={() => pick(c)}
                  onShowQR={() => setQrModal(c)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {qrModal && (
        <QRModal item={qrModal} onClose={() => setQrModal(null)} />
      )}
    </main>
  );
}

function CompetitionRow({
  item,
  onClick,
  onShowQR,
}: {
  item: Competition;
  onClick: () => void;
  onShowQR: () => void;
}) {
  const disabled = !item.masterFileId;
  const judgeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/enter?c=${encodeURIComponent(item.id)}`
      : `/enter?c=${encodeURIComponent(item.id)}`;
  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--jnj-white)',
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: 'var(--jnj-grey-300)',
        borderRadius: 'var(--jnj-radius-lg)',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--jnj-transition)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        style={{
          appearance: 'none',
          flex: 1,
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--jnj-radius-lg)',
          padding: 'var(--jnj-space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--jnj-space-2)',
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

      <button
        type="button"
        onClick={onShowQR}
        aria-label={`Show judge login QR for ${item.name}`}
        title="Judge login QR"
        style={{
          appearance: 'none',
          background: '#fff',
          border: 'none',
          borderLeft: '1px solid var(--jnj-grey-300)',
          padding: 'var(--jnj-space-3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTopRightRadius: 'var(--jnj-radius-lg)',
          borderBottomRightRadius: 'var(--jnj-radius-lg)',
        }}
      >
        <QRCodeImg value={judgeUrl} size={64} alt={`QR · ${item.id}`} />
      </button>
    </div>
  );
}

function QRModal({ item, onClose }: { item: Competition; onClose: () => void }) {
  const judgeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/enter?c=${encodeURIComponent(item.id)}`
      : `/enter?c=${encodeURIComponent(item.id)}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
            {item.id}
          </div>
          <div
            style={{
              fontFamily: 'var(--jnj-font-text-medium)',
              fontSize: 'var(--jnj-size-h3)',
              fontWeight: 500,
            }}
          >
            {item.name}
          </div>
          <div className="jnj-caption" style={{ opacity: 0.7 }}>
            Judge login QR
          </div>
        </div>

        <QRCodeImg value={judgeUrl} size={280} margin={2} alt={`QR · ${item.id}`} />

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
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
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
