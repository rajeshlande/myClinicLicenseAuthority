import React, { useMemo, useState } from 'react';
import { Check, Container, Copy, Globe } from 'lucide-react';
import {
  buildDockerComposeConfig,
  buildMyClinicCloudSetup,
  MYCLINIC_TIER_ENTITLEMENTS,
} from '../lib/entitlements.mjs';

export function NodeAgentPage({ backend, selectedLicense = null }) {
  const [targetMode, setTargetMode] = useState('myclinic-cloud'); // 'myclinic-cloud' | 'docker'
  const [licenseKey, setLicenseKey] = useState(
    selectedLicense?.license_key ?? '',
  );
  const [verifyUrl, setVerifyUrl] = useState(
    backend?.verifyUrl ||
      (import.meta.env.VITE_SUPABASE_URL
        ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/verify-license`
        : ''),
  );
  const [publicKeyEscaped, setPublicKeyEscaped] = useState('');
  const [hostPort, setHostPort] = useState(8080);
  const [customerOrigin, setCustomerOrigin] = useState('');
  const [clinicProjectRef, setClinicProjectRef] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const selectedTier = selectedLicense?.tier ?? 'growth';
  const mappedSeats =
    MYCLINIC_TIER_ENTITLEMENTS[selectedTier] ??
    MYCLINIC_TIER_ENTITLEMENTS.standard;

  const myClinicSetup = useMemo(
    () =>
      buildMyClinicCloudSetup({
        licenseKey: licenseKey || 'YOUR_LICENSE_KEY',
        verifyUrl:
          verifyUrl ||
          'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
        publicKeyEscaped: publicKeyEscaped || 'YOUR_SPKI_PUBLIC_KEY',
        clinicOrigin: customerOrigin || 'https://clinic.github.io',
        clinicProjectRef: clinicProjectRef || '<CLINIC_PROJECT_REF>',
      }),
    [licenseKey, verifyUrl, publicKeyEscaped, customerOrigin, clinicProjectRef],
  );

  const composeYaml = useMemo(
    () =>
      buildDockerComposeConfig({
        licenseKey: licenseKey || 'YOUR_LICENSE_KEY',
        verifyUrl:
          verifyUrl ||
          'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
        publicKeyEscaped: publicKeyEscaped || 'YOUR_SPKI_PUBLIC_KEY',
        hostPort,
      }),
    [licenseKey, verifyUrl, publicKeyEscaped, hostPort],
  );

  function copySnippet(id, text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <div className="space-y-6">
      <div className="console-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Clinic Connection</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
              Generate configuration for myClinic (`sync-clinic-license`) or Docker.
            </p>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-well)',
              border: '1px solid var(--border-subtle)',
            }}
            className="inline-flex rounded-xl p-1"
          >
            <button
              type="button"
              onClick={() => setTargetMode('myclinic-cloud')}
              style={
                targetMode === 'myclinic-cloud'
                  ? {
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid var(--accent-border)',
                      color: 'var(--text-primary)',
                    }
                  : {
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent',
                    }
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
              myClinic (Supabase + Pages)
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('docker')}
              style={
                targetMode === 'docker'
                  ? {
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid var(--accent-border)',
                      color: 'var(--text-primary)',
                    }
                  : {
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent',
                    }
              }
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              <Container className="h-3.5 w-3.5 text-sky-400" />
              Docker Gateway
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              License Key
            </label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="32-char license key"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Authority Verify URL
            </label>
            <input
              type="text"
              value={verifyUrl}
              onChange={(e) => setVerifyUrl(e.target.value)}
              placeholder="https://.../functions/v1/verify-license"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Public Key (\n-escaped)
            </label>
            <input
              type="text"
              value={publicKeyEscaped}
              onChange={(e) => setPublicKeyEscaped(e.target.value)}
              placeholder="Paste SPKI public key"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          {targetMode === 'docker' ? (
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Host Port
              </label>
              <input
                type="number"
                value={hostPort}
                onChange={(e) => setHostPort(Number(e.target.value) || 8080)}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:col-span-1">
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Clinic Origin
                </label>
                <input
                  type="text"
                  value={customerOrigin}
                  onChange={(e) => setCustomerOrigin(e.target.value)}
                  placeholder="https://clinic.github.io"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Clinic Supabase Ref
                </label>
                <input
                  type="text"
                  value={clinicProjectRef}
                  onChange={(e) => setClinicProjectRef(e.target.value)}
                  placeholder="project-ref"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {selectedLicense ? (
          <div
            style={{
              backgroundColor: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
            }}
            className="mt-4 rounded-xl px-4 py-2 font-mono text-xs"
          >
            {selectedTier.toUpperCase()} · plan={mappedSeats.plan} · doctors=
            {mappedSeats.doctors ?? '∞'} · frontdesk=
            {mappedSeats.frontdesk ?? '∞'} · branches=
            {mappedSeats.branches ?? '∞'}
          </div>
        ) : null}
      </div>

      {targetMode === 'myclinic-cloud' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="font-mono text-xs font-semibold text-slate-200">
                1. myClinic Build Variable (Actions Variables / .env.local)
              </span>
              <button
                type="button"
                onClick={() =>
                  copySnippet('app-vars', myClinicSetup.appBuildVars)
                }
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'app-vars' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">
              {myClinicSetup.appBuildVars}
            </pre>
          </div>

          <div className="console-code overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="font-mono text-xs font-semibold text-slate-200">
                2. Clinic Edge Function (sync-clinic-license)
              </span>
              <button
                type="button"
                onClick={() =>
                  copySnippet('edge-cmd', myClinicSetup.edgeSecretsCmd)
                }
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
              >
                {copiedId === 'edge-cmd' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-slate-300">
              {myClinicSetup.edgeSecretsCmd}
            </pre>
          </div>
        </div>
      ) : (
        <div className="console-code overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
            <span className="font-mono text-xs font-semibold text-slate-200">
              docker-compose.yml
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
                  <Copy className="h-3.5 w-3.5" /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-emerald-300">
            {composeYaml}
          </pre>
        </div>
      )}
    </div>
  );
}

export default NodeAgentPage;
