'use client';

import { useTrackerView, EMPTY_FILTERS, filtersActive, type FlightFilters } from '@/lib/useTrackerView';
import styles from './FilterBar.module.css';

function toHHMM(min: number | null): string {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fromHHMM(v: string): number | null {
  if (!v) return null;
  const parts = v.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Departure/arrival-time and stops filters for a tracker, shared (via
 * useTrackerView) with the chart, the Results list and the Best Price card. */
export function FilterBar({ trackerId }: { trackerId?: string }) {
  const { filters, setFilters } = useTrackerView(trackerId);
  const update = (patch: Partial<FlightFilters>) => setFilters({ ...filters, ...patch });

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <span className={styles.label}>Departs</span>
        <input
          type="time"
          className={styles.time}
          value={toHHMM(filters.depFrom)}
          onChange={(e) => update({ depFrom: fromHHMM(e.target.value) })}
          aria-label="Departs at or after"
        />
        <span className={styles.dash}>–</span>
        <input
          type="time"
          className={styles.time}
          value={toHHMM(filters.depTo)}
          onChange={(e) => update({ depTo: fromHHMM(e.target.value) })}
          aria-label="Departs at or before"
        />
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Arrives</span>
        <input
          type="time"
          className={styles.time}
          value={toHHMM(filters.arrFrom)}
          onChange={(e) => update({ arrFrom: fromHHMM(e.target.value) })}
          aria-label="Arrives at or after"
        />
        <span className={styles.dash}>–</span>
        <input
          type="time"
          className={styles.time}
          value={toHHMM(filters.arrTo)}
          onChange={(e) => update({ arrTo: fromHHMM(e.target.value) })}
          aria-label="Arrives at or before"
        />
      </div>

      <div className={styles.group}>
        <span className={styles.label}>Stops</span>
        <select
          className={styles.select}
          value={filters.maxStops ?? ''}
          onChange={(e) => update({ maxStops: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Any</option>
          <option value="0">Nonstop</option>
          <option value="1">≤ 1 stop</option>
          <option value="2">≤ 2 stops</option>
        </select>
      </div>

      {filtersActive(filters) && (
        <button type="button" className={styles.clear} onClick={() => setFilters({ ...EMPTY_FILTERS })}>
          Clear
        </button>
      )}
    </div>
  );
}
