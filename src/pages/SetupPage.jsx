import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Lock,
  LogOut,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  clearRuntimeSupabaseConfig,
  saveRuntimeSupabaseConfig,
} from '../lib/supabase.js';

export default function SetupPage({ backend, onBackendChanged }) {
  const [url, setUrl] = useState(backend.health?.url ?? '');
  const [anonKey, setAnonKey] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [sessionUser, setSessionUser] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (backend.mode === 'cloud' && backend.supabase?.auth) {
      backend.supabase.auth.getUser().then(({ data }) => {
        if (active) setSessionUser(data?.user ?? null);
      });
    } else {
      setSessionUser(null);
    }
    return () => {
      active = false;
    };
  }, [backend]);

  const handleSaveConnection = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    try {
      saveRuntimeSupabaseConfig({ url, anonKey });
      onBackendChanged();
      setStatusMsg(
        'Connected to Cloud Supabase. Sign in with an admin operator account.',
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid configuration.',
      );
    }
  };

  const handleDisconnect = () => {
    clearRuntimeSupabaseConfig();
    onBackendChanged();
    setStatusMsg('Returned to Interactive Demo Sandbox.');
    setErrorMsg('');
  };

  const handleAdminSignIn = async (e) => {
    e.preventDefault();
    if (backend.mode !== 'cloud') return;
    setBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await backend.supabase.auth.signInWithPassword({
        email: adminEmail.trim(),
        password: adminPassword,
      });
      if (error) throw error;
      setSessionUser(data.user);
      setAdminPassword('');
      setStatusMsg(`Authenticated operator ${data.user.email}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (backend.mode !== 'cloud') return;
    await backend.supabase.auth.signOut();
    setSessionUser(null);
    setStatusMsg('Operator session signed out.');
  };

  const handleResetDemo = () => {
    backend.demoAuthority.resetDemoData();
    setStatusMsg('Reset Demo Sandbox database to clean seed state.');
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Card 1: Cloud Authority Connection */}
        <section className="console-panel rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
            >
              <Database className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Cloud Supabase Authority Endpoint
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Zero-trust guard refuses <code className="font-mono">service_role</code>{' '}
                and <code className="font-mono">sb_secret_</code> credentials.
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
                Publishable / Anon Key
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
                Connect Cloud Authority
              </button>
              {backend.mode === 'cloud' ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="console-btn-secondary rounded-lg px-3.5 py-2 text-xs font-medium"
                >
                  Switch to Demo Sandbox
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Demo Seed Data
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Card 2: Operator Admin Session */}
        <section className="console-panel rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--info-soft)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sky-400"
            >
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Admin Operator Authentication (RLS)
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Requires immutable{' '}
                <code className="font-mono">app_metadata.role = &quot;admin&quot;</code>{' '}
                JWT claim.
              </p>
            </div>
          </div>

          {backend.mode !== 'cloud' ? (
            <div className="console-well mt-5 rounded-xl p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Demo Sandbox Active
              </div>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1.5 leading-relaxed"
              >
                You are currently operating against the in-browser deterministic Demo Authority.
                Connect your Cloud Supabase URL on the left to sign in with live Supabase Auth.
              </p>
            </div>
          ) : sessionUser ? (
            <div className="console-well mt-5 space-y-3 rounded-xl p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-emerald-400">
                  AUTHENTICATED OPERATOR
                </span>
                <span
                  style={{ color: 'var(--text-muted)' }}
                  className="font-mono text-[10px]"
                >
                  role={sessionUser.app_metadata?.role ?? 'none'}
                </span>
              </div>
              <div className="font-mono text-xs">{sessionUser.email}</div>
              <button
                type="button"
                onClick={handleSignOut}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <form onSubmit={handleAdminSignIn} className="mt-5 space-y-4">
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Admin Email
                </label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="ops@yourdomain.com"
                  className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                />
              </div>

              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="console-input mt-1.5 w-full rounded-lg px-3.5 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="console-btn-primary rounded-lg px-4 py-2 text-xs disabled:opacity-50"
              >
                {busy ? 'Signing in...' : 'Sign In as Authority Admin'}
              </button>
            </form>
          )}
        </section>
      </div>

      {/* Bootstrap SQL Reference */}
      <section className="console-code overflow-hidden rounded-2xl">
        <div className="border-b border-slate-800 px-5 py-3 font-mono text-xs font-semibold text-slate-200">
          SQL Bootstrap — Grant Operator Admin Role (Run Once in Authority SQL Editor)
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">{`-- After applying supabase/schema.sql, promote your operator account:
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'ops@yourdomain.com';`}</pre>
      </section>
    </div>
  );
}
