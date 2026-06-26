'use client';

import { useState } from 'react';
import styles from './SearchCriteria.module.css';

export interface Criteria {
  timePreference: string;
  maxStops: number | null;
  maxPrice: number | null;
  maxDurationHours: number | null;
  cabinClass: string;
  preferredAirlines: string[];
  tripType: string;
}

interface Props {
  queryId: string;
  initial: Criteria;
  sym: string;
  canEdit: boolean;
}

const TIME_LABELS: Record<string, string> = {
  any: 'Any time',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  redeye: 'Red-eye',
};
const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  'premium-economy': 'Premium economy',
  business: 'Business',
  first: 'First',
};

function stopsLabel(n: number | null): string {
  if (n === null) return 'Any stops';
  if (n === 0) return 'Nonstop';
  return `≤ ${n} stop${n > 1 ? 's' : ''}`;
}

export function SearchCriteria({ queryId, initial, sym, canEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [c, setC] = useState<Criteria>(initial);
  const [draft, setDraft] = useState<Criteria>(initial);

  const startEdit = () => {
    setDraft(c);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/queries/${queryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timePreference: draft.timePreference,
          maxStops: draft.maxStops,
          maxPrice: draft.maxPrice,
          maxDurationHours: draft.maxDurationHours,
          cabinClass: draft.cabinClass,
          preferredAirlines: draft.preferredAirlines,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save');
      setC(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const chips = [
    initial.tripType === 'one_way' ? 'One-way' : 'Round-trip',
    TIME_LABELS[c.timePreference] ?? c.timePreference,
    stopsLabel(c.maxStops),
    c.maxPrice != null ? `≤ ${sym}${c.maxPrice}` : 'Any price',
    CABIN_LABELS[c.cabinClass] ?? c.cabinClass,
    ...(c.maxDurationHours != null ? [`≤ ${c.maxDurationHours}h`] : []),
    c.preferredAirlines.length ? c.preferredAirlines.join(', ') : 'Any airline',
  ];

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3 className={styles.title}>Search criteria</h3>
        {canEdit && !editing && (
          <button type="button" className={styles.editBtn} onClick={startEdit}>Edit</button>
        )}
      </div>

      {!editing ? (
        <>
          <div className={styles.chips}>
            {chips.map((label, i) => (
              <span key={i} className={styles.chip}>{label}</span>
            ))}
          </div>
          <p className={styles.note}>What the AI scrapes from Google Flights. Changes apply on the next scrape.</p>
        </>
      ) : (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Time of day</span>
            <select className={styles.select} value={draft.timePreference}
              onChange={(e) => setDraft({ ...draft, timePreference: e.target.value })}>
              {Object.entries(TIME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Stops</span>
            <select className={styles.select} value={draft.maxStops ?? ''}
              onChange={(e) => setDraft({ ...draft, maxStops: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Any</option>
              <option value="0">Nonstop</option>
              <option value="1">≤ 1 stop</option>
              <option value="2">≤ 2 stops</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Max price ({sym})</span>
            <input className={styles.input} type="number" min="0" inputMode="decimal"
              value={draft.maxPrice ?? ''} placeholder="Any"
              onChange={(e) => setDraft({ ...draft, maxPrice: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Max duration (h)</span>
            <input className={styles.input} type="number" min="0" inputMode="decimal"
              value={draft.maxDurationHours ?? ''} placeholder="Any"
              onChange={(e) => setDraft({ ...draft, maxDurationHours: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Cabin</span>
            <select className={styles.select} value={draft.cabinClass}
              onChange={(e) => setDraft({ ...draft, cabinClass: e.target.value })}>
              {Object.entries(CABIN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.wide}`}>
            <span className={styles.label}>Preferred airlines (comma-separated)</span>
            <input className={styles.input} type="text"
              value={draft.preferredAirlines.join(', ')} placeholder="Any airline"
              onChange={(e) => setDraft({ ...draft, preferredAirlines: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </label>

          {error && <span className={styles.error}>{error}</span>}
          <div className={styles.actions}>
            <button type="button" className={styles.save} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={styles.cancel} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
