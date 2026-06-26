'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Shared per-tracker view state — which flights are hidden AND the active
 * departure/arrival/stops filters — so the chart, the Results list and the Best
 * Price card all agree. Persisted to localStorage (keyed by tracker) and
 * broadcast via a window event so sibling components (which don't share a React
 * parent under the server-rendered page) stay in sync. Hidden keys are flight
 * identities (PriceSnapshot.flightId), the same id every view uses.
 */
export interface FlightFilters {
  depFrom: number | null; // minutes from midnight, inclusive
  depTo: number | null;
  arrFrom: number | null;
  arrTo: number | null;
  maxStops: number | null; // null = any
}

export const EMPTY_FILTERS: FlightFilters = {
  depFrom: null,
  depTo: null,
  arrFrom: null,
  arrTo: null,
  maxStops: null,
};

export function filtersActive(f: FlightFilters): boolean {
  return f.depFrom != null || f.depTo != null || f.arrFrom != null || f.arrTo != null || f.maxStops != null;
}

/** Parse a "6:40 AM" / "1:55 PM" clock label into minutes from midnight. */
export function parseClockMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

const EVENT = 'ff:view-change';
const keyFor = (id: string) => `ff:view:${id}`;

interface ChangeDetail {
  id: string;
  hidden: string[];
  filters: FlightFilters;
}

function read(id: string): { hidden: Set<string>; filters: FlightFilters } {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return { hidden: new Set(), filters: { ...EMPTY_FILTERS } };
    const parsed = JSON.parse(raw) as Partial<ChangeDetail>;
    return {
      hidden: new Set(parsed.hidden ?? []),
      filters: { ...EMPTY_FILTERS, ...(parsed.filters ?? {}) },
    };
  } catch {
    return { hidden: new Set(), filters: { ...EMPTY_FILTERS } };
  }
}

function write(id: string, hidden: Set<string>, filters: FlightFilters): void {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify({ hidden: [...hidden], filters }));
  } catch {
    /* ignore unavailable storage */
  }
  window.dispatchEvent(new CustomEvent<ChangeDetail>(EVENT, { detail: { id, hidden: [...hidden], filters } }));
}

interface FilterableFlight {
  departureTime: string | null;
  arrivalTime: string | null;
  stops: number;
}

export interface TrackerView {
  hidden: Set<string>;
  isHidden: (key: string) => boolean;
  setHidden: (next: Set<string>) => void;
  toggle: (key: string) => void;
  filters: FlightFilters;
  setFilters: (f: FlightFilters) => void;
  /** Whether a flight passes the active departure/arrival/stops filters. */
  passes: (s: FilterableFlight) => boolean;
}

export function useTrackerView(trackerId: string | undefined): TrackerView {
  const [hidden, setHiddenState] = useState<Set<string>>(new Set());
  const [filters, setFiltersState] = useState<FlightFilters>({ ...EMPTY_FILTERS });

  useEffect(() => {
    if (!trackerId) return;
    const v = read(trackerId);
    setHiddenState(v.hidden);
    setFiltersState(v.filters);
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChangeDetail>).detail;
      if (d && d.id === trackerId) {
        setHiddenState(new Set(d.hidden));
        setFiltersState({ ...EMPTY_FILTERS, ...d.filters });
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor(trackerId)) {
        const v2 = read(trackerId);
        setHiddenState(v2.hidden);
        setFiltersState(v2.filters);
      }
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
      if (trackerId) write(trackerId, next, filters);
    },
    [trackerId, filters],
  );

  const toggle = useCallback(
    (key: string) => {
      setHiddenState((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (trackerId) write(trackerId, next, filters);
        return next;
      });
    },
    [trackerId, filters],
  );

  const setFilters = useCallback(
    (f: FlightFilters) => {
      setFiltersState(f);
      if (trackerId) write(trackerId, hidden, f);
    },
    [trackerId, hidden],
  );

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  const passes = useCallback(
    (s: FilterableFlight) => {
      const dep = parseClockMinutes(s.departureTime);
      const arr = parseClockMinutes(s.arrivalTime);
      if (filters.depFrom != null && (dep == null || dep < filters.depFrom)) return false;
      if (filters.depTo != null && (dep == null || dep > filters.depTo)) return false;
      if (filters.arrFrom != null && (arr == null || arr < filters.arrFrom)) return false;
      if (filters.arrTo != null && (arr == null || arr > filters.arrTo)) return false;
      if (filters.maxStops != null && s.stops > filters.maxStops) return false;
      return true;
    },
    [filters],
  );

  return { hidden, isHidden, setHidden, toggle, filters, setFilters, passes };
}
