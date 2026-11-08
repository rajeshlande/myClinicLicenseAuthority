import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Container,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  HelpCircle,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import { generateRsaKeyPairPem } from '../lib/crypto-rs256.mjs';
import {
  buildAdminGrantSql,
  explainError,
  fetchWithTimeout,
  rememberError,
} from '../lib/errors.mjs';

const GUIDE_PROGRESS_STORAGE_KEY = 'myclinic_authority_guide_steps_v1';

const TROUBLESHOOTING_ITEMS = [
  {
    symptom: '"Access restricted" after signing in',
    cause: 'Account exists in Supabase Auth, but raw_app_meta_data lacks {"role":"admin"}.',
    fix: 'Run the 3-line Admin Role SQL from Step 1 in Supabase Dashboard → SQL Editor, then click "Check again".',
  },
  {
    symptom: 'PGRST204 / relation "admin_license_view" does not exist',
    cause: 'supabase/schema.sql has not been applied to your Authority Supabase project yet.',
    fix: 'Paste the entire supabase/schema.sql file into Supabase SQL Editor and click Run (safe and idempotent).',
  },
  {
    symptom: 'HTTP 403 MAX_MACHINES_EXCEEDED (code 53400)',
    cause: 'All allowed hardware/web seats (max_machines) for that clinic key are already bound.',
    fix: 'Open Licenses (#/dashboard) → click Inspect on the clinic → release an old node or raise Max Nodes.',
  },
  {
    symptom: 'HTTP 402 Payment Required / SUBSCRIPTION_INACTIVE / KEY_KILLED',
    cause: 'Subscription expired or the operator toggled the remote Kill-Switch.',
    fix: 'Open Licenses (#/dashboard), click Enable if killed, or Inspect → extend Expiration Date and Save Term.',
  },
  {
    symptom: 'Edge Function 500 / Failed to fetch on /functions/v1/verify-license',
    cause: 'verify-license is not deployed yet, or LICENSE_PRIVATE_KEY secret was not set.',
    fix: 'Run Step 2 commands: npx supabase secrets set LICENSE_PRIVATE_KEY="..." and npx supabase functions deploy verify-license --no-verify-jwt.',
  },
  {
    symptom: 'ORIGIN_MISMATCH or FINGERPRINT_MISMATCH in myClinic',
    cause: 'Token was minted for a different web:<origin> URL or hardware machine_fingerprint.',
    fix: 'Ensure Clinic Origin matches the exact https://<domain> hosting myClinic (no trailing slash), then re-sync.',
  },
];

