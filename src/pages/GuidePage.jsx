import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Globe,
  HelpCircle,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import schemaSqlRaw from '../../supabase/schema.sql?raw';
import ErrorAlert from '../components/ErrorAlert.jsx';
import {
  buildMyClinicAutoSyncKit,
  probeCentralAutoSync,
  syncCentralSubscription,
} from '../lib/auto-sync-client.mjs';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { buildAdminGrantSql, rememberError } from '../lib/errors.mjs';

function CopyButton({ id, text, copiedId, onCopy, label = 'Copy', primary = false }) {
  const isCopied = copiedId === id;
  return (
    <button
      type="button"
      onClick={() => onCopy(id, text)}
      className={`${
        primary ? 'console-btn-primary' : 'console-btn-secondary'
      } inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold`}
    >
      {isCopied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          {label}
        </>
      )}
    </button>
  );
}

export default function GuidePage({ backend, session, onNavigate }) {
  const operatorEmail = session?.user?.email || 'ops@yourdomain.com';
  const centralUrl = String(backend?.health?.url ?? '').trim().replace(/\/+$/, '');
  const centralAnonKey = String(backend?.health?.anonKey ?? '').trim();

  const [copiedId, setCopiedId] = useState(null);
  const [copyWarning, setCopyWarning] = useState(null);

  const [dbBusy, setDbBusy] = useState(false);
  const [dbOk, setDbOk] = useState(null);
  const [dbError, setDbError] = useState(null);

  const [simEmail, setSimEmail] = useState('');
  const [simOrigin, setSimOrigin] = useState('https://rajeshlande.github.io');
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  const [faqOpen, setFaqOpen] = useState(true);

  const adminGrantSql = useMemo(
    () => buildAdminGrantSql(operatorEmail),
    [operatorEmail],
  );

  const clientKit = useMemo(
    () =>
      buildMyClinicAutoSyncKit({
        centralUrl: centralUrl || 'https://YOUR_CENTRAL_PROJECT_REF.supabase.co',
        centralAnonKey:
          centralAnonKey || 'sb_publishable_YOUR_CENTRAL_ANON_KEY',
      }),
    [centralUrl, centralAnonKey],
  );

  async function handleCopy(id, text) {
    setCopyWarning(null);
    const res = await copyTextToClipboard(text);
    if (res.ok) {
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 2200);
    } else {
      setCopyWarning(res.error);
    }
  }

  async function handleTestCentralSetup() {
    setDbBusy(true);
    setDbError(null);
    setDbOk(null);
    try {
      if (!backend?.configured || !backend.supabase) {
        throw new Error(
          'Central Supabase URL & publishable key are not configured yet. Open Settings first.',
        );
      }
      const { count, error } = await backend.supabase
        .from('admin_license_view')
        .select('license_id', { count: 'exact', head: true });
      if (error) throw error;

      const rpcProbe = await probeCentralAutoSync(centralUrl, centralAnonKey, {
        timeoutMs: 10000,
      });

      setDbOk(
        `Central DB + Keyless Auto-Sync RPC verified (Schema v${rpcProbe.schemaVersion} · ${count ?? 0} clinics registered).`,
      );
    } catch (err) {
      setDbError(rememberError(err, 'Verify Central Setup'));
    } finally {
      setDbBusy(false);
    }
  }

  async function handleSimulateAutoSync(event) {
    event.preventDefault();
    setSimBusy(true);
    setSimError(null);
    setSimResult(null);
    try {
      if (!centralUrl || !centralAnonKey) {
        throw new Error('Configure your Central Supabase connection in Settings first.');
      }
      const verdict = await syncCentralSubscription({
        centralUrl,
        centralAnonKey,
        email: simEmail,
        origin: simOrigin,
        deviceId: 'admin-preview',
        bearerToken: session?.access_token ?? '',
      });
      setSimResult(verdict);
    } catch (err) {
      setSimError(rememberError(err, 'Simulate clinic auto-sync'));
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <section className="console-panel relative overflow-hidden rounded-2xl p-5 sm:p-6">
        <span className="cf-top-stripe absolute inset-x-0 top-0 h-[3px]" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div
              style={{
                backgroundColor: 'var(--cf-orange-soft)',
                border: '1px solid var(--cf-orange-border)',
                color: 'var(--cf-orange)',
              }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-semibold"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Keyless Central Auto-Sync · Zero Edge Functions · Email &amp; URL
            </div>
            <h2 className="mt-3 text-lg font-bold tracking-tight sm:text-xl">
              2-Side Keyless Auto-Sync Setup Guide
            </h2>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="mt-1 text-xs leading-relaxed sm:text-sm"
            >
              No <code className="font-mono">LICENSE_KEY</code>, no{' '}
              <code className="font-mono">PRIVATE / PUBLIC KEY</code>, and{' '}
              <strong>no Edge Functions</strong> needed. Manage clinic plans centrally
              by <strong>Owner Email</strong>, <strong>Clinic URL</strong>, or{' '}
              <strong>both</strong> — client <code className="font-mono">myClinic</code>{' '}
              deployments auto-sync via hardened Postgres RPC + FORCE RLS.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate?.('dashboard')}
            className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
          >
            Open Clinics &amp; Plans
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {copyWarning ? (
          <p className="mt-3 text-xs text-amber-500">{copyWarning}</p>
        ) : null}
      </section>

      {/* Two-Column Side-by-Side Architecture */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* SIDE 1: CENTRAL AUTHORITY */}
        <section className="console-panel flex flex-col justify-between space-y-4 rounded-2xl p-5 sm:p-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span
                  style={{ color: 'var(--cf-orange)' }}
                  className="font-mono text-[10.5px] font-bold tracking-wider uppercase"
                >
                  Side 1 · Central Supabase (Do Once)
                </span>
                <h3 className="mt-1 text-base font-bold">
                  Central Control Plane (`myClinicLicenseAuthority`)
                </h3>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
                  Your private vendor Supabase — clients have zero table access (`FORCE RLS`).
                </p>
              </div>
              <ShieldCheck
                style={{ color: 'var(--cf-orange)' }}
                className="h-6 w-6 shrink-0"
              />
            </div>

            {/* Central Step 1 */}
            <div className="console-well space-y-3 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">
                  Step 1 — Run `supabase/schema.sql` (v2) &amp; Grant Admin
                </span>
                <button
                  type="button"
                  disabled={dbBusy}
                  onClick={handleTestCentralSetup}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px]"
                >
                  {dbBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Database
                      style={{ color: 'var(--cf-orange)' }}
                      className="h-3.5 w-3.5"
                    />
                  )}
                  Verify Step 1
                </button>
              </div>

              <ol
                style={{ color: 'var(--text-secondary)' }}
                className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed"
              >
                <li>
                  Open <strong>Central Supabase → SQL Editor → New query</strong>, click{' '}
                  <strong>Copy Full schema.sql (v2)</strong>, paste, and click{' '}
                  <strong>Run</strong>.
                </li>
                <li>
                  Run the Admin Grant SQL once for{' '}
                  <code className="font-mono">{operatorEmail}</code> (and disable{' '}
                  <em>Allow new users to sign up</em> in Auth → Email).
                </li>
              </ol>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <CopyButton
                  id="copy-schema-v2"
                  text={schemaSqlRaw}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  label="Copy Full schema.sql (v2)"
                  primary
                />
                <CopyButton
                  id="copy-admin-sql"
                  text={adminGrantSql}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  label="Copy Admin Grant SQL"
                />
              </div>

              {dbOk ? (
                <div
                  role="status"
                  style={{
                    backgroundColor: 'var(--ok-soft)',
                    border: '1px solid var(--ok-border)',
                    color: 'var(--ok-text)',
                  }}
                  className="flex items-start gap-2 rounded-lg p-2.5 text-xs"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{dbOk}</span>
                </div>
              ) : null}

              {dbError ? (
                <ErrorAlert
                  error={dbError}
                  context="Verify Central Setup"
                  onRetry={handleTestCentralSetup}
                  onDismiss={() => setDbError(null)}
                />
              ) : null}
            </div>

            {/* Central Step 2 */}
            <div className="console-well space-y-3 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">
                  Step 2 — Add Clinics by Email, URL, or Both
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate?.('dashboard')}
                  className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px]"
                >
                  Add Clinic
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>

              <ul
                style={{ color: 'var(--text-secondary)' }}
                className="list-disc space-y-1 pl-4 text-xs leading-relaxed"
              >
                <li>
                  <strong>Email + URL (Recommended):</strong> Enter both{' '}
                  <code className="font-mono">dr.sharma@gmail.com</code> and{' '}
                  <code className="font-mono">https://sharmaclinic.github.io</code>.
                </li>
                <li>
                  <strong>Email Only:</strong> Enter owner email + leave{' '}
                  <em>Auto-lock first cloud URL</em> checked.
                </li>
                <li>
                  <strong>URL Only:</strong> Leave email blank and enter{' '}
                  <code className="font-mono">https://sharmaclinic.github.io</code>.
                </li>
              </ul>

              <form
                onSubmit={handleSimulateAutoSync}
                style={{ borderTop: '1px solid var(--border-subtle)' }}
                className="space-y-2.5 pt-3"
              >
                <div
                  style={{ color: 'var(--cf-orange)' }}
                  className="flex items-center gap-1.5 font-mono text-[11px] font-semibold"
                >
                  <Activity className="h-3.5 w-3.5" />
                  Quick Auto-Sync Test
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="email"
                    value={simEmail}
                    onChange={(e) => setSimEmail(e.target.value)}
                    placeholder="Clinic email (optional)"
                    className="console-input rounded-lg px-2.5 py-2 text-xs"
                  />
                  <input
                    type="url"
                    value={simOrigin}
                    onChange={(e) => setSimOrigin(e.target.value)}
                    placeholder="https://clinic.github.io"
                    className="console-input rounded-lg px-2.5 py-2 font-mono text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={simBusy}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold"
                >
                  {simBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play
                      style={{ color: 'var(--cf-orange)' }}
                      className="h-3.5 w-3.5"
                    />
                  )}
                  Simulate Auto-Sync
                </button>

                {simResult ? (
                  <div className="console-code overflow-hidden rounded-lg">
                    <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(simResult, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {simError ? (
                  <ErrorAlert
                    error={simError}
                    context="Simulate Auto-Sync"
                    onDismiss={() => setSimError(null)}
                  />
                ) : null}
              </form>
            </div>
          </div>
        </section>

        {/* SIDE 2: CLIENT APP (myClinic) */}
        <section className="console-panel flex flex-col justify-between space-y-4 rounded-2xl p-5 sm:p-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span
                  style={{ color: 'var(--cf-blue)' }}
                  className="font-mono text-[10.5px] font-bold tracking-wider uppercase"
                >
                  Side 2 · Client App (`myClinic` — Ship 1 Build to All Clinics)
                </span>
                <h3 className="mt-1 text-base font-bold">
                  Client Auto-Sync + Vite Obfuscation
                </h3>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
                  Zero client Supabase Edge Functions or secrets — clients never enter a key.
                </p>
              </div>
              <Globe style={{ color: 'var(--cf-blue)' }} className="h-6 w-6 shrink-0" />
            </div>

            {/* Client Step 1 */}
            <div className="console-well space-y-2.5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">
                  Step 1 — Add 2 Public Build Variables to `myClinic`
                </span>
                <CopyButton
                  id="copy-client-env"
                  text={clientKit.envVars}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  label="Copy .env.production"
                  primary
                />
              </div>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">
                Paste into <code className="font-mono">myClinic/.env.production</code> (or
                GitHub Actions Variables). Uses <strong>only</strong> your publishable{' '}
                <code className="font-mono">anon</code> key.
              </p>
              <div className="console-code overflow-hidden rounded-lg">
                <pre className="overflow-x-auto p-3 font-mono text-[11px]">
                  {clientKit.envVars}
                </pre>
              </div>
            </div>

            {/* Client Step 2 */}
            <div className="console-well space-y-3 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">
                  Step 2 — Drop In Auto-Sync Client + Scoped Vite Obfuscator
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate?.('node-agent')}
                  className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px]"
                >
                  Open Full Client SDK
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">
                Save <code className="font-mono">src/lib/central-subscription.mjs</code>{' '}
                in <code className="font-mono">myClinic</code> and add the scoped Vite
                obfuscator to <code className="font-mono">vite.config.js</code>.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <CopyButton
                  id="copy-client-module"
                  text={clientKit.clientModule}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  label="Copy central-subscription.mjs"
                  primary
                />
                <CopyButton
                  id="copy-vite-obf"
                  text={clientKit.viteObfuscatorSnippet}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  label="Copy Vite Obfuscator"
                />
              </div>

              <div className="console-elevated rounded-lg p-3 text-[11px] leading-relaxed">
                <div
                  style={{ color: 'var(--ok-text)' }}
                  className="flex items-center gap-1.5 font-semibold"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  How Auto-Sync Behaves in Production
                </div>
                <ul
                  style={{ color: 'var(--text-secondary)' }}
                  className="mt-1.5 list-disc space-y-1 pl-4"
                >
                  <li>
                    <strong>Pause / Expire / Upgrade in Central:</strong> Client updates
                    automatically on next page load, tab switch, or 30-min heartbeat.
                  </li>
                  <li>
                    <strong>Clinic Wi-Fi Down:</strong> Continues working up to 7 days on
                    its SHA-256 sealed offline lease (never past{' '}
                    <code className="font-mono">expires_at</code>).
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Security Boundary Summary Accordion */}
      <section className="console-panel rounded-2xl p-5">
        <button
          type="button"
          onClick={() => setFaqOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <HelpCircle style={{ color: 'var(--cf-orange)' }} className="h-4 w-4" />
            <span className="text-sm font-bold">
              Central Database Security Protections (Zero-Trust Architecture)
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${faqOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {faqOpen ? (
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="mt-4 grid grid-cols-1 gap-3 text-xs leading-relaxed md:grid-cols-2"
          >
            <div className="console-well rounded-xl p-3.5">
              <strong style={{ color: 'var(--text-primary)' }}>
                1. Zero Table / View Access (`FORCE RLS`):
              </strong>{' '}
              `anon` has `REVOKE ALL` on every table and view. Even a rogue
              `authenticated` signup sees 0 rows without `app_metadata.role = "admin"`.
            </div>
            <div className="console-well rounded-xl p-3.5">
              <strong style={{ color: 'var(--text-primary)' }}>
                2. Unforgeable Browser Origin Check:
              </strong>{' '}
              Postgres reads PostgREST <code className="font-mono">request.headers</code>{' '}
              Origin directly — unauthorized domains cannot spoof another clinic&apos;s URL.
            </div>
            <div className="console-well rounded-xl p-3.5">
              <strong style={{ color: 'var(--text-primary)' }}>
                3. SHA-256 IP Rate Limiting:
              </strong>{' '}
              `sync_clinic_subscription` caps lookups to 60/min and 15 unmatched
              attempts/5min per hashed IP to stop customer email enumeration.
            </div>
            <div className="console-well rounded-xl p-3.5">
              <strong style={{ color: 'var(--text-primary)' }}>
                4. Cross-Supabase JWT Isolation:
              </strong>{' '}
              `myClinic` calls Central PostgREST via raw `fetch` with only Central&apos;s
              publishable `anon` key — client user session JWTs never cross projects.
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
