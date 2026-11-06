import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  buildPasswordRecoveryRedirectUrl,
  formatAuthErrorMessage,
  isAuthorizedAdminUser,
  validateAdminCredentials,
  validatePasswordUpdate,
  validateRecoveryEmail,
} from '../lib/auth.mjs';
import { saveRuntimeSupabaseConfig } from '../lib/supabase.js';
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

export default function LoginPage({
  backend,
  session,
  isOnline,
  recoveryMode,
  theme,
  onToggleTheme,
  onBackendChanged,
  onSessionRefreshed,
  onRecoveryCompleted,
}) {
  const configured = Boolean(backend.configured);

  const [view, setView] = useState('signin'); // 'signin' | 'forgot'
  const [showEnvQuickConnect, setShowEnvQuickConnect] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [newConfirmPassword, setNewConfirmPassword] = useState('');

  const [quickUrl, setQuickUrl] = useState('');
  const [quickAnonKey, setQuickAnonKey] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);

  const signedInNonAdmin =
    configured &&
    Boolean(session?.user) &&
    !isAuthorizedAdminUser(session.user);

  const adminGrantSql = useMemo(() => {
    const targetEmail = session?.user?.email ?? 'ops@yourdomain.com';
    return `update auth.users\nset raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb\nwhere email = '${targetEmail.replace(/'/g, "''")}';`;
  }, [session?.user?.email]);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    if (!configured || !backend.supabase?.auth) {
      setErrorMsg(
        'Cloud Supabase credentials (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are required to sign in.',
      );
      return;
    }

    if (!isOnline) {
      setErrorMsg(
        'Internet connection is offline. Reconnect to authenticate against Cloud Supabase.',
      );
      return;
    }

    const check = validateAdminCredentials({ email, password });
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
      onSessionRefreshed(data.session ?? null);
    } catch (err) {
      setErrorMsg(formatAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleQuickConnectEndpoint = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    try {
      saveRuntimeSupabaseConfig({ url: quickUrl, anonKey: quickAnonKey });
      setQuickAnonKey('');
      setShowEnvQuickConnect(false);
      onBackendChanged();
      setStatusMsg('Connected to Cloud Supabase over HTTPS. Sign in below.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid Supabase configuration.',
      );
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
      setErrorMsg(formatAuthErrorMessage(err));
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
      setErrorMsg(formatAuthErrorMessage(err));
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
      setErrorMsg(formatAuthErrorMessage(err));
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
              CLOUD RS256 CONTROL PLANE
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            style={
              isOnline && configured
                ? {
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-border)',
                    color: 'var(--accent-primary)',
                  }
                : {
                    backgroundColor: 'var(--warn-soft)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: 'var(--warn-text)',
                  }
            }
            className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10.5px] font-semibold sm:inline-flex"
          >
            {isOnline ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {!isOnline
              ? 'INTERNET OFFLINE'
              : configured
                ? 'CLOUD AUTO-CONNECTED'
                : 'AWAITING SUPABASE ENV'}
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

      {/* Main Centered Cloud Authentication Card */}
      <main className="mx-auto my-8 w-full max-w-md">
        <div className="console-panel rounded-2xl p-6 sm:p-7">
          {!isOnline ? (
            <div
              style={{
                backgroundColor: 'var(--warn-soft)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: 'var(--warn-text)',
              }}
              className="mb-5 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs"
            >
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Waiting for internet connection. Cloud Supabase authentication
                will resume automatically once online.
              </span>
            </div>
          ) : null}

          {!configured ? (
            <div
              style={{
                backgroundColor: 'var(--warn-soft)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: 'var(--warn-text)',
              }}
              className="mb-5 rounded-xl px-3.5 py-3 text-xs"
            >
              <div className="flex items-start gap-2.5">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 leading-relaxed">
                  <strong className="block font-semibold">
                    Supabase secrets not detected on this build
                  </strong>
                  <span>
                    Set <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
                    <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in{' '}
                    <code className="font-mono">.env.local</code> or GitHub
                    Repository Secrets so Sign-In auto-connects over the
                    internet.
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEnvQuickConnect((v) => !v)}
                    className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] font-semibold underline"
                  >
                    {showEnvQuickConnect ? (
                      <>
                        Hide browser endpoint override{' '}
                        <ChevronUp className="h-3 w-3" />
                      </>
                    ) : (
                      <>
                        Connect URL &amp; Key in browser now{' '}
                        <ChevronDown className="h-3 w-3" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {showEnvQuickConnect ? (
                <form
                  onSubmit={handleQuickConnectEndpoint}
                  style={{ borderTop: '1px solid rgba(245, 158, 11, 0.25)' }}
                  className="mt-3 space-y-2.5 pt-3"
                >
                  <input
                    type="url"
                    required
                    value={quickUrl}
                    onChange={(e) => setQuickUrl(e.target.value)}
                    placeholder="https://your-project-ref.supabase.co"
                    className="console-input w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                  <input
                    type="password"
                    required
                    value={quickAnonKey}
                    onChange={(e) => setQuickAnonKey(e.target.value)}
                    placeholder="sb_publishable_... or anon key"
                    className="console-input w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                  <button
                    type="submit"
                    className="console-btn-primary w-full rounded-lg px-3 py-1.5 text-xs"
                  >
                    Save &amp; Auto-Connect Cloud Supabase
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

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
          {configured && recoveryMode ? (
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
                  disabled={busy || !isOnline}
                  className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? 'Updating Password...' : 'Save Password & Enter Console'}
                </button>
              </form>
            </div>
          ) : /* STATE 2: Signed-In Non-Admin (403 Missing Claim) */ signedInNonAdmin ? (
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
                  disabled={busy || !isOnline}
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
          ) : /* STATE 3: Forgot Password */ view === 'forgot' ? (
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
                Enter your registered Cloud Supabase operator email to receive a
                one-time password recovery link.
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
                    disabled={!configured}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@yourdomain.com"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy || !configured || !isOnline}
                  className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  {busy ? 'Sending Recovery Link...' : 'Send Recovery Email'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setStatusMsg('');
                    setView('forgot' === view ? 'signin' : 'forgot');
                  }}
                  className="console-btn-secondary w-full rounded-lg px-4 py-2 text-xs font-medium"
                >
                  Back to Operator Sign-In
                </button>
              </form>
            </div>
          ) : (
            /* STATE 4: Default Cloud Operator Sign-In (Zero Local Accounts, Zero Demo) */
            <div>
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-wider text-emerald-400 uppercase">
                <ShieldCheck className="h-3.5 w-3.5" />
                Cloud Authority Sign-In
              </div>
              <h1 className="mt-1.5 text-lg font-semibold tracking-tight">
                Sign in to myClinic Authority
              </h1>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Authenticate over HTTPS with your Cloud Supabase operator
                account carrying{' '}
                <code className="font-mono">
                  app_metadata.role = &quot;admin&quot;
                </code>
                .
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
                    disabled={!configured}
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@yourdomain.com"
                    className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs disabled:opacity-50"
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
                    <button
                      type="button"
                      disabled={!configured}
                      onClick={() => {
                        setErrorMsg('');
                        setStatusMsg('');
                        setView('forgot');
                      }}
                      className="text-[11px] font-medium text-emerald-400 hover:underline disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      disabled={!configured}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter operator password"
                      className="console-input w-full rounded-lg py-2 pr-9 pl-3.5 text-xs disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={!configured}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      style={{ color: 'var(--text-muted)' }}
                      className="absolute inset-y-0 right-2.5 flex items-center disabled:opacity-40"
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
                  disabled={busy || !configured || !isOnline}
                  className="console-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {busy ? 'Authenticating...' : 'Sign In to Control Plane'}
                </button>
              </form>

              {configured ? (
                <div
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                  className="mt-5 flex items-center justify-between gap-2 pt-4 font-mono text-[10.5px]"
                >
                  <span
                    style={{ color: 'var(--text-muted)' }}
                    className="truncate"
                    title={backend.health?.url}
                  >
                    {backend.health?.url}
                  </span>
                  <span className="shrink-0 text-emerald-400">PKCE · TLS</span>
                </div>
              ) : null}
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
        <span>Cloud Accounts Only · No Local / Demo Bypass</span>
      </footer>
    </div>
  );
}
