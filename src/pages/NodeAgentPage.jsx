import React, { useMemo, useState } from 'react';
import {
  Check,
  Container,
  Copy,
  Globe,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  buildDockerComposeConfig,
} from '../lib/entitlements.mjs';

export default function NodeAgentPage({ backend, selectedLicense }) {
  const [targetMode, setTargetMode] = useState('docker');
  const [licenseKey, setLicenseKey] = useState(
    selectedLicense?.license_key ?? '9F4A2C81E70B3D564A19C8E2710F5B3D',
  );
  const [verifyUrl, setVerifyUrl] = useState(
    backend.mode === 'cloud'
      ? backend.verifyUrl
      : 'https://YOUR-PROJECT.supabase.co/functions/v1/verify-license',
  );
  const [publicKeyEscaped, setPublicKeyEscaped] = useState(
    'Paste_SPKI_PUBLIC_KEY_from_Key_Studio',
  );
  const [customerOrigin, setCustomerOrigin] = useState(
    'https://cityclinic.github.io',
  );
  const [hostPort, setHostPort] = useState(8080);
  const [copiedId, setCopiedId] = useState('');

  const composeYaml = useMemo(
    () =>
      buildDockerComposeConfig({
        licenseKey,
        verifyUrl,
        publicKeyEscaped,
        hostPort,
      }),
    [licenseKey, verifyUrl, publicKeyEscaped, hostPort],
  );

  const pagesVarsEnv = useMemo(
    () =>
      [
        '# Customer myClinic GitHub Repo -> Settings -> Secrets and variables -> Actions -> Variables',
        `VITE_LICENSE_VERIFY_URL=${verifyUrl}`,
        `VITE_LICENSE_KEY=${licenseKey.trim().toUpperCase()}`,
        `VITE_LICENSE_PUBLIC_KEY=${publicKeyEscaped}`,
        `# Origin lock bound on first heartbeat: web:${customerOrigin.trim().toLowerCase().replace(/\/+$/, '')}|<clinic_id>`,
      ].join('\n'),
    [verifyUrl, licenseKey, publicKeyEscaped, customerOrigin],
  );

  const customerEdgeSyncSnippet = useMemo(
    () =>
      `// Customer Supabase Edge Function: supabase/functions/sync-clinic-license/index.ts
// Enforces standing in PostgreSQL RLS (public.clinic_subscriptions) — immune to DevTools edits!
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { verifyCapabilityJwt } from "./crypto-rs256.mjs";

Deno.serve(async (req) => {
  const { clinic_id } = await req.json();
  const origin = "${customerOrigin.trim().toLowerCase().replace(/\/+$/, '')}";
  const fingerprint = \`supabase:\${origin}|\${clinic_id}\`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const resp = await fetch("${verifyUrl}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      license_key: Deno.env.get("LICENSE_KEY"),
      machine_fingerprint: fingerprint,
    }),
  });
  const body = await resp.json().catch(() => ({}));
  const check = resp.ok
    ? await verifyCapabilityJwt(body.token, Deno.env.get("LICENSE_PUBLIC_KEY")!, {
        expectedFingerprint: fingerprint,
      })
    : { valid: false };

  if (!check.valid) {
    await supabase.rpc("set_license_status", { p_clinic: clinic_id, p_status: "read_only" });
    return Response.json({ active: false }, { status: 402 });
  }

  await supabase.from("clinic_subscriptions").upsert({
    clinic_id,
    plan: check.claims.tier === "solo" || check.claims.tier === "chain" ? check.claims.tier : "growth",
    status: "active",
    current_period_end: check.claims.subscription_expires_at,
  });
  return Response.json({ active: true, tier: check.claims.tier });
});`,
    [verifyUrl, customerOrigin],
  );

  const selectedTier = selectedLicense?.tier ?? 'growth';
  const mappedSeats =
    MYCLINIC_TIER_ENTITLEMENTS[selectedTier] ??
    MYCLINIC_TIER_ENTITLEMENTS.standard;

  const copySnippet = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === id ? '' : cur));
      }, 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="space-y-6">
      <div className="console-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
            >
              <Container className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">
                Target Clinic Hosting Architecture
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Configure customer manifests for On-Premises Docker/Node or Static GitHub Pages.
              </p>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="inline-flex rounded-xl p-1 text-xs font-medium"
          >
            <button
              type="button"
              onClick={() => setTargetMode('docker')}
              style={
                targetMode === 'docker'
                  ? {
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong)',
                    }
                  : { color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition"
            >
              <Container className="h-3.5 w-3.5 text-sky-400" />
              Docker / Node Host
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('pages')}
              style={
                targetMode === 'pages'
                  ? {
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong)',
                    }
                  : { color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition"
            >
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
              GitHub Pages Host
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Customer License Key
            </label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Cloud Validator Endpoint
            </label>
            <input
              type="text"
              value={verifyUrl}
              onChange={(e) => setVerifyUrl(e.target.value)}
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              RS256 Public Key (\n-escaped)
            </label>
            <input
              type="text"
              value={publicKeyEscaped}
              onChange={(e) => setPublicKeyEscaped(e.target.value)}
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          {targetMode === 'docker' ? (
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Clinic Host Port
              </label>
              <input
                type="number"
                value={hostPort}
                onChange={(e) => setHostPort(Number(e.target.value) || 8080)}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
              />
            </div>
          ) : (
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Customer GitHub Pages Origin
              </label>
              <input
                type="text"
                value={customerOrigin}
                onChange={(e) => setCustomerOrigin(e.target.value)}
                placeholder="https://clinic.github.io"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
              />
            </div>
          )}
        </div>

        <div
          style={{
            backgroundColor: 'var(--accent-soft)',
            border: '1px solid var(--accent-border)',
          }}
          className="mt-4 rounded-xl px-4 py-2.5 font-mono text-xs"
        >
          <strong>Mapped myClinic Entitlement ({selectedTier.toUpperCase()}):</strong>{' '}
          plan={mappedSeats.plan} · doctors={mappedSeats.doctors ?? '∞'} ·
          frontdesk={mappedSeats.frontdesk ?? '∞'} · branches=
          {mappedSeats.branches ?? '∞'}
        </div>
      </div>

      {targetMode === 'docker' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="font-mono text-xs font-semibold text-slate-200">
                docker-compose.yml (Customer On-Premises Host)
              </span>
              <button
                type="button"
                onClick={() => copySnippet('compose', composeYaml)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'compose' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy YAML
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">
              {composeYaml}
            </pre>
          </div>

          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-slate-200">
                <Terminal className="h-3.5 w-3.5 text-sky-400" />
                Operator CLI Deployment Sequence
              </span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-slate-300">{`# 1. Generate RS256 PKCS#8 + SPKI keypair
npm run keygen

# 2. Apply single source-of-truth schema & scratch RLS suite
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql

# 3. Deploy Supabase Edge Validator
supabase secrets set LICENSE_PRIVATE_KEY="$LICENSE_PRIVATE_KEY"
supabase functions deploy verify-license --no-verify-jwt

# 4. Run Local Validator Gateway for myClinic container
npm run start:validator`}</pre>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-slate-200">
                <Globe className="h-3.5 w-3.5 text-emerald-400" />
                Layer 1 · GitHub Pages Origin-Locked WebCrypto Vars
              </span>
              <button
                type="button"
                onClick={() => copySnippet('pages-vars', pagesVarsEnv)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'pages-vars' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Variables
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">
              {pagesVarsEnv}
            </pre>
          </div>

          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-slate-200">
                <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
                Layer 2 · Tamper-Proof Customer Supabase RLS Sync
              </span>
              <button
                type="button"
                onClick={() => copySnippet('edge-sync', customerEdgeSyncSnippet)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'edge-sync' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Edge Function
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-slate-300">
              {customerEdgeSyncSnippet}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
