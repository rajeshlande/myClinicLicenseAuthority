import React, { useState } from 'react';
import {
  Activity,
  Bug,
  Check,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  RotateCcw,
  Save,
  Trash2,
  Zap,
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
  describeKeepWarmFleet,
  keepWarmStatus,
  probeTenantKeepWarm,
} from '../lib/keep-warm.mjs';
import { maskTenantKey } from '../lib/tenant-connection.mjs';
import { KEEP_WARM } from '../lib/workspace-directory.mjs';
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

/** keep-warm state -> the shell's badge classes. */
const WARM_TONE = {
  fresh: 'badge-success',
  due: 'badge-warning',
  overdue: 'badge-error',
  unknown: 'badge-accent',
  unarmed: 'console-well',
};

export function SetupPage({ backend, session, onBackendChanged, onSignOut }) {
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

  const [warmRows, setWarmRows] = useState(null);
  const [warmBusy, setWarmBusy] = useState(false);
  const [warmError, setWarmError] = useState(null);
  const [warmProbing, setWarmProbing] = useState('');
  const [warmResults, setWarmResults] = useState({});

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

      let autoSyncStatus = `ready (Schema v${SCHEMA_VERSION})`;
      try {
        await probeCentralAutoSync(
          backend.health?.url ?? '',
          backend.health?.anonKey ?? '',
          { timeoutMs: 8000 },
        );
      } catch (rpcErr) {
        if (rpcErr?.code === 'SCHEMA_V2_REQUIRED') {
          autoSyncStatus = `re-run schema.sql (v${SCHEMA_VERSION}) in SQL Editor`;
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

  /**
   * The manual half of the keep-warm cycle. pg_cron + pg_net run it every six
   * hours inside the database; this panel is for the two moments a schedule
   * cannot cover — a project just restored from a free-tier pause, and proving
   * with your own eyes that a tenant answers.
   */
  async function handleLoadKeepWarm() {
    setWarmBusy(true);
    setWarmError(null);
    try {
      if (!backend?.configured || !client) {
        throw new Error('Service connection is not configured.');
      }
      if (!isAuthorizedAdminUser(session?.user)) {
        const roleErr = new Error('Operator lacks app_metadata.role = "admin".');
        roleErr.code = '42501';
        throw roleErr;
      }
      const { data, error } = await client.rpc('due_keep_warm_workspaces', {
        p_limit: 20,
      });
      if (error) throw error;
      setWarmRows(Array.isArray(data) ? data : []);
      setWarmResults({});
    } catch (err) {
      const explained = rememberError(err, 'Load keep-warm list');
      setWarmError(explained);
      refreshErrorLog();
    } finally {
      setWarmBusy(false);
    }
  }

  async function handleProbeWorkspace(row) {
    setWarmProbing(row.id);
    try {
      const res = await probeTenantKeepWarm({
        supabaseUrl: row.supabase_url,
        supabaseAnonKey: row.supabase_anon_key,
      });
      setWarmResults((prev) => ({ ...prev, [row.id]: res }));
      if (client) {
        // p_ok = false on purpose when the probe failed: stamp_keep_warm then
        // moves only updated_at, so a paused project never looks warm.
        const stamp = await client.rpc('stamp_keep_warm', {
          p_workspace: row.id,
          p_ok: res.ok,
        });
        if (stamp.error) throw stamp.error;
        if (res.ok) {
          setWarmRows((prev) =>
            (prev ?? []).map((r) =>
              r.id === row.id ? { ...r, keep_warm_at: res.probedAt } : r,
            ),
          );
        }
      }
      return res;
    } catch (err) {
      const explained = rememberError(err, 'Keep-warm probe');
      setWarmError(explained);
      refreshErrorLog();
      return null;
    } finally {
      setWarmProbing('');
    }
  }

  async function handleProbeAllDue() {
    for (const row of warmRows ?? []) {
      // Sequential on purpose: a fleet-wide parallel burst from one browser tab
      // is exactly the write amplification the rest of this schema avoids.
      await handleProbeWorkspace(row); // eslint-disable-line no-await-in-loop
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
              <span className="badge-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <Database
                  style={{ color: 'var(--brand-text)' }}
                  className="h-4 w-4"
                />
              </span>
              <div>
                <h2 className="text-sm font-bold">Central Supabase Endpoint</h2>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="text-xs"
                >
                  {backend?.configured
                    ? 'Connected to Cloud Supabase'
                    : 'Not configured'}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={testing}
              onClick={handleRunSelfTest}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              <Activity
                style={{ color: 'var(--ok-main)' }}
                className="h-3.5 w-3.5"
              />
              {testing ? 'Checking...' : '3-Point Health Check'}
            </button>
          </div>

          {testResult ? (
            <div
              role="status"
              className="badge-success mt-4 flex items-start gap-2 rounded-xl p-3 text-xs font-medium"
            >
              <CheckCircle2
                style={{ color: 'var(--ok-main)' }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
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
              className="badge-success mt-4 flex items-start gap-2 rounded-xl p-3 text-xs font-medium"
            >
              <CheckCircle2
                style={{ color: 'var(--ok-main)' }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>{connStatus}</span>
            </div>
          ) : null}

          <form onSubmit={handleSaveConnection} className="mt-5 space-y-3.5">
            <div>
              <label
                htmlFor="setup-supabase-url"
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
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
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
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
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
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
              <span className="badge-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <KeyRound
                  style={{ color: 'var(--brand-text)' }}
                  className="h-4 w-4"
                />
              </span>
              <div>
                <h2 className="text-sm font-bold">Operator Account</h2>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="text-xs"
                >
                  {operatorEmail || 'Signed in'} · v{APP_VERSION} (Schema v
                  {SCHEMA_VERSION})
                </p>
              </div>
            </div>

            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
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
                className="badge-success flex items-start gap-2 rounded-xl p-3 text-xs font-medium"
              >
                <CheckCircle2
                  style={{ color: 'var(--ok-main)' }}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>{pwSuccess}</span>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="setup-new-pw"
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
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
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
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

      {/* 3. Tenant Keep-Warm (free-tier projects pause when idle) */}
      <section className="console-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="badge-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Zap
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold">Tenant Keep-Warm</h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="text-xs leading-relaxed"
              >
                {warmRows === null
                  ? `A free-tier Supabase project pauses after ${KEEP_WARM.pause_days} idle days. Central probes every active workspace at least every ${KEEP_WARM.target_days}.`
                  : describeKeepWarmFleet({ workspaces: warmRows }).headline}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={warmBusy}
              onClick={() => void handleLoadKeepWarm()}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {warmBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              {warmBusy ? 'Loading...' : 'Load due tenants'}
            </button>

            {warmRows?.length ? (
              <button
                type="button"
                disabled={Boolean(warmProbing)}
                onClick={() => void handleProbeAllDue()}
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {warmProbing ? 'Probing...' : `Probe all ${warmRows.length}`}
              </button>
            ) : null}
          </div>
        </div>

        {warmError ? (
          <div className="mt-3">
            <ErrorAlert
              error={warmError}
              context="Tenant keep-warm"
              onRetry={() => void handleLoadKeepWarm()}
              onDismiss={() => setWarmError(null)}
            />
          </div>
        ) : null}

        {warmRows !== null && warmRows.length === 0 && !warmError ? (
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="console-well mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed"
          >
            Nothing due — every active workspace was probed inside the{' '}
            {KEEP_WARM.target_days}-day target. The{' '}
            <code className="font-mono">opd-keep-warm</code> pg_cron job (
            <code className="font-mono">{KEEP_WARM.cron_schedule}</code>) keeps
            it that way whether or not this console is open.
          </p>
        ) : null}

        {warmRows?.length ? (
          <ul className="mt-4 space-y-2.5">
            {warmRows.map((row) => {
              const status = keepWarmStatus(row);
              const res = warmResults[row.id];
              const probing = warmProbing === row.id;
              return (
                <li key={row.id} className="console-well rounded-xl p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold">
                        {row.clinic_name}
                      </span>
                      <span
                        style={{ color: 'var(--text-secondary)' }}
                        className="block break-all font-mono text-[10.5px]"
                      >
                        {row.slug} · {maskTenantKey(row.supabase_anon_key)} ·{' '}
                        {String(row.supabase_url ?? '').replace(/^https:\/\//, '')}
                      </span>
                    </div>
                    <span
                      className={`${WARM_TONE[status.state] ?? 'console-well'} shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p
                    style={{ color: 'var(--text-secondary)' }}
                    className="mt-1.5 text-[11px] leading-relaxed"
                  >
                    {status.detail}
                  </p>

                  {res ? (
                    <p
                      className={`${res.ok ? 'badge-success' : 'badge-error'} mt-2 rounded-lg px-3 py-1.5 text-[11px] font-medium leading-relaxed`}
                    >
                      {res.ok
                        ? `Awake — HTTP ${res.status} in ${res.ms} ms; stamped ${res.probedAt}.`
                        : res.reason}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    disabled={probing}
                    onClick={() => void handleProbeWorkspace(row)}
                    className="console-btn-secondary mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                  >
                    {probing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Activity
                        style={{ color: 'var(--ok-main)' }}
                        className="h-3.5 w-3.5"
                      />
                    )}
                    {probing ? 'Probing...' : 'Probe now'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {/* 4. Sanitized Diagnostics & Recent Error Log */}
      <section className="console-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="badge-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Bug
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
            </span>
            <div>
              <h2 className="text-sm font-bold">
                Diagnostics &amp; Recent Errors
              </h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="text-xs"
              >
                Last {errorLog.length} error(s) in this session — JWTs and
                secrets are redacted automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              {copiedDiag ? (
                <>
                  <Check
                    style={{ color: 'var(--ok-main)' }}
                    className="h-3.5 w-3.5"
                  />
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
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
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
            style={{ color: 'var(--text-secondary)' }}
            className="console-well mt-4 rounded-xl px-4 py-3 font-mono text-xs"
          >
            No errors recorded in this session.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {errorLog.map((entry, idx) => (
              <div
                key={`${entry.at}-${idx}`}
                className="badge-error rounded-xl p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{entry.message}</span>
                  <span className="font-mono text-[11px] opacity-85">
                    {entry.at}
                  </span>
                </div>
                <p className="mt-1">
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
