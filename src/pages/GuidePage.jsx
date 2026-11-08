import React, { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  Container,
  Copy,
  Database,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import verifyLicenseScriptSource from '../../supabase/functions/verify-license/index.ts?raw';
import ErrorAlert from '../components/ErrorAlert.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { generateRsaKeyPairPem } from '../lib/crypto-rs256.mjs';
import {
  buildAdminGrantSql,
  probeVerifyLicenseEndpoint,
  rememberError,
} from '../lib/errors.mjs';

const COMMON_FIXES = [
  {
    problem: '"Admin role required" after signing in',
    fix: 'Paste the Admin SQL from Side 1 → Step 1 into Authority Supabase SQL Editor, click Run, then click "Check again".',
  },
  {
    problem: 'PGRST204 / admin_license_view does not exist',
    fix: 'Paste supabase/schema.sql into Authority Supabase SQL Editor and click Run.',
  },
  {
    problem: 'myClinic says "not-configured" on Check licence',
    fix: 'In the Clinic Supabase → Edge Functions → Secrets, make sure AUTHORITY_VERIFY_URL, LICENSE_KEY, and LICENSE_PUBLIC_KEY are saved.',
  },
  {
    problem: 'myClinic says "Hardware seat limit reached" or "expired"',
    fix: 'Open Licenses (#/dashboard) here, click Inspect on that clinic, and release an old node or extend the expiry date.',
  },
];

function extractProjectRef(url = '') {
  const match = String(url).match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : 'YOUR_AUTHORITY_PROJECT_REF';
}

export function GuidePage({
  backend,
  session,
  onQuickIssueLicense,
  onNavigate,
}) {
  const supabase = backend?.supabase ?? null;
  const projectRef = useMemo(
    () => extractProjectRef(backend?.health?.url),
    [backend?.health?.url],
  );
  const verifyEndpoint = useMemo(() => {
    if (backend?.verifyUrl) return backend.verifyUrl;
    if (backend?.health?.url) {
      return `${String(backend.health.url).replace(/\/+$/, '')}/functions/v1/verify-license`;
    }
    return 'https://YOUR_AUTHORITY_PROJECT_REF.supabase.co/functions/v1/verify-license';
  }, [backend]);

  const [adminEmail, setAdminEmail] = useState(
    session?.user?.email || 'ops@yourdomain.com',
  );
  const [copiedId, setCopiedId] = useState(null);
  const [copyError, setCopyError] = useState('');

  const [dbBusy, setDbBusy] = useState(false);
  const [dbOk, setDbOk] = useState(null);
  const [dbError, setDbError] = useState(null);

  const [keyBusy, setKeyBusy] = useState(false);
  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [keyError, setKeyError] = useState(null);

  const [edgeBusy, setEdgeBusy] = useState(false);
  const [edgeOk, setEdgeOk] = useState(null);
  const [edgeError, setEdgeError] = useState(null);

  const adminGrantSql = useMemo(
    () => buildAdminGrantSql(adminEmail),
    [adminEmail],
  );

  const dashboardFunctionsUrl =
    projectRef !== 'YOUR_AUTHORITY_PROJECT_REF'
      ? `https://supabase.com/dashboard/project/${projectRef}/functions`
      : 'https://supabase.com/dashboard';

  async function handleCopy(id, text) {
    setCopyError('');
    const res = await copyTextToClipboard(text);
    if (!res.ok) {
      setCopyError(res.error);
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  async function handleCheckDatabase() {
    setDbBusy(true);
    setDbError(null);
    setDbOk(null);
    try {
      if (!backend?.configured || !supabase) {
        throw new Error('Configure Authority Supabase URL & Anon Key in Settings first.');
      }
      const { count, error } = await supabase
        .from('admin_license_view')
        .select('license_id', { count: 'exact', head: true });
      if (error) throw error;
      setDbOk(`Database & Admin role ready (${count ?? 0} licenses).`);
    } catch (err) {
      setDbError(rememberError(err, 'Check Authority database'));
    } finally {
      setDbBusy(false);
    }
  }

  async function handleGenerateKeys() {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const pair = await generateRsaKeyPairPem();
      setGeneratedKeys(pair);
    } catch (err) {
      setKeyError(rememberError(err, 'Generate RS256 keys'));
    } finally {
      setKeyBusy(false);
    }
  }

  async function handlePingSigner() {
    setEdgeBusy(true);
    setEdgeError(null);
    setEdgeOk(null);
    try {
      if (verifyEndpoint.includes('YOUR_AUTHORITY_PROJECT_REF')) {
        throw new Error('Save your Authority Supabase URL in Settings first.');
      }
      const probe = await probeVerifyLicenseEndpoint(verifyEndpoint, {
        anonKey: backend?.health?.anonKey ?? '',
        timeoutMs: 10000,
      });
      setEdgeOk(probe.message);
    } catch (err) {
      setEdgeError(rememberError(err, 'Test verify-license'));
    } finally {
      setEdgeBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <section className="console-panel rounded-2xl p-5">
        <h2 className="text-base font-semibold">
          Simple Setup Guide — Two Sides, 3 Steps Each
        </h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed">
          You use <strong>2 separate Supabase projects</strong>: one for{' '}
          <a
            href="https://github.com/rajeshlande/myClinicLicenseAuthority"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-400 underline underline-offset-2"
          >
            myClinicLicenseAuthority
          </a>{' '}
          (your vendor console, set up <strong>once</strong>) and one for each{' '}
          <a
            href="https://github.com/rajeshlande/myClinic"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-400 underline underline-offset-2"
          >
            myClinic
          </a>{' '}
          app (set up when onboarding a clinic). Everything below can be done in the browser — no terminal needed.
        </p>

        {copyError ? (
          <div className="mt-3">
            <ErrorAlert
              error={copyError}
              context="Copy warning"
              onDismiss={() => setCopyError('')}
            />
          </div>
        ) : null}
      </section>

      {/* SIDE-BY-SIDE: PART 1 (Authority) & PART 2 (myClinic) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ==================== SIDE 1: myClinicLicenseAuthority ==================== */}
        <section className="console-panel flex flex-col justify-between space-y-5 rounded-2xl p-6">
          <div className="space-y-5">
            <div className="border-b border-slate-800/80 pb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                SIDE 1 · DO ONCE
              </span>
              <h3 className="mt-2 text-base font-semibold">
                myClinicLicenseAuthority Side (Your Vendor Project)
              </h3>
              <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
                Done on your <strong>Authority Supabase</strong> project &amp; GitHub repo.
              </p>
            </div>

            {/* Authority Step 1 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-3 rounded-xl p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  1. Run <code className="font-mono text-emerald-400">supabase/schema.sql</code> &amp; make yourself Admin
                </p>
                <button
                  type="button"
                  disabled={dbBusy}
                  onClick={handleCheckDatabase}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
                >
                  <Database className="h-3 w-3 text-emerald-400" />
                  {dbBusy ? 'Checking...' : 'Test Step 1'}
                </button>
              </div>
              <ol
                style={{ color: 'var(--text-secondary)' }}
                className="list-inside list-decimal space-y-1 leading-relaxed"
              >
                <li>
                  In Authority Supabase → <strong>SQL Editor</strong>, paste{' '}
                  <code className="font-mono">supabase/schema.sql</code> and click <strong>Run</strong>.
                </li>
                <li>
                  In <strong>Authentication → Users</strong>, add your email &amp; password (turn OFF public sign-ups under Providers → Email).
                </li>
                <li>
                  Enter your email below, copy the SQL, and click <strong>Run</strong> in SQL Editor:
                </li>
              </ol>

              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="ops@yourdomain.com"
                  className="console-input min-w-48 flex-1 rounded-lg px-3 py-1.5 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleCopy('admin-sql', adminGrantSql)}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium"
                >
                  {copiedId === 'admin-sql' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied SQL
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy Admin SQL
                    </>
                  )}
                </button>
              </div>

              {dbOk ? (
                <p className="flex items-center gap-1.5 font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {dbOk}
                </p>
              ) : null}
              {dbError ? <ErrorAlert error={dbError} onRetry={handleCheckDatabase} /> : null}
            </div>

            {/* Authority Step 2 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-3 rounded-xl p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  2. Generate Keys &amp; Paste <code className="font-mono text-emerald-400">verify-license</code> in Supabase
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={keyBusy}
                    onClick={handleGenerateKeys}
                    className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  >
                    <Sparkles className="h-3 w-3" />
                    {keyBusy ? 'Generating...' : 'Generate Keys'}
                  </button>
                  <button
                    type="button"
                    disabled={edgeBusy}
                    onClick={handlePingSigner}
                    className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px]"
                  >
                    <Activity className="h-3 w-3 text-emerald-400" />
                    {edgeBusy ? '...' : 'Test Step 2'}
                  </button>
                </div>
              </div>

              <ol
                style={{ color: 'var(--text-secondary)' }}
                className="list-inside list-decimal space-y-1.5 leading-relaxed"
              >
                <li>
                  Click <strong>Generate Keys</strong> above (creates your Private Key + Public Key).
                </li>
                <li>
                  Open{' '}
                  <a
                    href={dashboardFunctionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline"
                  >
                    Authority Supabase → Edge Functions <ExternalLink className="inline h-3 w-3" />
                  </a>{' '}
                  → <strong>Secrets</strong>, and add secret{' '}
                  <code className="font-mono">LICENSE_PRIVATE_KEY</code>.
                </li>
                <li>
                  Click <strong>Deploy a new function → Via Editor</strong>, name it{' '}
                  <code className="font-mono">verify-license</code>, turn <strong>OFF</strong>{' '}
                  <em>&quot;Verify JWT&quot;</em>, paste the script below, and click <strong>Deploy</strong>.
                </li>
              </ol>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={!generatedKeys}
                  onClick={() => handleCopy('priv', generatedKeys?.privateKeyEnv || '')}
                  className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 font-mono text-[11px] font-medium disabled:opacity-40"
                >
                  {copiedId === 'priv' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> 1. Private Key
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopy('fn-script', verifyLicenseScriptSource)}
                  className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 font-mono text-[11px] font-medium"
                >
                  {copiedId === 'fn-script' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> 2. Function Script
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!generatedKeys}
                  onClick={() => handleCopy('pub', generatedKeys?.publicKeyEnv || '')}
                  className="console-btn-secondary inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 font-mono text-[11px] font-medium disabled:opacity-40"
                >
                  {copiedId === 'pub' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> 3. Public Key
                    </>
                  )}
                </button>
              </div>

              {keyError ? <ErrorAlert error={keyError} /> : null}
              {edgeOk ? (
                <p className="flex items-center gap-1.5 font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {edgeOk}
                </p>
              ) : null}
              {edgeError ? <ErrorAlert error={edgeError} onRetry={handlePingSigner} /> : null}
            </div>

            {/* Authority Step 3 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-2.5 rounded-xl p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  3. Issue a 32-Character <code className="font-mono text-emerald-400">LICENSE_KEY</code>
                </p>
                <button
                  type="button"
                  onClick={() => onQuickIssueLicense?.()}
                  className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Issue License
                </button>
              </div>
              <p style={{ color: 'var(--text-secondary)' }} className="leading-relaxed">
                Click <strong>Issue License</strong>, pick a plan (<code className="font-mono">solo</code>,{' '}
                <code className="font-mono">growth</code>, or <code className="font-mono">chain</code>),
                and copy the 32-character <code className="font-mono">LICENSE_KEY</code> for Side 2.
              </p>
            </div>
          </div>
        </section>

        {/* ==================== SIDE 2: myClinic ==================== */}
        <section className="console-panel flex flex-col justify-between space-y-5 rounded-2xl p-6">
          <div className="space-y-5">
            <div className="border-b border-slate-800/80 pb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-sky-400">
                <KeyRound className="h-3.5 w-3.5" />
                SIDE 2 · PER CLINIC
              </span>
              <h3 className="mt-2 text-base font-semibold">
                myClinic Side (Clinic App &amp; Clinic Supabase)
              </h3>
              <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
                Done on the clinic&apos;s{' '}
                <a
                  href="https://github.com/rajeshlande/myClinic"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 underline"
                >
                  myClinic
                </a>{' '}
                repo &amp; the clinic&apos;s own Supabase project.
              </p>
            </div>

            {/* myClinic Step 1 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-2.5 rounded-xl p-4 text-xs"
            >
              <p className="font-semibold">
                1. Add <code className="font-mono text-sky-400">VITE_LICENSE_PUBLIC_KEY</code> to myClinic
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="leading-relaxed">
                In the clinic&apos;s GitHub repo (<strong>Settings → Secrets and variables → Actions → Variables</strong>)
                or in <code className="font-mono">myClinic/.env.local</code>, add:
              </p>
              <div className="console-code rounded-lg px-3 py-2 font-mono text-[11px] text-emerald-300">
                VITE_LICENSE_PUBLIC_KEY=&quot;{generatedKeys ? `${generatedKeys.publicKeyEnv.slice(0, 44)}...` : '<Public Key from Side 1 Step 2>'}&quot;
              </div>
            </div>

            {/* myClinic Step 2 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-2.5 rounded-xl p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  2. Add 3 Secrets &amp; Deploy <code className="font-mono text-sky-400">sync-clinic-license</code>
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate?.('node-agent')}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
                >
                  <Container className="h-3 w-3 text-sky-400" />
                  Pre-fill Values
                </button>
              </div>
              <ol
                style={{ color: 'var(--text-secondary)' }}
                className="list-inside list-decimal space-y-1.5 leading-relaxed"
              >
                <li>
                  Ensure <code className="font-mono">myClinic/supabase/schema.sql</code> (schema 18) has been run in the clinic&apos;s SQL Editor.
                </li>
                <li>
                  In the <strong>Clinic&apos;s Supabase → Edge Functions → Secrets</strong>, add these 3 secrets:
                </li>
              </ol>

              <div className="console-code space-y-1.5 rounded-lg p-3 font-mono text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-200">
                    AUTHORITY_VERIFY_URL = <span className="text-emerald-300">{verifyEndpoint}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('verify-url', verifyEndpoint)}
                    className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                  >
                    {copiedId === 'verify-url' ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
                <div className="text-slate-200">
                  LICENSE_KEY = <span className="text-amber-300">&lt;32-char key from Side 1 Step 3&gt;</span>
                </div>
                <div className="text-slate-200">
                  LICENSE_PUBLIC_KEY = <span className="text-emerald-300">&lt;Public Key from Side 1 Step 2&gt;</span>
                </div>
              </div>

              <p style={{ color: 'var(--text-secondary)' }} className="leading-relaxed">
                3. Deploy <code className="font-mono">myClinic/supabase/functions/sync-clinic-license/index.ts</code> on the clinic&apos;s Supabase project (via Dashboard Editor named <code className="font-mono">sync-clinic-license</code> with <em>&quot;Verify JWT&quot;</em> OFF, or via CLI).
              </p>
            </div>

            {/* myClinic Step 3 */}
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-2 rounded-xl p-4 text-xs"
            >
              <p className="font-semibold">
                3. Click &quot;Check the licence now&quot; in myClinic
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="leading-relaxed">
                Sign in to <strong>myClinic</strong> as the clinic <strong>Owner</strong> → open{' '}
                <strong>Subscription</strong> → click <strong>&quot;Check the licence now&quot;</strong>.
                myClinic fetches, verifies, and enforces the 7-day RS256 license automatically!
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Calm Collapsible Troubleshooting */}
      <details className="console-panel group rounded-2xl p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold">
          <span className="inline-flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-emerald-400" />
            Common Errors &amp; Quick Fixes (click to expand)
          </span>
          <span style={{ color: 'var(--text-muted)' }} className="font-mono text-[11px]">
            4 quick answers
          </span>
        </summary>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {COMMON_FIXES.map((item) => (
            <div
              key={item.problem}
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-1 rounded-xl p-3.5 text-xs"
            >
              <p className="font-semibold text-emerald-400">{item.problem}</p>
              <p style={{ color: 'var(--text-secondary)' }}>{item.fix}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default GuidePage;
