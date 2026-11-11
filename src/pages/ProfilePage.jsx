import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';
import { copyTextToClipboard } from '../lib/clipboard.mjs';

function Row({ label, children }) {
  return (
    <div
      style={{ borderTop: '1px solid var(--border-subtle)' }}
      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 first:border-t-0 sm:px-5"
    >
      <span
        style={{ color: 'var(--text-secondary)' }}
        className="font-mono text-[11px] font-semibold tracking-wider uppercase"
      >
        {label}
      </span>
      <span className="text-[13px] font-semibold break-all">{children}</span>
    </div>
  );
}

export default function ProfilePage({
  operatorEmail,
  theme,
  onToggleTheme,
  onSignOut,
  isOnline,
}) {
  const [swStatus, setSwStatus] = useState('checking');
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);

  const initials = operatorEmail
    ? operatorEmail.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'CA'
    : 'CA';

  useEffect(() => {
    let alive = true;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      setSwStatus('unsupported');
      return undefined;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (alive) setSwStatus(reg ? 'active' : 'none');
      })
      .catch(() => {
        if (alive) setSwStatus('none');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopyEmail = useCallback(async () => {
    if (!operatorEmail) return;
    await copyTextToClipboard(operatorEmail);
    setCopied(true);
  }, [operatorEmail]);

  const handleClearShell = useCallback(async () => {
    setClearing(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.unregister();
      }
      if ('caches' in globalThis) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      window.location.reload();
    } catch {
      setClearing(false);
      setSwStatus('none');
    }
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="space-y-4">
        {/* Identity */}
        <section className="console-panel overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <span
              style={{
                backgroundColor: 'var(--accent-badge-bg)',
                color: 'var(--accent-badge-text)',
              }}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold"
            >
              {operatorEmail ? initials : <UserRound className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold tracking-tight">
                  {operatorEmail || 'Operator session'}
                </h2>
                {operatorEmail ? (
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    aria-label="Copy operator email"
                    className="console-btn-secondary inline-flex h-7 w-7 items-center justify-center rounded-lg"
                  >
                    {copied ? (
                      <Check
                        style={{ color: 'var(--ok-main)' }}
                        className="h-3.5 w-3.5"
                      />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}
              </div>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-0.5 text-[12px] font-medium"
              >
                Central operator · Supabase admin session · zero license keys
                on this device.
              </p>
            </div>
            {isOnline ? (
              <span className="badge-success inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold">
                <span
                  style={{ backgroundColor: 'var(--ok-main)' }}
                  className="h-1.5 w-1.5 rounded-full"
                />
                Online
              </span>
            ) : (
              <span className="badge-warning inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
                <WifiOff className="h-3 w-3" />
                Offline
              </span>
            )}
          </div>
          <div style={{ backgroundColor: 'var(--bg-surface)' }}>
            <Row label="Console version">v{APP_VERSION}</Row>
            <Row label="Schema contract">v{SCHEMA_VERSION} · additive migrations</Row>
            <Row label="Console origin">
              <span className="font-mono text-[12px]">
                {typeof window !== 'undefined' ? window.location.origin : '—'}
              </span>
            </Row>
            <Row label="Appearance">
              <button
                type="button"
                onClick={onToggleTheme}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
              >
                {theme === 'dark' ? (
                  <Sun style={{ color: 'var(--warn-main)' }} className="h-3.5 w-3.5" />
                ) : (
                  <Moon style={{ color: 'var(--brand-primary)' }} className="h-3.5 w-3.5" />
                )}
                {theme === 'dark' ? 'Slate Night' : 'Enrolliq Light'}
              </button>
            </Row>
          </div>
        </section>

        {/* Shell cache / service worker */}
        <section className="console-panel rounded-3xl p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <RefreshCw className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold tracking-tight">Shell cache</h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="text-[12px] font-medium"
              >
                The console ships a cache-first service worker for offline
                use. Clearing it forces every clinic or operator browser to
                pick up the newest build — the fix for a stale UI.
              </p>
            </div>
            {swStatus === 'active' ? (
              <span className="badge-success rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold">
                Active
              </span>
            ) : swStatus === 'checking' ? (
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="font-mono text-[11px] font-semibold"
              >
                …
              </span>
            ) : (
              <span className="badge-warning rounded-full px-2.5 py-1 text-[11px] font-semibold">
                {swStatus === 'unsupported' ? 'Unsupported' : 'Not registered'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClearShell}
            disabled={clearing || swStatus === 'unsupported'}
            className="console-btn-secondary mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60"
          >
            <RefreshCw className={clearing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {clearing ? 'Clearing…' : 'Clear shell cache & reload'}
          </button>
        </section>
      </div>

      <div className="space-y-4">
        {/* Security posture */}
        <section className="console-panel rounded-3xl p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold tracking-tight">Security posture</h3>
          </div>
          <ul className="mt-3 space-y-2 text-[12px] font-medium">
            {[
              'FORCE RLS on every table — anon sees one RPC only.',
              'Activity log is append-only by ACL, not by convention.',
              'Service worker never caches REST, Auth, or Edge responses.',
              'Operator password never leaves the Supabase Auth flow.',
            ].map((line) => (
              <li
                key={line}
                style={{ color: 'var(--text-secondary)' }}
                className="flex items-start gap-2"
              >
                <Check
                  style={{ color: 'var(--ok-main)' }}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                {line}
              </li>
            ))}
          </ul>
        </section>

        {/* Sign out */}
        <section className="console-panel rounded-3xl p-4 sm:p-5">
          <h3 className="text-sm font-bold tracking-tight">Session</h3>
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 text-[12px] font-medium"
          >
            Signing out ends this operator session on this browser only.
            Clinic clients keep syncing — they never held a key.
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="badge-error mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
          >
            <LogOut className="h-4 w-4" />
            Sign out of Central
          </button>
        </section>
      </div>
    </div>
  );
}
