import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
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
  bootstrapLocalAdminOperator,
  buildPasswordRecoveryRedirectUrl,
  getLocalOperatorInfo,
  hasLocalAdminOperator,
  isAuthorizedAdminUser,
  signInLocalAdminOperator,
  validateAdminCredentials,
  validatePasswordUpdate,
  validateRecoveryEmail,
} from '../lib/auth.mjs';
import { clearRuntimeSupabaseConfig } from '../lib/supabase.js';
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
  const isCloudMode = backend.mode === 'cloud';
  const localInitialized = hasLocalAdminOperator();
  const localOperator = getLocalOperatorInfo();

  const [view, setView] = useState('signin'); // 'signin' | 'forgot'

  const [email, setEmail] = useState(() => localOperator?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [newConfirmPassword, setNewConfirmPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);

  const signedInNonAdmin =
    isCloudMode &&
    Boolean(session?.user) &&
    !isAuthorizedAdminUser(session.user);

  const adminGrantSql = useMemo(() => {
    const targetEmail = session?.user?.email ?? 'ops@yourdomain.com';
    return `update auth.users\nset raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb\nwhere email = '${targetEmail.replace(/'/g, "''")}';`;
  }, [session?.user?.email]);

  const handleBootstrapLocalAdmin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    setBusy(true);
    try {
      const localSession = await bootstrapLocalAdminOperator({
        email,
        password,
        confirmPassword,
      });
      setPassword('');
      setConfirmPassword('');
      onSessionRefreshed(localSession);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to initialize operator login.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    const check = validateAdminCredentials({ email, password });
    if (!check.ok) {
      setErrorMsg(check.error);
      return;
    }

    setBusy(true);
    try {
      if (isCloudMode) {
        const { data, error } =
          await backend.supabase.auth.signInWithPassword({
            email: check.email,
            password: check.password,
          });
        if (error) throw error;
        setPassword('');
        onSessionRefreshed(data.session ?? null);
      } else {
        const localSession = await signInLocalAdminOperator({
          email: check.email,
          password: check.password,
        });
        setPassword('');
        onSessionRefreshed(localSession);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Authentication failed. Verify your operator email and password.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSendPasswordReset = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    const check = validateRecoveryEmail(email);
    if (!check.ok) {
      setErrorMsg(check.error);
      return;
    }

    setBusy(true);
    try {
      const redirectTo = buildPasswordRecoveryRedirectUrl(window.location.href);
      const { error } = await backend.supabase.auth.resetPasswordForEmail(
        check.email,
        { redirectTo },
      );
      if (error) throw error;
      setStatusMsg(
        `If ${check.email} is a registered operator, a password recovery link has been dispatched.`,
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to dispatch password reset email.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRecovery = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    const check = validatePasswordUpdate({
      password: newPassword,
      confirmPassword: newConfirmPassword,
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
      setNewConfirmPassword('');
      if (data?.user) {
        const { data: refreshed } =
          await backend.supabase.auth.refreshSession();
        onSessionRefreshed(refreshed?.session ?? session);
      }
      onRecoveryCompleted();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to update password.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRecheckRole = async () => {
    if (!backend.supabase?.auth) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await backend.supabase.auth.refreshSession();
      if (error) throw error;
      onSessionRefreshed(data.session ?? null);
      if (!isAuthorizedAdminUser(data.session?.user)) {
        setErrorMsg(
          'Session refreshed, but app_metadata.role is still not "admin". Run the SQL grant below first.',
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
    if (backend.supabase?.auth) {
      await backend.supabase.auth.signOut();
    }
    onSessionRefreshed(null);
    setErrorMsg('');
    setStatusMsg('');
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(adminGrantSql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 1800);
    } catch {
      // Clipboard API unavailable in restricted iframe contexts.
    }
  };

  const handleSwitchBackToLocalVault = async () => {
    if (backend.supabase?.auth) {
      await backend.supabase.auth.signOut().catch(() => {});
    }
    clearRuntimeSupabaseConfig();
    onSessionRefreshed(null);
    onBackendChanged();
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="flex min-h-screen flex-col justify-between px-4 py-6 sm:px-6"
    >
      {/* Top Security Bar */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
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
              myClinic Authority
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="block font-mono text-[10px]"
            >
              ZERO-TRUST RS256 CONTROL PLANE
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
            className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10.5px] sm:inline-flex"
          >
            <Lock className="h-3 w-3 text-emerald-400" />
            {isCloudMode
              ? 'CLOUD SUPABASE AUTH'
              : 'ADMIN GATE · CONNECT SUPABASE AFTER LOGIN'}
          </span>

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
      </header>

      {/* Main Centered Authentication Card */}
      <main className="mx-auto my-8 w-full max-w-md">
        <div className="console-panel rounded-2xl p-6 sm:p-7">
          {errorMsg ? (
            <div
              style={{
                backgroundColor: 'var(--danger-soft)',
                border: '1px solid rgba(244, 63, 94, 0.35)',
                color: 'var(--danger-text)',
              }}
              className="mb-5 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs"
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
              className="mb-5 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          ) : null}

          {/* STATE 1: Cloud Password Recovery Flow */}
          {isCloudMode && recoveryMode ? (
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider text-emerald-400 uppercase">
                <ShieldCheck className="h-3.5 w-3.5" />
                Password Recovery Verified
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Set New Operator Password
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Choose a strong password of at least{' '}
                <code className="font-mono">{MIN_ADMIN_PASSWORD_LENGTH}</code>{' '}
                characters to restore access.
              </p>

              <form onSubmit={handleCompleteRecovery} className="mt-5 space-y-4">
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 10 characters"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={newConfirmPassword}
                    onChange={(e) => setNewConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? 'Updating Password...' : 'Save Password & Enter Console'}
                </button>
              </form>
            </div>
          ) : /* STATE 2: Cloud Signed-In Non-Admin (403 Missing Claim) */ signedInNonAdmin ? (
            <div>
              <div
                style={{ color: 'var(--danger-text)' }}
                className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider uppercase"
              >
                <ShieldAlert className="h-4 w-4" />
                403 · Admin Role Claim Required
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Insufficient Operator Privileges
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Authenticated as{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {session.user.email}
                </strong>
                , but your JWT does not carry{' '}
                <code className="font-mono">
                  app_metadata.role = &quot;admin&quot;
                </code>
                .
              </p>

              <div className="console-code mt-4 overflow-hidden rounded-xl">
                <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2 font-mono text-[10.5px] text-slate-300">
                  <span>Run in Authority Supabase SQL Editor</span>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                  >
                    {copiedSql ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedSql ? 'Copied' : 'Copy SQL'}
                  </button>
                </div>
                <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                  {adminGrantSql}
                </pre>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRecheckRole}
                  className="console-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
                  />
                  Re-Verify Privileges
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
                >
                  <LogOut className="h-3.5 w-3.5 text-rose-400" />
                  Sign Out
                </button>
              </div>
            </div>
          ) : /* STATE 3: Cloud Forgot Password */ isCloudMode &&
            view === 'forgot' ? (
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider text-sky-400 uppercase">
                <Mail className="h-3.5 w-3.5" />
                Account Recovery
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Reset Operator Password
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Enter your registered operator email to receive a one-time
                Supabase password recovery link.
              </p>

              <form onSubmit={handleSendPasswordReset} className="mt-5 space-y-4">
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Operator Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@yourdomain.com"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? 'Sending Recovery Link...' : 'Send Recovery Email'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setStatusMsg('');
                    setView('signin');
                  }}
                  className="console-btn-secondary w-full rounded-lg px-4 py-2 text-xs font-medium"
                >
                  Back to Admin Sign-In
                </button>
              </form>
            </div>
          ) : /* STATE 4: First-Run Local Operator Initialization (before Supabase connected) */ !isCloudMode &&
            !localInitialized ? (
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider text-emerald-400 uppercase">
                <ShieldCheck className="h-3.5 w-3.5" />
                First-Run Admin Setup · PBKDF2-SHA256
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Create Operator Login
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Initialize your master operator login first. You can connect
                your{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  Authority Supabase Project URL
                </strong>{' '}
                and{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  Public Publishable / Anon Key
                </strong>{' '}
                anytime after signing in under{' '}
                <code className="font-mono">Authority &amp; Session</code>.
              </p>

              <form
                onSubmit={handleBootstrapLocalAdmin}
                className="mt-5 space-y-4"
              >
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Operator Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@yourdomain.com"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Master Password (min {MIN_ADMIN_PASSWORD_LENGTH} characters)
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={MIN_ADMIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 10 characters"
                      className="console-input w-full rounded-lg py-2 pr-9 pl-3.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      style={{ color: 'var(--text-muted)' }}
                      className="absolute inset-y-0 right-2.5 flex items-center"
                    >
                      {showPassword ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Confirm Master Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={MIN_ADMIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat master password"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="console-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {busy
                    ? 'Encrypting Vault & Signing In...'
                    : 'Initialize Admin & Sign In'}
                </button>
              </form>
            </div>
          ) : (
            /* STATE 5: Primary Operator Sign-In (No Sign-Up Tab) */
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider text-emerald-400 uppercase">
                <ShieldCheck className="h-3.5 w-3.5" />
                {isCloudMode
                  ? 'Cloud Authority Access'
                  : 'Authorized Operator Access'}
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Operator Sign-In
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                {isCloudMode ? (
                  <>
                    Sign in with your Supabase operator account carrying{' '}
                    <code className="font-mono">
                      app_metadata.role = &quot;admin&quot;
                    </code>
                    .
                  </>
                ) : (
                  <>
                    Sign in to unlock the Control Plane. Connect your{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Supabase Project URL &amp; Publishable Key
                    </strong>{' '}
                    anytime after login under{' '}
                    <code className="font-mono">Authority &amp; Session</code>.
                  </>
                )}
              </p>

              <form onSubmit={handleSignIn} className="mt-5 space-y-4">
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Operator Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@yourdomain.com"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      style={{ color: 'var(--text-secondary)' }}
                      className="block text-xs font-medium"
                    >
                      Password
                    </label>
                    {isCloudMode ? (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg('');
                          setStatusMsg('');
                          setView('forgot');
                        }}
                        className="text-[11px] font-medium text-emerald-400 hover:underline"
                      >
                        Forgot password?
                      </button>
                    ) : null}
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter operator password"
                      className="console-input w-full rounded-lg py-2 pr-9 pl-3.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      style={{ color: 'var(--text-muted)' }}
                      className="absolute inset-y-0 right-2.5 flex items-center"
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
                  className="console-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {busy ? 'Authenticating...' : 'Sign In to Control Plane'}
                </button>
              </form>

              <div
                style={{ borderTop: '1px solid var(--border-subtle)' }}
                className="mt-5 flex items-center justify-between gap-2 pt-4 font-mono text-[10.5px]"
              >
                <span
                  style={{ color: 'var(--text-muted)' }}
                  className="truncate"
                >
                  {isCloudMode
                    ? backend.health?.url
                    : 'Local PBKDF2-SHA256 Vault · Cloud connect post-login'}
                </span>
                {isCloudMode && backend.isRuntimeConfigured ? (
                  <button
                    type="button"
                    onClick={handleSwitchBackToLocalVault}
                    className="shrink-0 text-sky-400 hover:underline"
                  >
                    Use Local Vault
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Security Telemetry Footer */}
      <footer
        style={{ color: 'var(--text-muted)' }}
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 font-mono text-[10.5px]"
      >
        <span>
          myClinic License Authority v{APP_VERSION} · Schema v{SCHEMA_VERSION}
        </span>
        <span>Zero Self-Signup · Connect Supabase Post-Login</span>
      </footer>
    </div>
  );
}
