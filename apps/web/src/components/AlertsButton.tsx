'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './AlertsButton.module.css';

export interface FlightOption {
  id: string;
  label: string;
}

interface Rule {
  id: string;
  flightId: string | null;
  flightLabel: string | null;
  targetPrice: number | null;
  dropAbs: number | null;
  dropPct: number | null;
  enabled: boolean;
}

interface Props {
  queryId: string;
  /** Currency symbol for the inputs, e.g. "£". */
  sym: string;
  /** Distinct flights in this tracker, for the per-flight scope picker. */
  flights: FlightOption[];
}

export function AlertsButton({ queryId, sym, flights }: Props) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [scope, setScope] = useState(''); // '' = whole tracker, else flightId
  const [target, setTarget] = useState('');
  const [dropAbs, setDropAbs] = useState('');
  const [dropPct, setDropPct] = useState('');

  const base = `/api/queries/${queryId}/alerts`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load alerts');
      setRules(json.data.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const resetForm = () => {
    setScope('');
    setTarget('');
    setDropAbs('');
    setDropPct('');
  };

  const addRule = async () => {
    if (!target && !dropAbs && !dropPct) {
      setError('Set a target price and/or a drop amount.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const flightLabel = scope ? flights.find((f) => f.id === scope)?.label ?? null : null;
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightId: scope || null,
          flightLabel,
          targetPrice: target || null,
          dropAbs: dropAbs || null,
          dropPct: dropPct || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to add alert');
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add alert');
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: Rule) => {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    await fetch(`${base}/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    }).catch(() => load());
  };

  const deleteRule = async (rule: Rule) => {
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
    await fetch(`${base}/${rule.id}`, { method: 'DELETE' }).catch(() => load());
  };

  const scopeLabel = (r: Rule) => (r.flightId ? r.flightLabel ?? 'A flight' : 'Whole tracker');
  const conditionLabel = (r: Rule) => {
    const parts: string[] = [];
    if (r.targetPrice != null) parts.push(`≤ ${sym}${r.targetPrice}`);
    if (r.dropAbs != null) parts.push(`drop ${sym}${r.dropAbs}`);
    if (r.dropPct != null) parts.push(`drop ${Math.round(r.dropPct * 1000) / 10}%`);
    return parts.join(' · ');
  };

  return (
    <>
      <button className={styles.trigger} onClick={() => setOpen(true)} title="Price alerts">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 1.5zM6.5 13a1.5 1.5 0 0 0 3 0" />
        </svg>
        Alerts
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Price alerts">
            <div className={styles.header}>
              <h2 className={styles.title}>Price alerts</h2>
              <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.list}>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : rules.length === 0 ? (
                <p className={styles.muted}>No alerts yet. Add one below.</p>
              ) : (
                rules.map((r) => (
                  <div key={r.id} className={`${styles.rule} ${r.enabled ? '' : styles.disabled}`}>
                    <div className={styles.ruleMain}>
                      <span className={styles.scope}>{scopeLabel(r)}</span>
                      <span className={styles.condition}>{conditionLabel(r)}</span>
                    </div>
                    <div className={styles.ruleActions}>
                      <button className={styles.toggle} onClick={() => toggleRule(r)} title={r.enabled ? 'Pause' : 'Resume'}>
                        {r.enabled ? 'On' : 'Off'}
                      </button>
                      <button className={styles.del} onClick={() => deleteRule(r)} aria-label="Delete alert">×</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Apply to</span>
                <select className={styles.select} value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="">Whole tracker (cheapest fare)</option>
                  {flights.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </label>

              <div className={styles.conditions}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Price at or below</span>
                  <div className={styles.inputWrap}>
                    <span className={styles.adorn}>{sym}</span>
                    <input className={styles.input} type="number" min="0" inputMode="decimal"
                      value={target} onChange={(e) => setTarget(e.target.value)} placeholder="200" />
                  </div>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>or drops by</span>
                  <div className={styles.inputWrap}>
                    <span className={styles.adorn}>{sym}</span>
                    <input className={styles.input} type="number" min="0" inputMode="decimal"
                      value={dropAbs} onChange={(e) => setDropAbs(e.target.value)} placeholder="25" />
                  </div>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>or drops by</span>
                  <div className={styles.inputWrap}>
                    <input className={styles.input} type="number" min="0" max="99" inputMode="decimal"
                      value={dropPct} onChange={(e) => setDropPct(e.target.value)} placeholder="10" />
                    <span className={styles.adorn}>%</span>
                  </div>
                </label>
              </div>

              <button className={styles.add} onClick={addRule} disabled={saving}>
                {saving ? 'Adding…' : 'Add alert'}
              </button>
              <p className={styles.note}>
                Drops are measured from the price when you add the alert, and re-arm after each notification.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
