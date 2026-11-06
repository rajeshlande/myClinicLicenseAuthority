import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  formatAuthErrorMessage,
  validatePasswordUpdate,
} from '../lib/auth.mjs';
import {
  clearRuntimeSupabaseConfig,
  saveRuntimeSupabaseConfig,
} from '../lib/supabase.js';
import { SCHEMA_VERSION } from '../lib/version.js';

export default function SetupPage({
  backend,
  session,
  isOnline,
  onBackendChanged,
  onSignOut,
}) {
  const [url, setUrl] = useState(backend.health?.url ?? '');
  const [anonKey, setAnonKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [testingHealth, setTestingHealth] = useState(false);
  const [healthResults, setHealthResults] = useState(null);

  const user = session?.user ?? null;

  const handleRunHealthCheck = async () => {
    setTestingHealth(true);
    setErrorMsg('');
    const results = [];
    try {
      const restRes = await fetch(`${backend.health.url}/rest/v1/`, {
        headers: {
          apikey: backend.health.anonKey,
          Authorization: `Bearer ${session?.access_token ?? backend.health.anonKey}`,
        },
      });
      results.push({
        label: 'Supabase REST API',
        ok: restRes.ok,
        detail: `HTTP ${restRes.status} (${backend.health.url})`,
      });
    } catch (err) {
      results.push({
        label: 'Supabase REST API',
        ok: false,
        detail: err instanceof Error ? err.message : 'Unreachable',
      });
    }

    try {
      const { data, error } = await backend.supabase.rpc('app_schema_version');
      results.push({
        label: 'Authority Database Schema',
        ok: !error && Number(data) === SCHEMA_VERSION,
        detail: error
          ? error.message
          : `app_schema_version() = ${data} (expected ${SCHEMA_VERSION})`,
      });
    } catch (err) {
      results.push({
        label: 'Authority Database Schema',
        ok: false,
        detail: err instanceof Error ? err.message : 'RPC failed',
      });
    }

    setHealthResults(results);
    setTestingHealth(false);
  };

  const handleSaveConnection = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    try {
      saveRuntimeSupabaseConfig({ url, anonKey });
      setAnonKey('');
      onBackendChanged();
      setStatusMsg('Updated Cloud Authority Supabase endpoint.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid configuration.',
      );
    }
  };

  const handleResetToBuildEnv = async () => {
    clearRuntimeSupabaseConfig();
    onBackendChanged();
    setStatusMsg('Restored build-time VITE_SUPABASE_URL configuration.');
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    const check = validatePasswordUpdate({
      password: newPassword,
      confirmPassword,
    });
    if (!check.ok) {
      setErrorMsg(check.error);
      return;
    }

    setBusy(true);
    try {
      const { error } = await backend.supabase.auth.updateUser({
        password: check.password,
      });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg('Cloud operator password rotated cleanly.');
    } catch (err) {
      setErrorMsg(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {errorMsg ? (
        <div
          style={{
            backgroundColor: 'var(--danger-soft)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            color: 'var(--danger-text)',
          }}
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      {statusMsg ? (
        <div
          style={{
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent-border)',
            color: 'var(--accent-primary)',
          }}
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      ) : null}

      {/* Live Cloud Self-Test */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
            >
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Cloud Authority Connection Self-Test
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Auto-connected over HTTPS to{' '}
                <code className="font-mono">{backend.health?.url}</code>
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={testingHealth || !isOnline}
            onClick={handleRunHealthCheck}
            className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${testingHealth ? 'animate-spin' : ''}`}
            />
            {testingHealth ? 'Testing...' : 'Run Connection Test'}
          </button>
        </div>

        {healthResults ? (
          <div className="console-well mt-4 space-y-2 rounded-xl p-4 font-mono text-xs">
            {healthResults.map((item) => (
              <div
                key={item.label}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="inline-flex items-center gap-2 font-semibold">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      item.ok ? 'bg-emerald-400' : 'bg-rose-400'
                    }`}
                  />
                  {item.label}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Card 1: Authenticated Cloud Admin Session & Password Rotation */}
        <section className="console-panel rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
            >
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Authenticated Cloud Admin Session
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Verified immutable{' '}
                <code className="font-mono">
                  app_metadata.role = &quot;admin&quot;
                </code>{' '}
                claim.
              </p>
            </div>
          </div>

          <div className="console-well mt-5 space-y-2 rounded-xl p-4 font-mono text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                CLOUD ADMIN VERIFIED
              </span>
              <span
                style={{ color: 'var(--text-muted)' }}
                className="text-[10.5px]"
              >
                role={user?.app_metadata?.role ?? 'admin'}
              </span>
            </div>
            <div className="truncate">{user?.email}</div>
            <div
              style={{ color: 'var(--text-muted)' }}
              className="truncate text-[10.5px]"
            >
              uid={user?.id}
            </div>
          </div>

          <form onSubmit={handlePasswordChange} className="mt-5 space-y-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <KeyRound className="h-3.5 w-3.5 text-sky-400" />
              Rotate Operator Password
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  New Password (min {MIN_ADMIN_PASSWORD_LENGTH} chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={MIN_ADMIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="console-input mt-1 w-full rounded-lg px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={MIN_ADMIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="console-input mt-1 w-full rounded-lg px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="submit"
                disabled={busy || !isOnline}
                className="console-btn-primary rounded-lg px-4 py-2 text-xs disabled:opacity-50"
              >
                {busy ? 'Updating...' : 'Update Password'}
              </button>

              <button
                type="button"
                onClick={onSignOut}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
              >
                <LogOut className="h-3.5 w-3.5 text-rose-400" />
                Sign Out Session
              </button>
            </div>
          </form>
        </section>

        {/* Card 2: Cloud Authority Endpoint Override */}
        <section className="console-panel rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--info-soft)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sky-400"
            >
              <Database className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Cloud Supabase Endpoint Configuration
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Auto-loaded from <code className="font-mono">VITE_SUPABASE_URL</code>{' '}
                &amp; <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>;
                rejects <code className="font-mono">service_role</code> keys.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveConnection} className="mt-5 space-y-4">
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Authority Supabase Project URL
              </label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-authority-ref.supabase.co"
                className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 font-mono text-xs"
              />
            </div>

            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Public Publishable / Anon Key
              </label>
              <input
                type="password"
                required
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                placeholder="sb_publishable_..."
                className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 font-mono text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                className="console-btn-primary rounded-lg px-4 py-2 text-xs"
              >
                Update Cloud Endpoint
              </button>
              {backend.isRuntimeConfigured && backend.hasBuildEnv ? (
                <button
                  type="button"
                  onClick={handleResetToBuildEnv}
                  className="console-btn-secondary rounded-lg px-3.5 py-2 text-xs font-medium"
                >
                  Use Build-Time Env Secrets
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>

      {/* Bootstrap SQL Reference */}
      <section className="console-code overflow-hidden rounded-2xl">
        <div className="border-b border-slate-800 px-5 py-3 font-mono text-xs font-semibold text-slate-200">
          SQL Bootstrap — Provision Cloud Admin Operators (Authority SQL Editor)
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">{`-- 1. Create the operator user under Authentication -> Users in your Supabase Dashboard.
-- 2. Grant immutable admin standing (never use mutable user_metadata):
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'ops@yourdomain.com';`}</pre>
      </section>
    </div>
  );
}
