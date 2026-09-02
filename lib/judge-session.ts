// Judge authentication: PIN hashing and the signed session cookie.
//
// Server-only — imports node:crypto and reads JUDGE_SESSION_SECRET. Never
// import from a Client Component.
//
// The session carries (contestId, displayOrder), the stable person identity
// behind the per-round judges rows. API routes derive the judge from here and
// ignore any judgeId the browser sends, which is what closes the hole where
// knowing a UUID was enough to vote as someone else.

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const COOKIE_NAME = 'jnj.session';
const SESSION_TTL_SEC = 12 * 60 * 60; // one event day
const KEY_LEN = 32;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type JudgeSession = {
  /** contests.id */
  c: string;
  /** judges.display_order — the person, across all three round rows */
  d: number;
  /** display name, for the UI only */
  n: string;
  /** expiry, epoch seconds */
  exp: number;
};

function secret(): Buffer {
  const s = process.env.JUDGE_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'JUDGE_SESSION_SECRET is missing or shorter than 32 chars. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(s, 'utf8');
}

// ---------- PIN ----------

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pin, salt, KEY_LEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const dk = scryptSync(pin, Buffer.from(saltHex, 'hex'), KEY_LEN);
  return timingSafeEqual(dk, expected);
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

// ---------- session token ----------

function b64url(b: Buffer): string {
  return b.toString('base64url');
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', secret()).update(payload).digest());
}

export function createSessionToken(
  contestId: string,
  displayOrder: number,
  name: string,
): string {
  const session: JudgeSession = {
    c: contestId,
    d: displayOrder,
    n: name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const payload = b64url(Buffer.from(JSON.stringify(session), 'utf8'));
  return `${payload}.${sign(payload)}`;
}

function parseSessionToken(token: string): JudgeSession | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;

  const expected = Buffer.from(sign(payload), 'utf8');
  const actual = Buffer.from(mac, 'utf8');
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let session: JudgeSession;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof session.c !== 'string' || typeof session.d !== 'number') return null;
  if (typeof session.exp !== 'number' || session.exp < Date.now() / 1000) return null;
  return session;
}

// ---------- cookie ----------

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${SESSION_TTL_SEC}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=0`;
}

/** Read and verify the session on an incoming request. */
export function readSession(req: Request): JudgeSession | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    return parseSessionToken(part.slice(eq + 1).trim());
  }
  return null;
}
