import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import {
  generateRsaKeyPairPem,
  verifyCapabilityJwt,
} from '../lib/crypto-rs256.mjs';
import {
  explainError,
  fetchWithTimeout,
  rememberError,
  validatePublicKeyPemInput,
} from '../lib/errors.mjs';

export function ValidatorLabPage({ backend, records = [] }) {
  const firstActive = records.find((r) => r.is_active) ?? records[0] ?? null;

  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [copiedSlot, setCopiedSlot] = useState(null);

  const [simLicenseKey, setSimLicenseKey] = useState(
    firstActive?.license_key ?? '',
  );
  const [simFingerprint, setSimFingerprint] = useState('');
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyPubKeyInput, setVerifyPubKeyInput] = useState('');
  const [verifyFpInput, setVerifyFpInput] = useState('');
  const [verifyOriginInput, setVerifyOriginInput] = useState('');
  const [verifyOutcome, setVerifyOutcome] = useState(null);
  const [verifyError, setVerifyError] = useState(null);

  async function ensureKeypair() {
    if (generatedKeys) return generatedKeys;
    const keys = await generateRsaKeyPairPem();
    setGeneratedKeys(keys);
    setVerifyPubKeyInput((prev) => prev || keys.publicKeyPem);
    return keys;
  }

  async function handleGenerateKeys() {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const keys = await generateRsaKeyPairPem();
      setGeneratedKeys(keys);
      setVerifyPubKeyInput(keys.publicKeyPem);
    } catch (err) {
      setKeyError(rememberError(err, 'Generate RS256 keypair'));
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleRunHeartbeat(event) {
    event.preventDefault();
    setSimBusy(true);
    setSimResult(null);
    setSimError(null);

    try {
      if (!backend?.configured || !backend?.health?.url) {
        throw new Error('Authority Supabase connection is not configured.');
      }

      if (!simLicenseKey.trim() || !simFingerprint.trim()) {
        throw new Error('Enter both a License Key and a Machine / Origin Fingerprint.');
      }

      const verifyEndpoint =
        backend.verifyUrl ||
        `${String(backend.health.url).replace(/\/+$/, '')}/functions/v1/verify-license`;
      const isWebFp = simFingerprint.trim().startsWith('web:');
      const headers = { 'Content-Type': 'application/json' };
      if (isWebFp && backend.health?.anonKey) {
        headers.apikey = backend.health.anonKey;
      }

      const response = await fetchWithTimeout(
        verifyEndpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            license_key: simLicenseKey.trim(),
            machine_fingerprint: simFingerprint.trim(),
          }),
        },
        12000,
      );

      const payload = await response.json().catch(() => ({}));
      const res = {
        status: response.status,
        body: payload,
      };
      setSimResult(res);

      if (res.status === 200 && res.body?.token) {
        setVerifyTokenInput(res.body.token);
        setVerifyFpInput(simFingerprint.trim());
      } else if (res.status !== 200) {
        const errPayload = {
          status: res.status,
          code: res.body?.code || String(res.status),
          message:
            res.body?.error ||
            res.body?.message ||
            `verify-license returned HTTP ${res.status}`,
        };
        setSimError(explainError(errPayload, { context: 'License check refused' }));
      }
    } catch (err) {
      setSimError(rememberError(err, 'Live verify-license test'));
    } finally {
      setSimBusy(false);
    }
  }

  async function handleOfflineVerify(event) {
    event.preventDefault();
    setVerifyError(null);
    setVerifyOutcome(null);

    try {
      if (verifyPubKeyInput.trim()) {
        const pubCheck = validatePublicKeyPemInput(verifyPubKeyInput);
        if (!pubCheck.ok) {
          throw new Error(pubCheck.error);
        }
      }

      const pubKey = verifyPubKeyInput.trim()
        ? verifyPubKeyInput.replace(/\\n/g, '\n')
        : (await ensureKeypair()).publicKeyPem;

      const outcome = await verifyCapabilityJwt(verifyTokenInput, pubKey, {
        expectedFingerprint: verifyFpInput.trim() || null,
        expectedOrigin: verifyOriginInput.trim() || null,
      });
      setVerifyOutcome(outcome);
    } catch (err) {
      setVerifyError(rememberError(err, 'Offline JWT verification'));
    }
  }

  async function copyText(slot, value) {
    const res = await copyTextToClipboard(value);
    if (!res.ok) {
      setKeyError(rememberError(res.error, 'Copy key or token'));
      return;
    }
    setCopiedSlot(slot);
    setTimeout(() => setCopiedSlot(null), 1600);
  }

  return (
    <div className="space-y-6">
      {/* 1. Keypair Generator */}
      <section className="console-panel overflow-hidden rounded-2xl">
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
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
            <div>
              <h2 className="text-sm font-semibold">RS256 Keypair Generator</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Generate 2048-bit RSA signing (PKCS#8) and verification (SPKI) keys locally in browser memory.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={keyBusy}
            onClick={handleGenerateKeys}
            className="console-btn-primary inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {keyBusy ? 'Generating...' : 'Generate Keypair'}
          </button>
        </div>

        {keyError ? (
          <div className="p-5 pb-0">
            <ErrorAlert
              error={keyError}
              context="Key tool error"
              onDismiss={() => setKeyError(null)}
            />
          </div>
        ) : null}

        {generatedKeys ? (
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            <div className="console-code overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                <span className="font-mono text-[11px] font-semibold text-rose-300">
                  LICENSE_PRIVATE_KEY (Authority Edge Secret ONLY)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText('priv-env', generatedKeys.privateKeyEnv)
                  }
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-700"
                >
                  {copiedSlot === 'priv-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-48 overflow-auto p-4 font-mono text-[11px] text-rose-200/90">
                {generatedKeys.privateKeyPem}
              </pre>
            </div>

            <div className="console-code overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                <span className="font-mono text-[11px] font-semibold text-emerald-300">
                  LICENSE_PUBLIC_KEY (myClinic / Client Nodes)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('pub-env', generatedKeys.publicKeyEnv)}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-700"
                >
                  {copiedSlot === 'pub-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-48 overflow-auto p-4 font-mono text-[11px] text-emerald-300">
                {generatedKeys.publicKeyPem}
              </pre>
            </div>
          </div>
        ) : null}
      </section>

      {/* 2. Verification Tools */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="console-panel flex flex-col overflow-hidden rounded-2xl">
          <div
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
            className="flex items-center gap-2.5 px-5 py-4"
          >
            <span
              style={{
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-border)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400"
            >
              <Terminal className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Live Heartbeat Check</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Test live token issuance from verify-license (12s timeout guard).
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-4 p-5">
            <form onSubmit={handleRunHeartbeat} className="space-y-3.5">
              <div>
                <label
                  htmlFor="sim-license-key"
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  License Key
                </label>
                <input
                  id="sim-license-key"
                  type="text"
                  required
                  value={simLicenseKey}
                  onChange={(e) => setSimLicenseKey(e.target.value)}
                  placeholder="32-character license key"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="sim-fingerprint"
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Machine / Origin Fingerprint
                </label>
                <input
                  id="sim-fingerprint"
                  type="text"
                  required
                  value={simFingerprint}
                  onChange={(e) => setSimFingerprint(e.target.value)}
                  placeholder="node_01 or web:https://clinic.github.io"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={simBusy}
                className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {simBusy ? 'Testing...' : 'Verify License'}
              </button>
            </form>

            {simError ? (
              <ErrorAlert
                error={simError}
                context="License check failed"
                onDismiss={() => setSimError(null)}
              />
            ) : null}

            {simResult ? (
              <div className="console-code overflow-hidden rounded-xl">
                <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2 font-mono text-[11px]">
                  <span
                    className={
                      simResult.status === 200
                        ? 'font-semibold text-emerald-400'
                        : 'font-semibold text-rose-400'
                    }
                  >
                    HTTP {simResult.status}
                  </span>
                  {simResult.body?.token ? (
                    <button
                      type="button"
                      onClick={() => copyText('sim-jwt', simResult.body.token)}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                    >
                      {copiedSlot === 'sim-jwt' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy Token
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
                <pre className="max-h-48 overflow-auto p-3.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                  {JSON.stringify(simResult.body, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </section>

        <section className="console-panel flex flex-col overflow-hidden rounded-2xl">
          <div
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
            className="flex items-center gap-2.5 px-5 py-4"
          >
            <span
              style={{
                backgroundColor: 'var(--info-soft)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sky-400"
            >
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Offline Token Inspector</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Verify a signed capability JWT offline against an SPKI public key.
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-4 p-5">
            <form onSubmit={handleOfflineVerify} className="space-y-3">
              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Signed Token
                </label>
                <textarea
                  rows={2}
                  required
                  value={verifyTokenInput}
                  onChange={(e) => setVerifyTokenInput(e.target.value)}
                  placeholder="eyJhbGciOiJSUzI1NiIs..."
                  className="console-input mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px]"
                />
              </div>

              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Public Key (SPKI PEM — never private)
                </label>
                <textarea
                  rows={3}
                  required
                  value={verifyPubKeyInput}
                  onChange={(e) => setVerifyPubKeyInput(e.target.value)}
                  placeholder="-----BEGIN PUBLIC KEY----- ..."
                  className="console-input mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Expected Fingerprint
                  </label>
                  <input
                    type="text"
                    value={verifyFpInput}
                    onChange={(e) => setVerifyFpInput(e.target.value)}
                    placeholder="Optional"
                    className="console-input mt-1 w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Expected Origin
                  </label>
                  <input
                    type="text"
                    value={verifyOriginInput}
                    onChange={(e) => setVerifyOriginInput(e.target.value)}
                    placeholder="Optional"
                    className="console-input mt-1 w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="console-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Verify Signature
              </button>
            </form>

            {verifyError ? (
              <ErrorAlert
                error={verifyError}
                context="Token verification failed"
                onDismiss={() => setVerifyError(null)}
              />
            ) : null}

            {verifyOutcome ? (
              <div
                style={
                  verifyOutcome.valid
                    ? {
                        backgroundColor: 'var(--accent-soft)',
                        border: '1px solid var(--accent-border)',
                      }
                    : {
                        backgroundColor: 'var(--danger-soft)',
                        border: '1px solid rgba(244, 63, 94, 0.35)',
                      }
                }
                className="rounded-xl p-3.5 text-xs"
              >
                <div className="flex items-center gap-2 font-mono font-semibold">
                  {verifyOutcome.valid ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>VALID</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-rose-400" />
                      <span>INVALID · {verifyOutcome.code}</span>
                    </>
                  )}
                </div>
                {verifyOutcome.valid ? (
                  <pre className="console-code mt-2.5 max-h-44 overflow-auto rounded-lg p-3 font-mono text-[11px] text-slate-200">
                    {JSON.stringify(verifyOutcome.claims, null, 2)}
                  </pre>
                ) : (
                  <p className="mt-1.5 text-[11px] opacity-90">
                    {verifyOutcome.reason}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export default ValidatorLabPage;
