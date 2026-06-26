'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Shared per-tracker "which flights are hidden" state, so the chart legend and
 * the Results list stay in sync. Persisted to localStorage (keyed by tracker)
 * and broadcast via a window event so sibling components — which don't share a
 * React parent under the server-rendered page — update together. Keys are flight
 * identities (PriceSnapshot.flightId).
 */
const EVENT = 'ff:view-change';
const keyFor = (id: string) => `ff:view:${id}`;

interface ChangeDetail {
  id: string;
  hidden: string[];
}

function read(id: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { hidden?: string[] } | string[];
    const hidden = Array.isArray(parsed) ? parsed : parsed.hidden ?? [];
    return new Set(hidden);
  } catch {
    return new Set();
  }
}

function write(id: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify({ hidden: [...hidden] }));
  } catch {
    /* ignore unavailable storage */
  }
  window.dispatchEvent(new CustomEvent<ChangeDetail>(EVENT, { detail: { id, hidden: [...hidden] } }));
}

export interface TrackerView {
  hidden: Set<string>;
  isHidden: (key: string) => boolean;
  setHidden: (next: Set<string>) => void;
  toggle: (key: string) => void;
}

export function useTrackerView(trackerId: string | undefined): TrackerView {
  const [hidden, setHiddenState] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!trackerId) return;
    setHiddenState(read(trackerId));
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChangeDetail>).detail;
      if (d && d.id === trackerId) setHiddenState(new Set(d.hidden));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor(trackerId)) setHiddenState(read(trackerId));
    };
    window.addEventListener(EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [trackerId]);

  const setHidden = useCallback(
    (next: Set<string>) => {
      setHiddenState(next);
      if (trackerId) write(trackerId, next);
    },
    [trackerId],
  );

  const toggle = useCallback(
    (key: string) => {
      setHiddenState((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (trackerId) write(trackerId, next);
        return next;
      });
    },
    [trackerId],
  );

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  return { hidden, isHidden, setHidden, toggle };
}
