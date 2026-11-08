import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  WifiOff,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  buildPasswordRecoveryRedirectUrl,
  formatAuthErrorMessage,
  validateAdminCredentials,
  validatePasswordUpdate,
  validateRecoveryEmail,
} from '../lib/auth.mjs';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { buildAdminGrantSql, rememberError } from '../lib/errors.mjs';
import { saveRuntimeSupabaseConfig } from '../lib/supabase.js';

export function LoginPage({
  backend,
  session,
  isOnline = true,
  recoveryMode = false,
  theme,
  onToggleTheme,
  onBackendChanged,
  onSessionRefreshed,
  onRecoveryCompleted,
}) {
  const configured = Boolean(backend?.configured);
  const client = backend?.supabase ?? null;

  const [view, setView] = useState('signin'); // 'signin' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [showEndpointForm, setShowEndpointForm] = useState(!configured);
  const [endpointUrl, setEndpointUrl] = useState(backend?.health?.url ?? '');
  const [endpointAnonKey, setEndpointAnonKey] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [copiedAdminSql, setCopiedAdminSql] = useState(false);

  const signedInNonAdmin =
    configured && Boolean(session?.user) && !recoveryMode;

  const nonAdminSql = useMemo(
    () => buildAdminGrantSql(session?.user?.email || 'ops@yourdomain.com'),
    [session?.user?.email],
  );

  async function handleCopyNonAdminSql() {
    const res = await copyTextToClipboard(nonAdminSql);
    if (!res.ok) {
      setErrorState(rememberError(res.error, 'Copy admin SQL'));
      return;
    }
    setCopiedAdminSql(true);
    setTimeout(() => setCopiedAdminSql(false), 1800);
  }

  async function handleSignIn(event) {
    event.preventDefault();
    setErrorState(null);
    setStatusMsg('');

    if (!configured || !client) {
      setErrorState(
        rememberError(
          'Connect your Authority Supabase project URL and public anon key below before signing in.',
          'Sign in',
        ),
      );
      return;
    }

    const check = validateAdminCredentials({ email, password });
    if (!check.ok) {
      setErrorState({
        message: check.error,
        hint: 'Enter the operator email and password registered in Supabase Dashboard → Authentication → Users.',
        fixLabel: 'Check input',
      });
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: check.email,
        password: check.password,
      });
      if (error) {
        throw error;
      }
      setPassword('');
      if (data?.session) {
        onSessionRefreshed?.(data.session);
      }
    } catch (err) {
      const friendly = formatAuthErrorMessage(err);
      const explained = rememberError(err, 'Sign in');
      setErrorState({
        ...explained,
        message: friendly || explained.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSendResetEmail(event) {
    event.preventDefault();
    setErrorState(null);
    setStatusMsg('');

    const check = validateRecoveryEmail(email);
    if (!check.ok) {
      setErrorState({
        message: check.error,
        hint: 'Enter a valid email address such as ops@yourdomain.com.',
        fixLabel: 'Fix email',
      });
      return;
    }

    if (!configured || !client) {
      setErrorState(
        rememberError('Service connection is not configured.', 'Password reset'),
      );
      return;
    }

    setBusy(true);
    try {
      const redirectTo =
        typeof window !== 'undefined'
          ? buildPasswordRecoveryRedirectUrl(window.location.href)
          : undefined;
      const { error } = await client.auth.resetPasswordForEmail(
        check.email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        throw error;
      }
      setStatusMsg(
        'If this account is registered, a password reset link has been sent.',
      );
    } catch (err) {
      const explained = rememberError(err, 'Password reset');
      setErrorState({
        ...explained,
        message: formatAuthErrorMessage(err) || explained.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCompletePasswordRecovery(event) {
    event.preventDefault();
    setErrorState(null);
    setStatusMsg('');

    const check = validatePasswordUpdate({
      password: newPassword,
      confirmPassword: confirmNewPassword,
    });
    if (!check.ok) {
      setErrorState({
        message: check.error,
        hint: `Choose a password with at least ${MIN_ADMIN_PASSWORD_LENGTH} characters and ensure both fields match.`,
        fixLabel: 'Fix password',
      });
      return;
    }

    if (!client) {
      setErrorState(
        rememberError('Service connection is unavailable.', 'Update password'),
      );
      return;
    }

    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({
        password: check.password,
      });
      if (error) {
        throw error;
      }
      setNewPassword('');
      setConfirmNewPassword('');
      setStatusMsg('Password updated.');
      onRecoveryCompleted?.();
    } catch (err) {
      const explained = rememberError(err, 'Update password');
      setErrorState({
        ...explained,
        message: formatAuthErrorMessage(err) || explained.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshAccess() {
    if (!client) return;
    setBusy(true);
    setErrorState(null);
    try {
      const { data, error } = await client.auth.refreshSession();
      if (error) throw error;
      onSessionRefreshed?.(data?.session ?? null);
    } catch (err) {
      setErrorState(rememberError(err, 'Refresh admin standing'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      if (client) {
        await client.auth.signOut();
      }
    } catch (err) {
      rememberError(err, 'Sign out');
    }
    onSessionRefreshed?.(null);
  }

  function handleSaveEndpointOverride(event) {
    event.preventDefault();
    setErrorState(null);
    setStatusMsg('');
    try {
      saveRuntimeSupabaseConfig({
        url: endpointUrl,
        anonKey: endpointAnonKey,
      });
      setEndpointAnonKey('');
      setShowEndpointForm(false);
      setStatusMsg('Authority Supabase connection saved. Sign in below.');
      onBackendChanged?.();
    } catch (err) {
      setErrorState(rememberError(err, 'Save Authority connection'));
    }
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="relative flex min-h-screen flex-col justify-between overflow-x-hidden px-4 py-6 sm:px-6"
    >
      {/* Header */}
      <header className="mx-auto flex w-full max-w-md items-center justify-between">
        <a
          href="https://github.com/rajeshlande/myClinicLicenseAuthority"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5"
        >
          <div
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
          >
            <ShieldCheck
              style={{ color: 'var(--accent-primary)' }}
              className="h-4 w-4"
            />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            myClinicLicenseAuthority
          </span>
        </a>

        <button
          type="button"
          onClick={onToggleTheme}
          title={
            theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'
          }
          aria-label="Toggle color theme"
          className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
        >
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-slate-600" />
          )}
        </button>
      </header>

      {/* Sign-In Card */}
      <main className="mx-auto my-8 w-full max-w-md">
        <div className="console-panel overflow-hidden rounded-2xl">
          <div className="space-y-4 p-6 sm:p-7">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {recoveryMode
                  ? 'Set new password'
                  : signedInNonAdmin
                    ? 'Admin role required'
                    : view === 'forgot'
                      ? 'Reset password'
                      : 'Sign in'}
              </h1>
              <p
                style={{ color: 'var(--text-muted)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                {recoveryMode
                  ? 'Choose a new password for your operator account.'
                  : signedInNonAdmin
                    ? 'Your account signed in, but needs app_metadata.role = "admin" in Supabase.'
                    : view === 'forgot'
                      ? 'Enter your operator email address to receive a password reset link.'
                      : 'Sign in with your Authority operator account.'}
              </p>
            </div>

            {!isOnline ? (
              <div
                style={{
                  backgroundColor: 'var(--warning-soft)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: 'var(--warning-text)',
                }}
                className="flex items-center gap-2 rounded-xl p-3 text-xs"
              >
                <WifiOff className="h-4 w-4 shrink-0" />
                <span>Offline — reconnect to the internet to authenticate.</span>
              </div>
            ) : null}

            {errorState ? (
              <ErrorAlert
                error={errorState}
                context="Authentication error"
                onDismiss={() => setErrorState(null)}
              />
            ) : null}

            {statusMsg ? (
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
                <span>{statusMsg}</span>
              </div>
            ) : null}

            {!configured && !recoveryMode ? (
              <div
                style={{
                  backgroundColor: 'var(--bg-well)',
                  border: '1px solid var(--border-subtle)',
                }}
                className="space-y-3 rounded-xl p-4 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    Quick Setup — Connect Authority Supabase
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEndpointForm((prev) => !prev)}
                    className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px]"
                  >
                    <Settings2 className="h-3 w-3" />
                    {showEndpointForm ? 'Hide' : 'Configure'}
                  </button>
                </div>

                <ol
                  style={{ color: 'var(--text-secondary)' }}
                  className="list-inside list-decimal space-y-1 text-[11px] leading-relaxed"
                >
                  <li>
                    Run <code className="font-mono">supabase/schema.sql</code> in your
                    Authority Supabase SQL Editor.
                  </li>
                  <li>
                    Create an operator in <strong>Authentication → Users</strong> and grant{' '}
                    <code className="font-mono">role = &quot;admin&quot;</code>.
                  </li>
                  <li>
                    Paste your Project URL &amp; Public Anon/Publishable Key below (never a{' '}
                    <code className="font-mono">service_role</code> key).
                  </li>
                </ol>

                {backend?.health?.reason && backend.health.status === 'invalid' ? (
                  <ErrorAlert
                    error={backend.health.reason}
                    context="Invalid Supabase configuration"
                  />
                ) : null}

                {showEndpointForm ? (
                  <form
                    onSubmit={handleSaveEndpointOverride}
                    className="space-y-2.5 pt-1"
                  >
                    <input
                      type="url"
                      required
                      value={endpointUrl}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                      placeholder="https://your-authority-ref.supabase.co"
                      className="console-input w-full rounded-lg px-3 py-2 text-xs"
                    />
                    <input
                      type="password"
                      required
                      value={endpointAnonKey}
                      onChange={(e) => setEndpointAnonKey(e.target.value)}
                      placeholder="Public anon / sb_publishable_ key"
                      className="console-input w-full rounded-lg px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="console-btn-primary w-full rounded-lg px-3 py-2 text-xs font-semibold"
                    >
                      Save &amp; Connect
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}

            {recoveryMode ? (
              <form
                onSubmit={handleCompletePasswordRecovery}
                className="space-y-3.5"
              >
                <div>
                  <label
                    htmlFor="recovery-new-password"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    New password
                  </label>
                  <input
                    id="recovery-new-password"
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
                    htmlFor="recovery-confirm-password"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Confirm password
                  </label>
                  <input
                    id="recovery-confirm-password"
                    type="password"
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {busy ? 'Updating...' : 'Save password'}
                </button>
              </form>
            ) : signedInNonAdmin ? (
              <div className="space-y-4">
                <div
                  style={{
                    backgroundColor: 'var(--bg-well)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  className="space-y-2.5 rounded-xl p-3.5 text-xs"
                >
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Signed in as{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {session.user.email}
                    </strong>
                    . Run this SQL in your Authority Supabase{' '}
                    <strong>SQL Editor</strong>, then click <strong>Check again</strong>:
                  </p>
                  <div className="console-code overflow-hidden rounded-lg">
                    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
                      <span className="font-mono text-[10px] text-slate-400">
                        SQL Editor
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyNonAdminSql}
                        className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-200 hover:bg-slate-700"
                      >
                        {copiedAdminSql ? (
                          <>
                            <Check className="h-2.5 w-2.5 text-emerald-400" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-2.5 w-2.5" /> Copy SQL
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="overflow-x-auto p-3 font-mono text-[10.5px] text-emerald-200">
                      {nonAdminSql}
                    </pre>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRefreshAccess}
                    className="console-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {busy ? 'Checking...' : 'Check again'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            ) : view === 'forgot' ? (
              <form onSubmit={handleSendResetEmail} className="space-y-4">
                <div>
                  <label
                    htmlFor="reset-email"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Email
                  </label>
                  <div className="relative mt-1.5">
                    <Mail
                      style={{ color: 'var(--text-muted)' }}
                      className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <input
                      id="reset-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ops@yourdomain.com"
                      className="console-input w-full rounded-lg py-2.5 pr-3 pl-9 text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy || !configured}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  {busy ? 'Sending...' : 'Send reset link'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setView('signin');
                    setErrorState(null);
                    setStatusMsg('');
                  }}
                  className="console-btn-secondary inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to sign in
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-email"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Email
                  </label>
                  <div className="relative mt-1.5">
                    <Mail
                      style={{ color: 'var(--text-muted)' }}
                      className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ops@yourdomain.com"
                      className="console-input w-full rounded-lg py-2.5 pr-3 pl-9 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="login-password"
                      style={{ color: 'var(--text-secondary)' }}
                      className="block text-xs font-medium"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setView('forgot');
                        setErrorState(null);
                        setStatusMsg('');
                      }}
                      style={{ color: 'var(--accent-primary)' }}
                      className="text-xs font-medium hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="console-input w-full rounded-lg py-2.5 pr-9 pl-3 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      style={{ color: 'var(--text-muted)' }}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1 hover:opacity-80"
                    >
                      {showPassword ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy || !configured}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  {busy ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      <div aria-hidden="true" className="h-4" />
    </div>
  );
}

export default LoginPage;
