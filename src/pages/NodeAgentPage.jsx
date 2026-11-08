import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Container,
  Copy,
  Globe,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import {
  buildDockerComposeConfig,
  buildMyClinicCloudSetup,
  MYCLINIC_TIER_ENTITLEMENTS,
} from '../lib/entitlements.mjs';
import {
  rememberError,
  validateEndpointUrlInput,
  validatePublicKeyPemInput,
} from '../lib/errors.mjs';

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
  const [copyError, setCopyError] = useState('');

  const selectedTier = selectedLicense?.tier ?? 'growth';
  const mappedSeats =
    MYCLINIC_TIER_ENTITLEMENTS[selectedTier] ??
    MYCLINIC_TIER_ENTITLEMENTS.standard;

  // Proactive validation of operator inputs
  const validationProblem = useMemo(() => {
    const pubCheck = validatePublicKeyPemInput(publicKeyEscaped);
    if (!pubCheck.ok) return pubCheck.error;

    const verifyCheck = validateEndpointUrlInput(verifyUrl, {
      label: 'Authority Verify URL',
    });
    if (!verifyCheck.ok) return verifyCheck.error;

    if (targetMode === 'myclinic-cloud' && customerOrigin.trim()) {
      const originCheck = validateEndpointUrlInput(customerOrigin, {
        label: 'Clinic Origin',
      });
      if (!originCheck.ok) return originCheck.error;
    }

    if (
      targetMode === 'docker' &&
      (!Number.isInteger(Number(hostPort)) ||
        Number(hostPort) < 1 ||
        Number(hostPort) > 65535)
    ) {
      return 'Host Port must be an integer between 1 and 65535 (for example, 8080).';
    }

    if (
      licenseKey.trim() &&
      !/^[A-Fa-f0-9]{32}$/.test(licenseKey.trim())
    ) {
      return 'License Key should be the 32-character hexadecimal key issued under Licenses (#/dashboard).';
    }

    return '';
  }, [publicKeyEscaped, verifyUrl, targetMode, customerOrigin, hostPort, licenseKey]);

  const hasPlaceholders =
    !licenseKey.trim() || !publicKeyEscaped.trim() || !verifyUrl.trim();

  const normalizedPublicKeyEscaped = useMemo(() => {
    const pubCheck = validatePublicKeyPemInput(publicKeyEscaped);
    return pubCheck.ok && !pubCheck.empty
      ? pubCheck.escaped
      : 'YOUR_SPKI_PUBLIC_KEY';
  }, [publicKeyEscaped]);

  const myClinicSetup = useMemo(
    () =>
      buildMyClinicCloudSetup({
        licenseKey: licenseKey.trim() || 'YOUR_LICENSE_KEY',
        verifyUrl:
          verifyUrl.trim() ||
          'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
        publicKeyEscaped: normalizedPublicKeyEscaped,
        clinicOrigin: customerOrigin.trim() || 'https://clinic.github.io',
        clinicProjectRef: clinicProjectRef.trim() || '<CLINIC_PROJECT_REF>',
      }),
    [
      licenseKey,
      verifyUrl,
      normalizedPublicKeyEscaped,
      customerOrigin,
      clinicProjectRef,
    ],
  );

  const composeYaml = useMemo(
    () =>
      buildDockerComposeConfig({
        licenseKey: licenseKey.trim() || 'YOUR_LICENSE_KEY',
        verifyUrl:
          verifyUrl.trim() ||
          'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
        publicKeyEscaped: normalizedPublicKeyEscaped,
        hostPort: Number(hostPort) || 8080,
      }),
    [licenseKey, verifyUrl, normalizedPublicKeyEscaped, hostPort],
  );

  async function copySnippet(id, text) {
    setCopyError('');
    if (validationProblem) {
      setCopyError(validationProblem);
      rememberError(validationProblem, 'Copy deployment snippet');
      return;
    }
    const res = await copyTextToClipboard(text);
    if (!res.ok) {
      setCopyError(res.error);
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <div className="space-y-6">
      <div className="console-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Step-by-Step Clinic Connection Generator
            </h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
              Fill in the 4 fields below, then copy the generated configuration into{' '}
              <a
                href="https://github.com/rajeshlande/myClinic"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-emerald-400 underline underline-offset-2"
              >
                myClinic
              </a>{' '}
              or Docker.
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

        {validationProblem ? (
          <div className="mt-4">
            <ErrorAlert
              error={{
                message: validationProblem,
                hint: 'Correct the highlighted field above before copying configuration to a clinic.',
                fixLabel: 'Fix field',
              }}
              context="Configuration check"
            />
          </div>
        ) : null}

        {copyError && copyError !== validationProblem ? (
          <div className="mt-4">
            <ErrorAlert
              error={copyError}
              context="Copy failed"
              onDismiss={() => setCopyError('')}
            />
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              1. Clinic License Key
            </label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="32-char hex key from Licenses"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              2. Authority Verify URL
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
              3. Public Key (SPKI PEM, never private)
            </label>
            <input
              type="text"
              value={publicKeyEscaped}
              onChange={(e) => setPublicKeyEscaped(e.target.value)}
              placeholder="-----BEGIN PUBLIC KEY-----\n..."
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </div>

          {targetMode === 'docker' ? (
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                4. Host Port (1–65535)
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={hostPort}
                onChange={(e) => setHostPort(e.target.value)}
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
                  4a. Clinic Origin
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
                  4b. Clinic Supabase Ref
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

        {hasPlaceholders && !validationProblem ? (
          <div
            style={{
              backgroundColor: 'var(--warn-soft)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: 'var(--warn-text)',
            }}
            className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Placeholder values (<code className="font-mono">YOUR_LICENSE_KEY</code> /{' '}
              <code className="font-mono">YOUR_SPKI_PUBLIC_KEY</code>) are still shown below — fill all fields above before deploying to a clinic.
            </span>
          </div>
        ) : null}

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
                Step A — Paste into myClinic (.env.local or GitHub Actions Variables)
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
                Step B — Run in myClinic Repo (Deploy sync-clinic-license)
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
              Save as docker-compose.yml and run `docker compose up -d`
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
