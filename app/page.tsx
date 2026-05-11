// Design Ref: §7.2 HOME — full-bleed monochrome, Oswald wordmark, primary CTA → /enter.
// Plan SC-06: design-token application.

import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'var(--jnj-black)',
        color: 'var(--jnj-white)',
        padding: 'var(--jnj-space-8) var(--jnj-space-6)',
      }}
    >
      <header
        style={{
          fontFamily: 'var(--jnj-font-text-medium)',
          fontSize: 'var(--jnj-size-small)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--jnj-grey-400)',
        }}
      >
        JNJ / 2026
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--jnj-space-6)' }}>
        <h1
          style={{
            fontFamily: 'var(--jnj-font-display)',
            fontSize: 'clamp(64px, 18vw, 160px)',
            fontWeight: 500,
            lineHeight: 0.9,
            letterSpacing: '-0.01em',
            textTransform: 'uppercase',
            margin: 0,
            color: 'var(--jnj-white)',
          }}
        >
          JNJ
          <br />
          VOTE.
        </h1>
        <p
          style={{
            fontFamily: 'var(--jnj-font-text-medium)',
            fontSize: 'var(--jnj-size-h3)',
            lineHeight: 1.5,
            color: 'var(--jnj-grey-300)',
            margin: 0,
            maxWidth: 480,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
          }}
        >
          Judge only the dance. We&apos;ll keep the score.
        </p>
      </section>

      <footer style={{ display: 'flex', flexDirection: 'column', gap: 'var(--jnj-space-3)' }}>
        <Link
          href="/competitions"
          className="jnj-btn jnj-btn-inverse"
          style={{ width: '100%', padding: 'var(--jnj-space-4) var(--jnj-space-6)' }}
        >
          View Competitions
        </Link>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--jnj-font-text)',
            fontSize: 'var(--jnj-size-small)',
            color: 'var(--jnj-grey-500)',
            textAlign: 'center',
          }}
        >
          Select an active competition
        </p>
      </footer>
    </main>
  );
}