function loadSavedSteps() {
  try {
    const raw = globalThis.localStorage?.getItem(GUIDE_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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

  const [completed, setCompleted] = useState(loadSavedSteps);
  const [adminEmail, setAdminEmail] = useState(
    session?.user?.email || 'ops@yourdomain.com',
  );
  const [copiedId, setCopiedId] = useState(null);
  const [copyError, setCopyError] = useState('');

  // Step 1 live check state
  const [dbCheckBusy, setDbCheckBusy] = useState(false);
  const [dbCheckResult, setDbCheckResult] = useState(null);
  const [dbCheckError, setDbCheckError] = useState(null);

  // Step 2 in-browser keygen state
  const [keyBusy, setKeyBusy] = useState(false);
  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [keyError, setKeyError] = useState(null);

  // Step 5 Edge probe state
  const [edgeBusy, setEdgeBusy] = useState(false);
  const [edgeResult, setEdgeResult] = useState(null);
  const [edgeError, setEdgeError] = useState(null);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        GUIDE_PROGRESS_STORAGE_KEY,
        JSON.stringify(completed),
      );
    } catch {
      // Ignore storage quota errors in private browsing
    }
  }, [completed]);

  const toggleStep = (stepKey) => {
    setCompleted((prev) => ({ ...prev, [stepKey]: !prev[stepKey] }));
  };

  const markDone = (stepKey) => {
    setCompleted((prev) => ({ ...prev, [stepKey]: true }));
  };

  const completedCount = ['step1', 'step2', 'step3', 'step4', 'step5'].filter(
    (k) => Boolean(completed[k]),
  ).length;

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

  async function handleVerifyDatabaseStep() {
    setDbCheckBusy(true);
    setDbCheckError(null);
    setDbCheckResult(null);
    const started = performance.now();

    try {
      if (!backend?.configured || !supabase) {
        throw new Error(
          'Authority Supabase connection is not configured yet. Open Settings (#/setup) to save VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
        );
      }
      const { count, error } = await supabase
        .from('admin_license_view')
        .select('license_id', { count: 'exact', head: true });
      if (error) throw error;

      const latencyMs = Math.round(performance.now() - started);
      setDbCheckResult({
        latencyMs,
        count: count ?? 0,
      });
      markDone('step1');
      if ((count ?? 0) > 0) {
        markDone('step3');
      }
    } catch (err) {
      const explained = rememberError(err, 'Step 1 database check');
      setDbCheckError(explained);
    } finally {
      setDbCheckBusy(false);
    }
  }

  async function handleGenerateStepKeys() {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const pair = await generateRsaKeyPairPem();
      setGeneratedKeys(pair);
      markDone('step2');
    } catch (err) {
      const explained = rememberError(err, 'RS256 keypair generation');
      setKeyError(explained);
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleProbeEdgeFunction() {
    setEdgeBusy(true);
    setEdgeError(null);
    setEdgeResult(null);
    const started = performance.now();

    try {
      if (!backend?.configured || verifyEndpoint.includes('YOUR_AUTHORITY_PROJECT_REF')) {
        throw new Error(
          'Configure your Authority Supabase URL first so the verify-license endpoint can be probed.',
        );
      }
      const response = await fetchWithTimeout(
        verifyEndpoint,
        {
          method: 'OPTIONS',
        },
        10000,
      );
      const latencyMs = Math.round(performance.now() - started);
      if (response.status === 404) {
        const notFound = new Error(
          'verify-license returned HTTP 404 Not Found — deploy the Edge Function with npx supabase functions deploy verify-license --no-verify-jwt.',
        );
        notFound.status = 502;
        throw notFound;
      }
      setEdgeResult({
        status: response.status,
        latencyMs,
      });
      markDone('step5');
    } catch (err) {
      const explained = rememberError(err, 'Step 5 Edge Function check');
      setEdgeError(explained);
    } finally {
      setEdgeBusy(false);
    }
  }

  const adminGrantSql = useMemo(
    () => buildAdminGrantSql(adminEmail),
    [adminEmail],
  );

  const edgeDeployCommands = useMemo(() => {
    const privPlaceholder = generatedKeys?.privateKeyEnv || '<PASTE_LICENSE_PRIVATE_KEY>';
    return [
      'npx supabase login',
      `npx supabase link --project-ref ${projectRef}`,
      `npx supabase secrets set LICENSE_PRIVATE_KEY="${privPlaceholder}"`,
      'npx supabase functions deploy verify-license --no-verify-jwt',
    ].join('\n');
  }, [generatedKeys, projectRef]);

  return (
    <div className="space-y-6">
      {/* Header & Progress */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-400">
              <BookOpen className="h-3.5 w-3.5" />
              Interactive Step-by-Step Guide
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              Set up myClinicLicenseAuthority &amp; connect myClinic
            </h2>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="max-w-3xl text-xs leading-relaxed"
            >
              Follow these 5 steps in order to initialize your Authority Supabase project,
              deploy asymmetric RS256 token signing, issue a clinic license key, and connect{' '}
              <a
                href="https://github.com/rajeshlande/myClinic"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-emerald-400 underline underline-offset-2"
              >
                rajeshlande/myClinic
              </a>
              . Click any step circle to track your progress.
            </p>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="min-w-44 rounded-xl px-4 py-3 text-right"
          >
            <p
              style={{ color: 'var(--text-muted)' }}
              className="text-[11px] font-medium"
            >
              Checklist Progress
            </p>
            <p className="mt-0.5 font-mono text-lg font-bold text-emerald-400">
              {completedCount} / 5 completed
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                style={{ width: `${(completedCount / 5) * 100}%` }}
                className="h-full rounded-full bg-emerald-400 transition-all"
              />
            </div>
          </div>
        </div>

        {copyError ? (
          <div className="mt-4">
            <ErrorAlert
              error={copyError}
              context="Clipboard warning"
              onDismiss={() => setCopyError('')}
            />
          </div>
        ) : null}
      </section>

      {/* STEP 1 */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleStep('step1')}
              aria-label="Toggle Step 1 complete"
              className="mt-0.5 text-emerald-400 transition hover:scale-105"
            >
              {completed.step1 ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Circle style={{ color: 'var(--text-muted)' }} className="h-5 w-5" />
              )}
            </button>
            <div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                STEP 1 OF 5
              </span>
              <h3 className="text-sm font-semibold">
                Apply Database Schema &amp; Grant Operator Admin Role
              </h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                1) Open your Authority Supabase project → <strong>SQL Editor</strong>, paste{' '}
                <code className="font-mono text-emerald-300">supabase/schema.sql</code>, and click{' '}
                <strong>Run</strong>. 2) Create your user in{' '}
                <strong>Authentication → Users</strong>, then run the SQL below to grant{' '}
                <code className="font-mono text-emerald-300">app_metadata.role = &quot;admin&quot;</code>.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={dbCheckBusy}
            onClick={handleVerifyDatabaseStep}
            className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <Database className="h-3.5 w-3.5" />
            {dbCheckBusy ? 'Checking...' : 'Verify Database & Admin'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <label
              htmlFor="guide-admin-email"
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Operator Email
            </label>
            <input
              id="guide-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="ops@yourdomain.com"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div className="console-code overflow-hidden rounded-xl lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
              <span className="font-mono text-[11px] text-slate-300">
                Supabase SQL Editor — Grant Admin Standing
              </span>
              <button
                type="button"
                onClick={() => handleCopy('admin-sql', adminGrantSql)}
                className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'admin-sql' ? (
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
            <pre className="overflow-x-auto p-3.5 font-mono text-[11px] text-emerald-200">
              {adminGrantSql}
            </pre>
          </div>
        </div>

        {dbCheckResult ? (
          <div
            role="status"
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent-primary)',
            }}
            className="mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-medium"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Database schema &amp; admin RLS verified ({dbCheckResult.latencyMs} ms) —{' '}
              {dbCheckResult.count} license(s) currently stored.
            </span>
          </div>
        ) : null}

        {dbCheckError ? (
          <div className="mt-4">
            <ErrorAlert
              error={dbCheckError}
              context="Database verification failed"
              onRetry={handleVerifyDatabaseStep}
            />
          </div>
        ) : null}
      </section>

      {/* STEP 2 */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleStep('step2')}
              aria-label="Toggle Step 2 complete"
              className="mt-0.5 text-emerald-400 transition hover:scale-105"
            >
              {completed.step2 ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Circle style={{ color: 'var(--text-muted)' }} className="h-5 w-5" />
              )}
            </button>
            <div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                STEP 2 OF 5
              </span>
              <h3 className="text-sm font-semibold">
                Generate RS256 Keypair &amp; Deploy <code className="font-mono">verify-license</code>
              </h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Generate a 2048-bit RSA keypair below (or run <code className="font-mono">npm run keygen</code>).
                Store <strong>LICENSE_PRIVATE_KEY</strong> strictly inside Supabase Edge Function
                secrets; give clinics only <strong>LICENSE_PUBLIC_KEY</strong>.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={keyBusy}
            onClick={handleGenerateStepKeys}
            className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {keyBusy ? 'Generating...' : '1. Generate RS256 Keypair'}
          </button>
        </div>

        {keyError ? (
          <div className="mt-4">
            <ErrorAlert error={keyError} context="Keypair generation failed" />
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="console-code overflow-hidden rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
              <span className="font-mono text-[11px] text-slate-300">
                2. Deploy Authority Signer (Terminal)
              </span>
              <button
                type="button"
                onClick={() => handleCopy('edge-deploy', edgeDeployCommands)}
                className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'edge-deploy' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy Commands
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-44 overflow-auto p-3.5 font-mono text-[11px] text-slate-200">
              {edgeDeployCommands}
            </pre>
          </div>

          <div className="console-code overflow-hidden rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
              <span className="font-mono text-[11px] text-emerald-300">
                3. Public Key for myClinic (VITE_LICENSE_PUBLIC_KEY)
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    'pub-key',
                    generatedKeys?.publicKeyEnv ||
                      'Generate a keypair first (or run `npm run keygen`)',
                  )
                }
                disabled={!generatedKeys}
                className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                {copiedId === 'pub-key' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy Public Key
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-44 overflow-auto p-3.5 font-mono text-[11px] text-emerald-200/90">
              {generatedKeys
                ? generatedKeys.publicKeyEnv
                : 'Click "1. Generate RS256 Keypair" above to generate a fresh SPKI public key in browser memory.'}
            </pre>
          </div>
        </div>
      </section>

      {/* STEP 3 */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleStep('step3')}
              aria-label="Toggle Step 3 complete"
              className="mt-0.5 text-emerald-400 transition hover:scale-105"
            >
              {completed.step3 ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Circle style={{ color: 'var(--text-muted)' }} className="h-5 w-5" />
              )}
            </button>
            <div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                STEP 3 OF 5
              </span>
              <h3 className="text-sm font-semibold">
                Issue a Clinic Subscription &amp; 32-Character License Key
              </h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Record manual UPI / NEFT / PO payment details, pick the clinic tier and
                allowed node count (<code className="font-mono">max_machines</code>), and mint a
                cryptographic 32-character hex key.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              markDone('step3');
              onQuickIssueLicense?.();
            }}
            className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" />
            Issue License Now
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              tier: 'Solo',
              code: 'solo',
              seats: '1 Doctor · 1 Front Desk · 1 Branch',
            },
            {
              tier: 'Growth',
              code: 'growth',
              seats: '5 Doctors · 3 Front Desk · 1 Branch',
            },
            {
              tier: 'Multi-Clinic Chain',
              code: 'chain',
              seats: 'Unlimited Doctors, Desks & Branches',
            },
          ].map((plan) => (
            <div
              key={plan.code}
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="rounded-xl p-3.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{plan.tier}</span>
                <code className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
                  {plan.code}
                </code>
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1.5">
                {plan.seats}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* STEP 4 */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleStep('step4')}
              aria-label="Toggle Step 4 complete"
              className="mt-0.5 text-emerald-400 transition hover:scale-105"
            >
              {completed.step4 ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Circle style={{ color: 'var(--text-muted)' }} className="h-5 w-5" />
              )}
            </button>
            <div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                STEP 4 OF 5
              </span>
              <h3 className="text-sm font-semibold">
                Connect <code className="font-mono">myClinic</code> (Cloud / GitHub Pages or Docker)
              </h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Open the Deployment generator to export ready-to-paste secrets for{' '}
                <code className="font-mono">myClinic</code>&apos;s{' '}
                <code className="font-mono">sync-clinic-license</code> Edge Function or an
                on-premises Docker Compose gateway.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              markDone('step4');
              onNavigate?.('node-agent');
            }}
            className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
          >
            <Container className="h-3.5 w-3.5 text-emerald-400" />
            Open Deployment Generator
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <ol
          style={{ color: 'var(--text-secondary)' }}
          className="mt-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-3"
        >
          <li
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="rounded-xl p-3.5"
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              4a. Set Public Key on myClinic
            </strong>
            <p className="mt-1">
              Add <code className="font-mono">VITE_LICENSE_PUBLIC_KEY</code> in{' '}
              <code className="font-mono">myClinic/.env.local</code> or GitHub Actions
              Repository Variables.
            </p>
          </li>
          <li
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="rounded-xl p-3.5"
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              4b. Set Clinic Supabase Secrets
            </strong>
            <p className="mt-1">
              Set <code className="font-mono">AUTHORITY_VERIFY_URL</code>,{' '}
              <code className="font-mono">CLINIC_LICENSE_KEY</code>, and{' '}
              <code className="font-mono">CLINIC_ORIGIN</code> on the clinic&apos;s Supabase project.
            </p>
          </li>
          <li
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="rounded-xl p-3.5"
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              4c. Sync in myClinic Subscription Tab
            </strong>
            <p className="mt-1">
              Deploy <code className="font-mono">sync-clinic-license</code> and click{' '}
              <strong>&quot;Check the licence now&quot;</strong> inside myClinic.
            </p>
          </li>
        </ol>
      </section>

      {/* STEP 5 */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleStep('step5')}
              aria-label="Toggle Step 5 complete"
              className="mt-0.5 text-emerald-400 transition hover:scale-105"
            >
              {completed.step5 ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Circle style={{ color: 'var(--text-muted)' }} className="h-5 w-5" />
              )}
            </button>
            <div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                STEP 5 OF 5
              </span>
              <h3 className="text-sm font-semibold">
                Test Live Heartbeat &amp; Offline RS256 Verification
              </h3>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 text-xs leading-relaxed"
              >
                Ping <code className="font-mono">{verifyEndpoint}</code> below to confirm
                HTTPS + CORS reachability, or open <strong>Key Tools</strong> to simulate a full
                7-day capability JWT handshake.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={edgeBusy}
              onClick={handleProbeEdgeFunction}
              className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <Activity className="h-3.5 w-3.5" />
              {edgeBusy ? 'Probing...' : 'Ping verify-license'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('simulator')}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium"
            >
              <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />
              Open Key Tools
            </button>
          </div>
        </div>

        {edgeResult ? (
          <div
            role="status"
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent-primary)',
            }}
            className="mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-medium"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              verify-license endpoint is online and reachable (HTTP {edgeResult.status} in{' '}
              {edgeResult.latencyMs} ms).
            </span>
          </div>
        ) : null}

        {edgeError ? (
          <div className="mt-4">
            <ErrorAlert
              error={edgeError}
              context="Edge Function reachability check"
              onRetry={handleProbeEdgeFunction}
            />
          </div>
        ) : null}
      </section>

      {/* Built-in Error & Troubleshooting Reference */}
      <section className="console-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <HelpCircle
                style={{ color: 'var(--accent-primary)' }}
                className="h-4 w-4"
              />
            </span>
            <div>
              <h3 className="text-sm font-semibold">
                Troubleshooting &amp; Error Reference
              </h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Instant fixes for common setup, database, and clinic sync errors.
              </p>
            </div>
          </div>

          <a
            href="https://github.com/rajeshlande/myClinicLicenseAuthority"
            target="_blank"
            rel="noreferrer"
            className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            myClinicLicenseAuthority Repo
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {TROUBLESHOOTING_ITEMS.map((item) => (
            <div
              key={item.symptom}
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="space-y-1.5 rounded-xl p-4 text-xs"
            >
              <p className="font-mono font-semibold text-emerald-400">
                {item.symptom}
              </p>
              <p style={{ color: 'var(--text-muted)' }}>{item.cause}</p>
              <p style={{ color: 'var(--text-primary)' }}>
                <strong>Fix:</strong> {item.fix}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default GuidePage;
