import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  WifiOff,
  Zap,
} from 'lucide-react';
import schemaSqlRaw from '../../supabase/schema.sql?raw';
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
import { APP_VERSION, SCHEMA_VERSION } from '../lib/version.js';

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
  const [copiedId, setCopiedId] = useState(null);

  const signedInNonAdmin =
    configured && Boolean(session?.user) && !recoveryMode;

  const nonAdminSql = useMemo(
    () => buildAdminGrantSql(session?.user?.email || 'ops@yourdomain.com'),
    [session?.user?.email],
  );

  async function handleCopyText(id, text) {
    const res = await copyTextToClipboard(text);
    if (!res.ok) {
      setErrorState(rememberError(res.error, 'Clipboard copy'));
      return;
    }
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 2000);
  }

  async function handleSignIn(event) {
    event.preventDefault();
    setErrorState(null);
    setStatusMsg('');

    if (!configured || !client) {
      setErrorState(
        rememberError(
          'Connect your Central Supabase project URL and publishable/anon key below before signing in.',
          'Sign in',
        ),
      );
      return;
    }

    const check = validateAdminCredentials({ email, password });
    if (!check.ok) {
      setErrorState({
        message: check.error,
        hint: 'Enter the operator email and password registered in Central Supabase → Authentication → Users.',
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
      if (error) throw error;
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
      if (error) throw error;
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
      if (error) throw error;
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
      if (client) await client.auth.signOut();
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
      setStatusMsg('Central Supabase connection saved. Sign in below.');
      onBackendChanged?.();
    } catch (err) {
      setErrorState(rememberError(err, 'Save Central connection'));
    }
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      className="cf-grid-bg cf-hero-glow relative flex min-h-screen flex-col justify-between overflow-x-hidden"
    >
      <div className="cf-top-stripe fixed inset-x-0 top-0 z-50 h-[3px]" />

      {/* Top Brand Header */}
      <header
        style={{
          backgroundColor: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
        className="w-full pt-[3px] backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a
            href="https://github.com/rajeshlande/myClinicLicenseAuthority"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5"
          >
            <div className="brand-mark-tile flex h-8 w-8 items-center justify-center rounded-lg shadow-xs">
              <Cloud className="h-4 w-4 stroke-[2.3]" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight">
                myClinic Central
              </span>
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="ml-2 hidden font-mono text-[11px] sm:inline"
              >
                Subscription Control Plane
              </span>
            </div>
          </a>

          <div className="flex items-center gap-2">
            <span
              className={`${
                configured ? 'badge-success' : 'badge-warning'
              } hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold sm:inline-flex`}
            >
              <span
                style={{
                  backgroundColor: configured
                    ? 'var(--ok-main)'
                    : 'var(--warn-main)',
                }}
                className="h-1.5 w-1.5 rounded-full"
              />
              {configured ? 'Supabase Connected' : 'Setup Needed'}
            </span>

            <button
              type="button"
              onClick={onToggleTheme}
              title={
                theme === 'dark'
                  ? 'Switch to Vanilla Cream Light Mode'
                  : 'Switch to Hunter Forest Dark Mode'
              }
              aria-label="Toggle color theme"
              className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
            >
              {theme === 'dark' ? (
                <Sun
                  style={{ color: 'var(--accent-energy)' }}
                  className="h-4 w-4"
                />
              ) : (
                <Moon
                  style={{ color: 'var(--brand-primary)' }}
                  className="h-4 w-4"
                />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Split Content */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:py-12">
        {/* Left Editorial Showcase */}
        <div className="order-2 space-y-6 lg:order-1 lg:col-span-7">
          <div className="badge-accent inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-semibold">
            <Zap className="h-3.5 w-3.5" />
            Keyless Auto-Sync · Schema v{SCHEMA_VERSION}
          </div>

          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Manage every{' '}
            <span style={{ color: 'var(--brand-text)' }}>myClinic</span>{' '}
            subscription from one Zero-Trust control plane.
          </h1>

          <p
            style={{ color: 'var(--text-secondary)' }}
            className="max-w-xl text-sm leading-relaxed sm:text-base"
          >
            Add clinics by <strong>Owner Email</strong>,{' '}
            <strong>Website URL</strong>, or <strong>both</strong>. Client apps
            auto-sync plan tiers, seats, and expirations with zero license keys
            and zero Edge Functions.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="console-panel rounded-xl p-4">
              <Globe
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
              <h2 className="mt-2.5 text-xs font-bold">Email &amp; URL Routing</h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-[11px] leading-relaxed"
              >
                Pin by owner email, domain origin, or dual-factor both.
              </p>
            </div>

            <div className="console-panel rounded-xl p-4">
              <Lock
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
              <h2 className="mt-2.5 text-xs font-bold">FORCE RLS Isolation</h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-[11px] leading-relaxed"
              >
                Zero client table access, browser Origin check &amp; SHA-256 rate
                limiting.
              </p>
            </div>

            <div className="console-panel rounded-xl p-4">
              <ShieldCheck
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
              <h2 className="mt-2.5 text-xs font-bold">7-Day Offline Seal</h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-[11px] leading-relaxed"
              >
                Clinics keep running offline; instant lock when paused centrally.
              </p>
            </div>
          </div>
        </div>

        {/* Right Sign-In / Setup Card (neutral.white #fcfaf5) */}
        <div className="order-1 w-full lg:order-2 lg:col-span-5">
          <div className="console-panel overflow-hidden rounded-2xl">
            <div className="cf-top-stripe h-1 w-full" />
            <div className="space-y-4 p-5 sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    {recoveryMode
                      ? 'Set new password'
                      : signedInNonAdmin
                        ? 'Grant admin standing'
                        : view === 'forgot'
                          ? 'Reset password'
                          : 'Sign in to Control Plane'}
                  </h2>
                  <p
                    style={{ color: 'var(--text-secondary)' }}
                    className="mt-1 text-xs leading-relaxed"
                  >
                    {recoveryMode
                      ? 'Choose a new password for your operator account.'
                      : signedInNonAdmin
                        ? 'Run the 3-line SQL snippet once to mark your account as Central Admin.'
                        : view === 'forgot'
                          ? 'Enter your operator email to receive a recovery link.'
                          : 'Authenticate with your Central Supabase admin account.'}
                  </p>
                </div>

                {configured && !recoveryMode && !signedInNonAdmin ? (
                  <button
                    type="button"
                    onClick={() => setShowEndpointForm((prev) => !prev)}
                    title="Change Central Supabase connection"
                    className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {!isOnline ? (
                <div className="badge-warning flex items-center gap-2 rounded-xl p-3 text-xs">
                  <WifiOff className="h-4 w-4 shrink-0" />
                  <span>Offline — reconnect to authenticate.</span>
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
                  className="badge-success flex items-start gap-2 rounded-xl p-3 text-xs font-medium"
                >
                  <CheckCircle2
                    style={{ color: 'var(--ok-main)' }}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>{statusMsg}</span>
                </div>
              ) : null}

              {/* Endpoint Setup Accordion */}
              {(!configured || showEndpointForm) && !recoveryMode ? (
                <div className="console-well space-y-3 rounded-xl p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">Connect Central Supabase</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('schema', schemaSqlRaw)}
                      className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold"
                    >
                      {copiedId === 'schema' ? (
                        <>
                          <Check
                            style={{ color: 'var(--ok-main)' }}
                            className="h-3 w-3"
                          />
                          Copied schema.sql
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy schema.sql (v2)
                        </>
                      )}
                    </button>
                  </div>

                  {backend?.health?.reason &&
                  backend.health.status === 'invalid' ? (
                    <ErrorAlert
                      error={backend.health.reason}
                      context="Invalid Supabase configuration"
                    />
                  ) : null}

                  <form
                    onSubmit={handleSaveEndpointOverride}
                    className="space-y-2.5"
                  >
                    <input
                      type="url"
                      required
                      value={endpointUrl}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                      placeholder="https://your-central-ref.supabase.co"
                      className="console-input w-full rounded-lg px-3 py-2.5 text-xs"
                    />
                    <input
                      type="password"
                      required
                      value={endpointAnonKey}
                      onChange={(e) => setEndpointAnonKey(e.target.value)}
                      placeholder="Publishable / anon key (sb_publishable_...)"
                      className="console-input w-full rounded-lg px-3 py-2.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="console-btn-primary w-full rounded-lg px-3 py-2.5 text-xs font-semibold"
                    >
                      Save Central Connection
                    </button>
                  </form>
                </div>
              ) : null}

              {/* Active Form Branch */}
              {recoveryMode ? (
                <form
                  onSubmit={handleCompletePasswordRecovery}
                  className="space-y-3.5"
                >
                  <div>
                    <label
                      htmlFor="recovery-new-password"
                      style={{ color: 'var(--text-secondary)' }}
                      className="block text-xs font-semibold"
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
                      className="block text-xs font-semibold"
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
                  <div className="console-well space-y-2.5 rounded-xl p-3.5 text-xs">
                    <p style={{ color: 'var(--text-secondary)' }}>
                      Signed in as{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {session.user.email}
                      </strong>
                      . Paste this into Central Supabase{' '}
                      <strong>SQL Editor</strong>, click <strong>Run</strong>,
                      then click <strong>Check again</strong>:
                    </p>
                    <div className="console-code overflow-hidden rounded-lg">
                      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
                        <span className="font-mono text-[10px] opacity-80">
                          SQL Editor
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText('admin-sql', nonAdminSql)
                          }
                          className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] hover:bg-white/15"
                        >
                          {copiedId === 'admin-sql' ? (
                            <>
                              <Check
                                style={{ color: 'var(--accent-energy)' }}
                                className="h-2.5 w-2.5"
                              />{' '}
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" /> Copy SQL
                            </>
                          )}
                        </button>
                      </div>
                      <pre
                        style={{ color: 'var(--accent-energy)' }}
                        className="overflow-x-auto p-3 font-mono text-[10.5px]"
                      >
                        {nonAdminSql}
                      </pre>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleRefreshAccess}
                      className="console-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {busy ? 'Checking...' : 'Check again'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold"
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
                      className="block text-xs font-semibold"
                    >
                      Operator Email
                    </label>
                    <div className="relative mt-1.5">
                      <Mail
                        style={{ color: 'var(--text-secondary)' }}
                        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
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
                    disabled={busy}
                    className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? 'Sending link...' : 'Send recovery link'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setView('signin');
                      setErrorState(null);
                      setStatusMsg('');
                    }}
                    className="console-btn-secondary inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
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
                      className="block text-xs font-semibold"
                    >
                      Operator Email
                    </label>
                    <div className="relative mt-1.5">
                      <Mail
                        style={{ color: 'var(--text-secondary)' }}
                        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                      />
                      <input
                        id="login-email"
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

                  <div>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="login-password"
                        style={{ color: 'var(--text-secondary)' }}
                        className="block text-xs font-semibold"
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
                        style={{ color: 'var(--brand-text)' }}
                        className="text-[11px] font-semibold hover:underline"
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
                        placeholder="Enter operator password"
                        className="console-input w-full rounded-lg py-2.5 pr-10 pl-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        style={{ color: 'var(--text-secondary)' }}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="console-btn-primary w-full rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? 'Authenticating...' : 'Sign in'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
        }}
        className="py-4 text-center font-mono text-[11px]"
      >
        myClinic Central Subscription Control Plane · v{APP_VERSION} · Schema v
        {SCHEMA_VERSION}
      </footer>
    </div>
  );
}

export default LoginPage;
