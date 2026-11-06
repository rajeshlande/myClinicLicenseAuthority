import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Globe,
  KeyRound,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  generateRsaKeyPairPem,
  verifyCapabilityJwt,
} from '../lib/crypto-rs256.mjs';

export default function ValidatorLabPage({ backend }) {
  const [simKey, setSimKey] = useState('9F4A2C81E70B3D564A19C8E2710F5B3D');
  const [simFingerprint, setSimFingerprint] = useState(
    'node_mumbai_bandra_branch_03',
  );
  const [simResult, setSimResult] = useState(null);
  const [simBusy, setSimBusy] = useState(false);

  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyPubKeyInput, setVerifyPubKeyInput] = useState('');
  const [verifyFpInput, setVerifyFpInput] = useState('');
  const [verifyOriginInput, setVerifyOriginInput] = useState('');
  const [verifyOutcome, setVerifyOutcome] = useState(null);

  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [copiedSlot, setCopiedSlot] = useState('');

  const copyText = async (slot, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSlot(slot);
      setTimeout(() => {
        setCopiedSlot((cur) => (cur === slot ? '' : cur));
      }, 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleRunPhoneHome = async (e) => {
    e.preventDefault();
    setSimBusy(true);
    try {
      if (backend.mode === 'cloud') {
        const res = await fetch(backend.verifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: backend.health.anonKey,
          },
          body: JSON.stringify({
            license_key: simKey.trim().toUpperCase(),
            machine_fingerprint: simFingerprint.trim(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setSimResult({ status: res.status, body });
        if (body.token) {
          setVerifyTokenInput(body.token);
          setVerifyFpInput(simFingerprint.trim());
        }
      } else {
        const outcome = await backend.demoAuthority.verifyLicenseSimulated({
          license_key: simKey,
          machine_fingerprint: simFingerprint,
        });
        setSimResult(outcome);
        if (outcome.body?.token) {
          setVerifyTokenInput(outcome.body.token);
          setVerifyPubKeyInput(outcome.publicKeyPem);
          setVerifyFpInput(simFingerprint.trim());
        }
      }
    } finally {
      setSimBusy(false);
    }
  };

  const handleOfflineVerify = async (e) => {
    e.preventDefault();
    const res = await verifyCapabilityJwt(verifyTokenInput, verifyPubKeyInput, {
      expectedFingerprint: verifyFpInput.trim() || null,
      expectedOrigin: verifyOriginInput.trim() || null,
    });
    setVerifyOutcome(res);
  };

  const handleGenerateKeys = async () => {
    setKeyBusy(true);
    try {
      const pair = await generateRsaKeyPairPem();
      setGeneratedKeys(pair);
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top 2-Column Split: Edge Heartbeat Simulator + Offline RS256 Verifier */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Panel 1: Edge Phone-Home Simulator */}
        <section className="console-panel flex flex-col overflow-hidden rounded-2xl">
          <div
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
            className="flex items-start justify-between gap-3 px-5 py-4"
          >
            <div className="flex items-center gap-2.5">
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
                <h2 className="text-sm font-semibold">
                  Phone-Home Edge Simulator
                </h2>
                <p style={{ color: 'var(--text-muted)' }} className="font-mono text-[11px]">
                  POST /functions/v1/verify-license
                </p>
              </div>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSimFingerprint('node_mumbai_bandra_branch_03')}
                className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px]"
              >
                <Cpu className="h-3 w-3 text-sky-400" />
                Node Preset
              </button>
              <button
                type="button"
                onClick={() =>
                  setSimFingerprint('web:https://cityclinic.github.io|clinic-01')
                }
                className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px]"
              >
                <Globe className="h-3 w-3 text-emerald-400" />
                Pages Preset
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 p-5">
            <form onSubmit={handleRunPhoneHome} className="space-y-3.5">
              <div>
                <label
                  htmlFor="sim-license-key"
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  32-Character License Key
                </label>
                <input
                  id="sim-license-key"
                  type="text"
                  required
                  value={simKey}
                  onChange={(e) => setSimKey(e.target.value)}
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="sim-fingerprint"
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  Hardware or GitHub Pages Origin Fingerprint
                </label>
                <input
                  id="sim-fingerprint"
                  type="text"
                  required
                  value={simFingerprint}
                  onChange={(e) => setSimFingerprint(e.target.value)}
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={simBusy}
                className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {simBusy ? 'Executing Heartbeat...' : 'Send Phone-Home Request'}
              </button>
            </form>

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
                    HTTP {simResult.status}{' '}
                    {simResult.status === 200 ? '· ISSUED 7D RS256 JWT' : '· REJECTED'}
                  </span>
                  {simResult.body?.token ? (
                    <button
                      type="button"
                      onClick={() => copyText('sim-jwt', simResult.body.token)}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                    >
                      {copiedSlot === 'sim-jwt' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" /> Copied JWT
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy JWT
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
                <pre className="max-h-52 overflow-auto p-3.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                  {JSON.stringify(simResult.body, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </section>

        {/* Panel 2: Offline RS256 SPKI Verifier */}
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
              <h2 className="text-sm font-semibold">
                Offline RS256 Capability Verifier
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="font-mono text-[11px]">
                Pins alg=RS256 · SPKI Public Key · Fingerprint &amp; Origin Lock
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
                  Signed Capability JWT (.license_cache / localStorage)
                </label>
                <textarea
                  rows={2}
                  required
                  value={verifyTokenInput}
                  onChange={(e) => setVerifyTokenInput(e.target.value)}
                  placeholder="Run the Phone-Home Simulator on the left to auto-fill a signed RS256 token..."
                  className="console-input mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px]"
                />
              </div>

              <div>
                <label
                  style={{ color: 'var(--text-secondary)' }}
                  className="block text-xs font-medium"
                >
                  SPKI Public Key (LICENSE_PUBLIC_KEY)
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
                    Expected Fingerprint (Optional)
                  </label>
                  <input
                    type="text"
                    value={verifyFpInput}
                    onChange={(e) => setVerifyFpInput(e.target.value)}
                    placeholder="node_... or web:..."
                    className="console-input mt-1 w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-xs font-medium"
                  >
                    Expected Web Origin (Optional)
                  </label>
                  <input
                    type="text"
                    value={verifyOriginInput}
                    onChange={(e) => setVerifyOriginInput(e.target.value)}
                    placeholder="https://clinic.github.io"
                    className="console-input mt-1 w-full rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="console-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-mono text-xs font-semibold"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Verify RS256 Signature Offline
              </button>
            </form>

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
                      <span>SIGNATURE VALID · CAPABILITY AUTHORIZED</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-rose-400" />
                      <span>HTTP 402 GATE · {verifyOutcome.code}</span>
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

      {/* Bottom Full-Width Section: 2048-Bit WebCrypto RS256 Keypair Studio */}
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
              <h2 className="text-sm font-semibold">
                Asymmetric 2048-Bit RSA Keypair Studio (WebCrypto)
              </h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Generates PKCS#8 <code className="font-mono">LICENSE_PRIVATE_KEY</code>{' '}
                (Edge Secret only) &amp; SPKI{' '}
                <code className="font-mono">LICENSE_PUBLIC_KEY</code> (Clinic Nodes / GitHub Pages) locally in browser RAM.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={keyBusy}
            onClick={handleGenerateKeys}
            className="console-btn-primary inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {keyBusy ? 'Generating 2048-bit RSA...' : 'Mint Fresh RS256 Keypair'}
          </button>
        </div>

        {generatedKeys ? (
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            <div className="console-code overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                <span className="font-mono text-[11px] font-semibold text-rose-300">
                  LICENSE_PRIVATE_KEY (PKCS#8 · Edge Function Secret ONLY)
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
                      <Check className="h-3 w-3 text-emerald-400" /> Copied .env
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy \n-escaped
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-52 overflow-auto p-4 font-mono text-[11px] text-rose-200/90">
                {generatedKeys.privateKeyPem}
              </pre>
            </div>

            <div className="console-code overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                <span className="font-mono text-[11px] font-semibold text-emerald-300">
                  LICENSE_PUBLIC_KEY (SPKI · Safe for Docker &amp; GitHub Pages)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('pub-env', generatedKeys.publicKeyEnv)}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 font-mono text-[10px] text-slate-200 hover:bg-slate-700"
                >
                  {copiedSlot === 'pub-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copied .env
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy \n-escaped
                    </>
                  )}
                </button>
              </div>
              <pre className="max-h-52 overflow-auto p-4 font-mono text-[11px] text-emerald-300">
                {generatedKeys.publicKeyPem}
              </pre>
            </div>
          </div>
        ) : (
          <div
            style={{ color: 'var(--text-muted)' }}
            className="px-5 py-10 text-center text-xs"
          >
            Click <strong>Mint Fresh RS256 Keypair</strong> above (or run{' '}
            <code className="font-mono">npm run keygen</code> in your terminal) to generate an asymmetric keypair.
          </div>
        )}
      </section>
    </div>
  );
}
