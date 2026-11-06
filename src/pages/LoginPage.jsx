import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  buildPasswordRecoveryRedirectUrl,
  isAuthorizedAdminUser,
  validateEmailOnly,
  validatePasswordUpdate,
  validateSignInCredentials,
} from '../lib/auth.mjs';
import {
  clearRuntimeSupabaseConfig,
  hasBuildTimeSupabaseConfig,
  saveRuntimeSupabaseConfig,
} from '../lib/supabase.js';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

export default function LoginPage({
  backend,
  session,
  recoveryMode,
  theme,
  onToggleTheme,
  onBackendChanged,
  onSessionRefreshed,
  onRecoveryCompleted,
}) {
  const isCloudConnected = backend.mode === 'cloud';
  const signedInUser = session?.user ?? null;
  const isNonAdminUser =
    Boolean(signedInUser) && !isAuthorizedAdminUser(signedInUser) && !recoveryMode;

  const [editingEndpoint, setEditingEndpoint] = useState(!isCloudConnected);
  const [view, setView] = useState(recoveryMode ? 'recovery' : 'signin');

  // Endpoint config inputs
  const [endpointUrl, setEndpointUrl] = useState(backend.health?.url ?? '');
  const [endpointAnonKey, setEndpointAnonKey] = useState('');

  // Auth inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    setEditingEndpoint(!isCloudConnected);
  }, [isCloudConnected]);

  useEffect(() => {
    if (recoveryMode) {
      setView('recovery');
    }
  }, [recoveryMode]);

  const handleSaveEndpoint = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    try {
      saveRuntimeSupabaseConfig({
        url: endpointUrl,
        anonKey: endpointAnonKey,
      });
      setEndpointAnonKey('');
      setEditingEndpoint(false);
      onBackendChanged();
      setInfoMsg('Authority endpoint verified. Sign in with your admin credentials.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid Supabase endpoint configuration.',
      );
    }
  };

  const handleClearEndpoint = () => {
    clearRuntimeSupabaseConfig();
    setEditingEndpoint(true);
    setErrorMsg('');
    setInfoMsg('');
    onBackendChanged();
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const check = validateSignInCredentials({ email, password });
    if (!check.ok) {
      setErrorMsg(check.error);
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await backend.supabase.auth.signInWithPassword({
        email: check.email,
        password: check.password,
      });
      if (error) throw error;
      setPassword('');
      onSessionRefreshed?.(data.session);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Authentication failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSendResetEmail = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const check = validateEmailOnly(email);
    if (!check.ok) {
      setErrorMsg(check.error);
      return;
    }

    setBusy(true);
    try {
      const { error } = await backend.supabase.auth.resetPasswordForEmail(
        check.email,
        {
          redirectTo: buildPasswordRecoveryRedirectUrl(),
        },
      );
      if (error) throw error;
      setInfoMsg(
        `If an operator account exists for ${check.email}, a password recovery link has been dispatched.`,
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to send recovery email.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompletePasswordReset = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

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
      const { data, error } = await backend.supabase.auth.updateUser({
        password: check.password,
      });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      const { data: refreshed } = await backend.supabase.auth.refreshSession();
      onSessionRefreshed?.(refreshed?.session ?? null);
      onRecoveryCompleted?.();
      if (!isAuthorizedAdminUser(data?.user)) {
        setInfoMsg('Password updated. Verify your admin role claim to continue.');
      }
      setView('signin');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to update operator password.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshPrivileges = async () => {
    if (!backend.supabase) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await backend.supabase.auth.refreshSession();
      if (error) throw error;
      onSessionRefreshed?.(data.session);
      if (!isAuthorizedAdminUser(data.session?.user)) {
        setErrorMsg(
          'Session refreshed, but app_metadata.role is still not set to "admin". Run the SQL grant below first.',
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to refresh session.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!backend.supabase) return;
    setBusy(true);
    try {
      await backend.supabase.auth.signOut();
      onSessionRefreshed?.(null);
    } finally {
      setBusy(false);
    }
  };

  const sqlRoleSnippet = signedInUser?.email
    ? `update auth.users\nset raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb\nwhere email = '${signedInUser.email.replace(/'/g, "''")}';`
    : '';

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sqlRoleSnippet);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
      className="relative flex min-h-screen flex-col justify-between px-4 py-6 sm:px-6"
    >
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
          >
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">
              myClinic License Authority
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="block font-mono text-[10px]"
            >
              ZERO-TRUST RS256 CONTROL PLANE
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          title={
            theme === 'dark'
              ? 'Switch to Daylight Console'
              : 'Switch to Obsidian Dark Console'
          }
          aria-label="Toggle color theme"
          className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-300" />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" />
          )}
        </button>
      </div>

      {/* Center Auth Gate Card */}
      <div className="mx-auto my-8 w-full max-w-md">
        <div className="console-panel overflow-hidden rounded-2xl">
          {/* Card Header */}
          <div
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
            className="px-6 py-5"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent-primary)',
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
              >
                <Lock className="h-3 w-3" />
                Restricted Admin Gate
              </span>
              <span
                style={{ color: 'var(--text-muted)' }}
                className="font-mono text-[10px]"
              >
                v{APP_VERSION} · Schema v{SCHEMA_VERSION}
              </span>
            </div>

            <h1 className="mt-3 text-base font-semibold tracking-tight">
              {editingEndpoint
                ? 'Connect Authority Supabase Endpoint'
                : isNonAdminUser
                  ? '403 · Admin Role Claim Required'
                  : view === 'recovery'
                    ? 'Set New Operator Password'
                    : view === 'forgot'
                      ? 'Operator Password Recovery'
                      : 'Sign In to License Authority'}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">
              {editingEndpoint
                ? 'Configure your Cloud Authority URL and public publishable/anon key before authenticating.'
                : isNonAdminUser
                  ? 'Your account is authenticated, but lacks immutable app_metadata.role = "admin" privileges.'
                  : view === 'recovery'
                    ? 'Choose a strong password (minimum 10 characters) for your operator account.'
                    : view === 'forgot'
                      ? 'Request a single-use password reset link via Supabase Auth.'
                      : 'Authenticate with an authorized operator account to manage clinics and RS256 keys.'}
            </p>
          </div>

          <div className="space-y-4 p-6">
            {errorMsg ? (
              <div
                role="alert"
                style={{
                  backgroundColor: 'var(--danger-soft)',
                  border: '1px solid rgba(244, 63, 94, 0.35)',
                  color: 'var(--danger-text)',
                }}
                className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            ) : null}

            {infoMsg ? (
              <div
                role="status"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent-primary)',
                }}
                className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            ) : null}

            {/* STATE 1: Connect Authority Endpoint */}
            {editingEndpoint ? (
              <form onSubmit={handleSaveEndpoint} className="space-y-4">
                <div>
                  <label
                    htmlFor="auth-supabase-url"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Authority Supabase Project URL
                  </label>
                  <input
                    id="auth-supabase-url"
                    type="url"
                    required
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://your-authority-ref.supabase.co"
                    className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-supabase-anon"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Public Publishable / Anon Key
                  </label>
                  <input
                    id="auth-supabase-anon"
                    type="password"
                    required
                    value={endpointAnonKey}
                    onChange={(e) => setEndpointAnonKey(e.target.value)}
                    placeholder="sb_publishable_..."
                    className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                  />
                  <p
                    style={{ color: 'var(--text-muted)' }}
                    className="mt-1.5 text-[11px]"
                  >
                    Zero-trust check blocks <code className="font-mono">service_role</code>{' '}
                    and <code className="font-mono">sb_secret_</code> keys automatically.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  {isCloudConnected ? (
                    <button
                      type="button"
                      onClick={() => setEditingEndpoint(false)}
                      className="console-btn-secondary rounded-lg px-3.5 py-2 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs sm:w-auto"
                  >
                    <Database className="h-3.5 w-3.5" />
                    Save &amp; Continue to Sign In
                  </button>
                </div>
              </form>
            ) : isNonAdminUser ? (
              /* STATE 2: Authenticated, Missing app_metadata.role === 'admin' */
              <div className="space-y-4">
                <div className="console-well rounded-xl p-3.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-amber-400">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      UNAUTHORIZED ROLE
                    </span>
                    <span
                      style={{ color: 'var(--text-muted)' }}
                      className="font-mono text-[10px]"
                    >
                      role={String(signedInUser.app_metadata?.role ?? 'none')}
                    </span>
                  </div>
                  <div className="mt-1.5 truncate font-mono text-xs">
                    {signedInUser.email}
                  </div>
                </div>

                <div className="console-code overflow-hidden rounded-xl">
                  <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2">
                    <span className="font-mono text-[10px] font-semibold text-slate-300">
                      Run in Authority Supabase SQL Editor
                    </span>
                    <button
                      type="button"
                      onClick={copySql}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-200 hover:bg-slate-700"
                    >
                      {copiedSql ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy SQL
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                    {sqlRoleSnippet}
                  </pre>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRefreshPrivileges}
                    className="console-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
                    />
                    Re-Verify Privileges
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSignOut}
                    className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </button>
                </div>
              </div>
            ) : view === 'recovery' ? (
              /* STATE 3: Password Recovery / Set New Password */
              <form onSubmit={handleCompletePasswordReset} className="space-y-4">
                <div>
                  <label
                    htmlFor="recovery-new-password"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    New Password (min {MIN_ADMIN_PASSWORD_LENGTH} characters)
                  </label>
                  <input
                    id="recovery-new-password"
                    type="password"
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="recovery-confirm-password"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="recovery-confirm-password"
                    type="password"
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Update Operator Password
                </button>
              </form>
            ) : view === 'forgot' ? (
              /* STATE 4: Forgot Password Request */
              <form onSubmit={handleSendResetEmail} className="space-y-4">
                <div>
                  <label
                    htmlFor="forgot-operator-email"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Operator Email Address
                  </label>
                  <div className="relative mt-1.5">
                    <Mail
                      style={{ color: 'var(--text-muted)' }}
                      className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <input
                      id="forgot-operator-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ops@yourdomain.com"
                      className="console-input w-full rounded-lg py-2 pr-3 pl-9 text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Send Password Recovery Link
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setInfoMsg('');
                    setView('signin');
                  }}
                  style={{ color: 'var(--text-secondary)' }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Admin Sign In
                </button>
              </form>
            ) : (
              /* STATE 5: Standard Admin Email + Password Sign-In */
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="console-well flex items-center justify-between gap-2 rounded-lg px-3 py-2 font-mono text-[11px]">
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate">{backend.health.url}</span>
                  </span>
                  {!hasBuildTimeSupabaseConfig() || backend.isRuntimeConfigured ? (
                    <button
                      type="button"
                      onClick={() => setEditingEndpoint(true)}
                      style={{ color: 'var(--accent-primary)' }}
                      className="shrink-0 text-[10.5px] font-semibold hover:underline"
                    >
                      Change
                    </button>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="signin-operator-email"
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Operator Email
                  </label>
                  <div className="relative mt-1.5">
                    <Mail
                      style={{ color: 'var(--text-muted)' }}
                      className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <input
                      id="signin-operator-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ops@yourdomain.com"
                      className="console-input w-full rounded-lg py-2 pr-3 pl-9 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="signin-operator-password"
                      style={{ color: 'var(--text-secondary)' }}
                      className="block text-xs font-medium"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setInfoMsg('');
                        setView('forgot');
                      }}
                      style={{ color: 'var(--accent-primary)' }}
                      className="text-[11px] font-semibold hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative mt-1.5">
                    <Lock
                      style={{ color: 'var(--text-muted)' }}
                      className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    />
                    <input
                      id="signin-operator-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="console-input w-full rounded-lg py-2 pr-9 pl-9 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{ color: 'var(--text-muted)' }}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 hover:opacity-100"
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
                  disabled={busy}
                  className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Authenticate Operator
                </button>

                {backend.isRuntimeConfigured ? (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleClearEndpoint}
                      style={{ color: 'var(--text-muted)' }}
                      className="text-[11px] hover:underline"
                    >
                      Disconnect saved Supabase endpoint
                    </button>
                  </div>
                ) : null}
              </form>
            )}
          </div>

          {/* Zero-Trust Footer Notice */}
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-well)',
              color: 'var(--text-muted)',
            }}
            className="px-6 py-3 text-[11px] leading-relaxed"
          >
            Public sign-up is disabled. Provision operators in{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              Supabase Auth
            </strong>{' '}
            with{' '}
            <code className="font-mono">app_metadata.role = &quot;admin&quot;</code>.
          </div>
        </div>
      </div>

      {/* Bottom Security Strip */}
      <div
        style={{ color: 'var(--text-muted)' }}
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 font-mono text-[10.5px]"
      >
        <span>RS256 2048-BIT · ROW-LEVEL SECURITY ENFORCED</span>
        <span>NO THIRD-PARTY PAYMENT GATEWAYS · ZERO DEMO BYPASS</span>
      </div>
    </div>
  );
}
