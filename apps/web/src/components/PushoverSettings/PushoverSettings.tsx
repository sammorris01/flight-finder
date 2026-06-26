'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './PushoverSettings.module.css';

interface Channel {
  id: string;
  type: string;
  label: string | null;
  enabled: boolean;
  config: { tokenSet?: boolean; userSet?: boolean };
}

/**
 * Self-contained Pushover connect/test/manage panel for the Settings page.
 * Wraps the same /api/admin/notifications endpoints the admin Notifications
 * dashboard uses, but scoped to the single Pushover channel so it's a one-stop
 * "turn on phone alerts" control.
 */
export function PushoverSettings() {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [token, setToken] = useState('');
  const [user, setUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/notifications');
      const json = await res.json();
      if (json.ok) {
        setChannel((json.data.channels as Channel[]).find((c) => c.type === 'pushover') ?? null);
      }
    } catch {
      setMessage('Could not load notification settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    if (!token.trim() || !user.trim()) {
      setMessage('Enter both your API token and user key.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pushover',
          label: 'Pushover',
          config: { token: token.trim(), user: user.trim() },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to connect');
      setToken('');
      setUser('');
      setMessage('Connected.');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!channel) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/notifications/${channel.id}/test`, { method: 'POST' });
      const json = await res.json();
      setMessage(json.ok && json.data?.sent ? 'Test sent — check your phone.' : json.error || 'Test failed.');
    } catch {
      setMessage('Test failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!channel) return;
    const next = !channel.enabled;
    setChannel({ ...channel, enabled: next });
    setBusy(true);
    try {
      await fetch(`/api/admin/notifications/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!channel) return;
    setBusy(true);
    setMessage('');
    try {
      await fetch(`/api/admin/notifications/${channel.id}`, { method: 'DELETE' });
      setChannel(null);
    } catch {
      setMessage('Failed to remove.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className={styles.hint}>Loading…</p>;

  return (
    <div className={styles.root}>
      {channel ? (
        <>
          <div className={styles.statusRow}>
            <span className={`${styles.badge} ${channel.enabled ? styles.on : styles.off}`}>
              {channel.enabled ? 'Connected' : 'Paused'}
            </span>
            <span className={styles.hint}>Pushover token &amp; user key saved (encrypted).</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={sendTest} disabled={busy}>
              Send test
            </button>
            <button type="button" className={styles.secondary} onClick={toggleEnabled} disabled={busy}>
              {channel.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className={styles.danger} onClick={remove} disabled={busy}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.hint}>
            Create an application at{' '}
            <a href="https://pushover.net" target="_blank" rel="noopener noreferrer" className={styles.link}>
              pushover.net
            </a>{' '}
            to get an API token; your user key is on your account page.
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="po-token">API token</label>
            <input
              id="po-token"
              type="password"
              className={styles.input}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="a1b2c3…"
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="po-user">User key</label>
            <input
              id="po-user"
              type="password"
              className={styles.input}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="u1v2w3…"
              autoComplete="off"
            />
          </div>
          <button type="button" className={styles.button} onClick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect Pushover'}
          </button>
        </>
      )}
      {message && <span className={styles.message}>{message}</span>}
    </div>
  );
}
