'use client';

// Design Ref: §6.1 — current judge persisted in localStorage under `jnj.judge`.
// Used by every round page; redirects to /enter when missing.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { JudgeVoteTarget } from '../lib/sheet-schema';

const STORAGE_KEY = 'jnj.judge';

export type StoredJudge = {
  id: string;
  name: string;
  // Per-round vote caps copied from sheet at /enter time. Optional for legacy
  // localStorage entries; round pages treat undefined as "no cap".
  maxPrelimVotes?: number;
  maxSemiVotes?: number;
  // 본인이 채점할 참가자 역할 필터 — `2.심사위원` 시트의 `대상` 컬럼.
  // 빈값/legacy localStorage → 'all' 로 폴백.
  voteTarget?: JudgeVoteTarget;
};

function readJudge(): StoredJudge | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredJudge) : null;
  } catch {
    return null;
  }
}

export function setJudge(judge: StoredJudge): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(judge));
}

export function clearJudge(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Read the current judge. When `requireJudge` is true, redirects to /enter
 * if no judge is selected.
 */
export function useJudge({
  requireJudge = false,
}: { requireJudge?: boolean } = {}): {
  judge: StoredJudge | null;
  hydrated: boolean;
  logout: () => void;
} {
  const [judge, setLocalJudge] = useState<StoredJudge | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const j = readJudge();
    setLocalJudge(j);
    setHydrated(true);
    if (requireJudge && !j) router.replace('/enter');
  }, [requireJudge, router]);

  const logout = useCallback(() => {
    clearJudge();
    setLocalJudge(null);
    router.replace('/enter');
  }, [router]);

  return { judge, hydrated, logout };
}
