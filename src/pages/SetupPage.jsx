import React, { useState } from 'react';
import {
  Activity,
  Bug,
  Check,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  LogOut,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  formatAuthErrorMessage,
  isAuthorizedAdminUser,
  validatePasswordUpdate,
} from '../lib/auth.mjs';
import { probeCentralAutoSync } from '../lib/auto-sync-client.mjs';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import {
  clearRecentErrors,
  diagnosticsText,
  recentErrors,
  rememberError,
} from '../lib/errors.mjs';
import {
  clearRuntimeSupabaseConfig,
  saveRuntimeSupabaseConfig,
} from '../lib/supabase.js';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

export function SetupPage({
  backend,
  session,
  onBackendChanged,
  onSignOut,
}) {
  const client = backend?.supabase ?? null;
  const operatorEmail = session?.user?.email ?? '';

  const [urlInput, setUrlInput] = useState(backend?.health?.url ?? '');
  const [anonKeyInput, setAnonKeyInput] = useState('');
  const [connError, setConnError] = useState(null);
  const [connStatus, setConnStatus] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState('');

  const [errorLog, setErrorLog] = useState(() => recentErrors());
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [diagCopyError, setDiagCopyError] = useState('');

  function refreshErrorLog() {
    setErrorLog(recentErrors());
  }

  function handleSaveConnection(event) {
    event.preventDefault();
    setConnError(null);
    setConnStatus('');
    try {
      saveRuntimeSupabaseConfig({
        url: urlInput,
        anonKey: anonKeyInput,
      });
      setAnonKeyInput('');
      setConnStatus('Central Supabase connection saved.');
      onBackendChanged?.();
    } catch (err) {
      const explained = rememberError(err, 'Save Central connection');
      setConnError(explained);
      refreshErrorLog();
    }
  }

  function handleResetToBuildEnv() {
    clearRuntimeSupabaseConfig();
    setConnError(null);
    setConnStatus('Reverted to default build configuration.');
    onBackendChanged?.();
  }

  async function handleRunSelfTest() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    const started = performance.now();

    try {
      if (!backend?.configured || !client) {
        throw new Error('Service connection is not configured.');
      }

      if (!isAuthorizedAdminUser(session?.user)) {
        const roleErr = new Error('Operator lacks app_metadata.role = "admin".');
        roleErr.code = '42501';
        throw roleErr;
      }

      const { count, error } = await client
        .from('admin_license_view')
        .select('license_id', { count: 'exact', head: true });
      if (error) throw error;

      let autoSyncStatus = 'ready (Schema v2)';
      try {
        await probeCentralAutoSync(
          backend.health?.url ?? '',
          backend.health?.anonKey ?? '',
          { timeoutMs: 8000 },
        );
      } catch (rpcErr) {
        if (rpcErr?.code === 'SCHEMA_V2_REQUIRED') {
          autoSyncStatus = 're-run schema.sql (v2) in SQL Editor';
        } else {
          autoSyncStatus = rpcErr?.message || 'unreachable';
        }
      }

      const latencyMs = Math.round(performance.now() - started);
      setTestResult({
        ok: true,
        latencyMs,
        licenseCount: count ?? 0,
        autoSyncStatus,
      });
    } catch (err) {
      const explained = rememberError(err, 'System health check');
      setTestError(explained);
      refreshErrorLog();
    } finally {
      setTesting(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setPwError(null);
    setPwSuccess('');

    const check = validatePasswordUpdate({
      password: newPassword,
      confirmPassword,
    });
    if (!check.ok) {
      setPwError({
        message: check.error,
        hint: `Enter at least ${MIN_ADMIN_PASSWORD_LENGTH} characters and ensure both password fields match.`,
        fixLabel: 'Fix password',
      });
      return;
    }

    if (!client) {
      const explained = rememberError(
        'Service connection is unavailable.',
        'Change password',
      );
      setPwError(explained);
      refreshErrorLog();
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await client.auth.updateUser({
        password: check.password,
      });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Operator password updated.');
    } catch (err) {
      const explained = rememberError(err, 'Change password');
      setPwError({
        ...explained,
        message: formatAuthErrorMessage(err) || explained.message,
      });
      refreshErrorLog();
    } finally {
      setPwBusy(false);
    }
  }

  async function handleCopyDiagnostics() {
    setDiagCopyError('');
    const report = diagnosticsText({
      app: APP_VERSION,
      schema: SCHEMA_VERSION,
      route: 'setup',
    });
    const res = await copyTextToClipboard(report);
    if (!res.ok) {
      setDiagCopyError(res.error);
      return;
    }
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 1800);
  }

  function handleClearDiagnostics() {
    clearRecentErrors();
    setErrorLog([]);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 1. Central Connection & 3-Point Health Check */}
        <section className="console-panel relative overflow-hidden rounded-2xl p-5 sm:p-6">
          <span className="cf-top-stripe absolute inset-x-0 top-0 h-[3px]" />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                style={{
                  backgroundColor: 'var(--cf-orange-soft)',
                  border: '1px solid var(--cf-orange-border)',
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              >
                <Database style={{ color: 'var(--cf-orange)' }} className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Central Supabase Endpoint</h2>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                  {backend?.configured ? 'Connected to Cloud Supabase' : 'Not configured'}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={testing}
              onClick={handleRunSelfTest}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              <Activity className="h-3.5 w-3.5 text-emerald-500" />
              {testing ? 'Checking...' : '3-Point Health Check'}
            </button>
          </div>

          {testResult ? (
            <div
              role="status"
              style={{
                backgroundColor: 'var(--ok-soft)',
                border: '1px solid var(--ok-border)',
                color: 'var(--ok-text)',
              }}
              className="mt-4 flex items-start gap-2 rounded-xl p-3 text-xs"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Admin auth + RLS view healthy ({testResult.latencyMs} ms ·{' '}
                {testResult.licenseCount} clinics) · Auto-Sync RPC:{' '}
                {testResult.autoSyncStatus}
              </span>
            </div>
          ) : null}

          {testError ? (
            <div className="mt-4">
              <ErrorAlert
                error={testError}
                context="Health check failed"
                onRetry={handleRunSelfTest}
                onDismiss={() => setTestError(null)}
              />
            </div>
          ) : null}

          {connError ? (
            <div className="mt-4">
              <ErrorAlert
                error={connError}
                context="Invalid connection settings"
                onDismiss={() => setConnError(null)}
              />
            </div>
          ) : null}

          {connStatus ? (
            <div
              role="status"
              style={{
                backgroundColor: 'var(--ok-soft)',
                border: '1px solid var(--ok-border)',
                color: 'var(--ok-text)',
              }}
              className="mt-4 flex items-start gap-2 rounded-xl p-3 text-xs"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{connStatus}</span>
            </div>
          ) : null}

          <form onSubmit={handleSaveConnection} className="mt-5 space-y-3.5">
            <div>
              <label
                htmlFor="setup-supabase-url"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Central Supabase URL
              </label>
              <input
                id="setup-supabase-url"
                type="url"
                required
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://your-project.supabase.co"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="setup-supabase-anon"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Public Client Key (anon / sb_publishable_)
              </label>
              <input
                id="setup-supabase-anon"
                type="password"
                required
                value={anonKeyInput}
                onChange={(e) => setAnonKeyInput(e.target.value)}
                placeholder="Paste publishable / anon key"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
              >
                <Save className="h-3.5 w-3.5" />
                Save connection
              </button>

              {backend?.isRuntimeConfigured ? (
                <button
                  type="button"
                  onClick={handleResetToBuildEnv}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset default
                </button>
              ) : null}
            </div>
          </form>
        </section>

        {/* 2. Operator Account */}
        <section className="console-panel rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                style={{
                  backgroundColor: 'var(--cf-orange-soft)',
                  border: '1px solid var(--cf-orange-border)',
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              >
                <KeyRound style={{ color: 'var(--cf-orange)' }} className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Operator Account</h2>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                  {operatorEmail || 'Signed in'} · v{APP_VERSION} (Schema v{SCHEMA_VERSION})
                </p>
              </div>
            </div>

            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            ) : null}
          </div>

          <form onSubmit={handleChangePassword} className="mt-5 space-y-3.5">
            {pwError ? (
              <ErrorAlert
                error={pwError}
                context="Password update failed"
                onDismiss={() => setPwError(null)}
              />
            ) : null}

            {pwSuccess ? (
              <div
                role="status"
                style={{
                  backgroundColor: 'var(--ok-soft)',
                  border: '1px solid var(--ok-border)',
                  color: 'var(--ok-text)',
                }}
                className="flex items-start gap-2 rounded-xl p-3 text-xs"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{pwSuccess}</span>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="setup-new-pw"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                New password
              </label>
              <input
                id="setup-new-pw"
                type="password"
                required
                minLength={MIN_ADMIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`Minimum ${MIN_ADMIN_PASSWORD_LENGTH} characters`}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="setup-confirm-pw"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Confirm password
              </label>
              <input
                id="setup-confirm-pw"
                type="password"
                required
                minLength={MIN_ADMIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={pwBusy}
              className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {pwBusy ? 'Saving...' : 'Update password'}
            </button>
          </form>
        </section>
      </div>

      {/* 3. Sanitized Diagnostics & Recent Error Log */}
      <section className="console-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--cf-orange-soft)',
                border: '1px solid var(--cf-orange-border)',
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            >
              <Bug style={{ color: 'var(--cf-orange)' }} className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold">Diagnostics &amp; Recent Errors</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Last {errorLog.length} error(s) in this session — JWTs and secrets are
                redacted automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              {copiedDiag ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Copied diagnostics
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy diagnostics
                </>
              )}
            </button>

            {errorLog.length > 0 ? (
              <button
                type="button"
                onClick={handleClearDiagnostics}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {diagCopyError ? (
          <div className="mt-3">
            <ErrorAlert
              error={diagCopyError}
              context="Clipboard warning"
              onDismiss={() => setDiagCopyError('')}
            />
          </div>
        ) : null}

        {errorLog.length === 0 ? (
          <p
            style={{ color: 'var(--text-muted)' }}
            className="console-well mt-4 rounded-xl px-4 py-3 font-mono text-xs"
          >
            No errors recorded in this session.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {errorLog.map((entry, idx) => (
              <div
                key={`${entry.at}-${idx}`}
                className="console-well rounded-xl p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span style={{ color: 'var(--danger-text)' }} className="font-semibold">
                    {entry.message}
                  </span>
                  <span
                    style={{ color: 'var(--text-muted)' }}
                    className="font-mono text-[11px]"
                  >
                    {entry.at}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1">
                  <strong>Fix:</strong> {entry.hint}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default SetupPage;
