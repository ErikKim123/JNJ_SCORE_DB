import { NextResponse } from 'next/server';
import { clearedSessionCookie } from '../../../../lib/judge-session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true, data: null });
  res.headers.set('Set-Cookie', clearedSessionCookie());
  return res;
}
