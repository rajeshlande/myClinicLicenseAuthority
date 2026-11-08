import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  LogOut,
  RotateCcw,
  Save,
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
  const [connError, setConnError] = useState('');
  const [connStatus, setConnStatus] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  function handleSaveConnection(event) {
    event.preventDefault();
    setConnError('');
    setConnStatus('');
    try {
      saveRuntimeSupabaseConfig({
        url: urlInput,
        anonKey: anonKeyInput,
      });
      setAnonKeyInput('');
      setConnStatus('Connection updated.');
      onBackendChanged?.();
    } catch (err) {
      setConnError(err.message || 'Invalid connection configuration.');
    }
  }

  function handleResetToBuildEnv() {
    clearRuntimeSupabaseConfig();
    setConnError('');
    setConnStatus('Reverted to default service configuration.');
    onBackendChanged?.();
  }

  async function handleRunSelfTest() {
    setTesting(true);
    setTestResult(null);
    const started = performance.now();
    try {
      if (!backend?.configured || !client) {
        throw new Error('Service connection is not configured.');
      }

      const { error } = await client
        .from('admin_license_view')
        .select('license_id', { count: 'exact', head: true });
      if (error) {
        throw new Error(error.message || 'Database check failed.');
      }

      const latencyMs = Math.round(performance.now() - started);
      setTestResult({
        ok: true,
        latencyMs,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err.message || 'Connection test failed.',
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setPwError('');
    setPwSuccess('');

    const check = validatePasswordUpdate({
      password: newPassword,
      confirmPassword,
    });
    if (!check.ok) {
      setPwError(check.error);
      return;
    }

    if (!client) {
      setPwError('Service connection is unavailable.');
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await client.auth.updateUser({
        password: check.password,
      });
      if (error) {
        throw error;
      }
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Password updated.');
    } catch (err) {
      setPwError(formatAuthErrorMessage(err));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 1. Account */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <KeyRound
                style={{ color: 'var(--accent-primary)' }}
                className="h-4 w-4"
              />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Account</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                {operatorEmail || 'Signed in'}
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
            <div
              role="alert"
              style={{
                backgroundColor: 'var(--danger-soft)',
                border: '1px solid rgba(244, 63, 94, 0.35)',
                color: 'var(--danger-text)',
              }}
              className="flex items-start gap-2 rounded-xl p-3 text-xs"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{pwError}</span>
            </div>
          ) : null}

          {pwSuccess ? (
            <div
              role="status"
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
                color: 'var(--accent-primary)',
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
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
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
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
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

      {/* 2. Service Connection */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
              <h2 className="text-sm font-semibold">Service connection</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                {backend?.configured ? 'Connected' : 'Not configured'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={testing}
            onClick={handleRunSelfTest}
            className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            {testing ? 'Checking...' : 'Test connection'}
          </button>
        </div>

        {testResult ? (
          <div
            style={
              testResult.ok
                ? {
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-border)',
                    color: 'var(--accent-primary)',
                  }
                : {
                    backgroundColor: 'var(--danger-soft)',
                    border: '1px solid rgba(244, 63, 94, 0.35)',
                    color: 'var(--danger-text)',
                  }
            }
            className="mt-4 flex items-center gap-2 rounded-xl p-3 text-xs"
          >
            {testResult.ok ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Service healthy ({testResult.latencyMs} ms)</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{testResult.message}</span>
              </>
            )}
          </div>
        ) : null}

        {connError ? (
          <div
            role="alert"
            style={{
              backgroundColor: 'var(--danger-soft)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              color: 'var(--danger-text)',
            }}
            className="mt-4 flex items-start gap-2 rounded-xl p-3 text-xs"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{connError}</span>
          </div>
        ) : null}

        {connStatus ? (
          <div
            role="status"
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent-primary)',
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
              Service URL
            </label>
            <input
              id="setup-supabase-url"
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://your-project.supabase.co"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
            />
          </div>

          <div>
            <label
              htmlFor="setup-supabase-anon"
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Public client key
            </label>
            <input
              id="setup-supabase-anon"
              type="password"
              required
              value={anonKeyInput}
              onChange={(e) => setAnonKeyInput(e.target.value)}
              placeholder="Paste public publishable / anon key"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
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
    </div>
  );
}

export default SetupPage;
