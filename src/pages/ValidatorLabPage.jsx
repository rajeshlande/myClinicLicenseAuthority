import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Globe,
  Loader2,
  Lock,
  Mail,
  Play,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import ErrorAlert from '../components/ErrorAlert.jsx';
import {
  probeCentralAutoSync,
  syncCentralSubscription,
} from '../lib/auto-sync-client.mjs';
import { rememberError } from '../lib/errors.mjs';

const SECURITY_LAYERS = [
  {
    id: 'rls',
    title: 'FORCE ROW LEVEL SECURITY on all 7 Central tables',
    detail:
      'anon has REVOKE ALL on subscriptions, licenses, activated_machines, sync_rate_limits, sync_attempts, app_meta, and admin_license_view.',
  },
  {
    id: 'origin',
    title: 'PostgREST Unforgeable Browser Origin Verification',
    detail:
      'sync_clinic_subscription cross-checks p_origin against HTTP request.headers Origin to block cross-domain spoofing.',
  },
  {
    id: 'ratelimit',
    title: 'Privacy-Preserving SHA-256 IP Rate Limiter',
    detail:
      'Caps traffic at 60 calls/min and 15 unmatched attempts/5min per hashed IP without storing raw visitor IP addresses.',
  },
  {
    id: 'seat',
    title: 'Deterministic Cloud Seat Fingerprinting',
    detail:
      'Cloud URLs bind deterministically to web:<origin> so external curl scripts cannot exhaust clinic deployment seats.',
  },
  {
    id: 'audit',
    title: 'Read-Only Refused-Attempt Audit (Schema v3)',
    detail:
      'Every refusal lands in sync_attempts with a hashed IP and a masked mailbox, attributed to the subscription it almost matched. Admins can read it; nobody — not even an admin token — can write or erase it.',
  },
];

export function ValidatorLabPage({ backend }) {
  const centralUrl = String(backend?.health?.url ?? '')
    .trim()
    .replace(/\/+$/, '');
  const centralAnonKey = String(backend?.health?.anonKey ?? '').trim();

  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState(null);
  const [probeError, setProbeError] = useState(null);

  const [simEmail, setSimEmail] = useState('');
  const [simOrigin, setSimOrigin] = useState('https://rajeshlande.github.io');
  const [simBusy, setSimBusy] = useState(false);
  const [simLatency, setSimLatency] = useState(null);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  async function handleRunHealthProbe() {
    setProbeBusy(true);
    setProbeError(null);
    setProbeResult(null);
    const started = performance.now();
    try {
      const res = await probeCentralAutoSync(centralUrl, centralAnonKey, {
        timeoutMs: 10000,
      });
      setProbeResult({
        ...res,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      setProbeError(rememberError(err, 'Probe sync_clinic_subscription RPC'));
    } finally {
      setProbeBusy(false);
    }
  }

  async function handleRunSimulation(event) {
    event.preventDefault();
    setSimBusy(true);
    setSimError(null);
    setSimResult(null);
    const started = performance.now();
    try {
      if (!centralUrl || !centralAnonKey) {
        throw new Error('Configure Central Supabase in Settings first.');
      }
      const sessionRes = await backend?.supabase?.auth?.getSession?.();
      const bearerToken = sessionRes?.data?.session?.access_token ?? '';

      const verdict = await syncCentralSubscription({
        centralUrl,
        centralAnonKey,
        email: simEmail,
        origin: simOrigin,
        deviceId: 'admin-preview',
        bearerToken,
      });
      setSimLatency(Math.round(performance.now() - started));
      setSimResult(verdict);
    } catch (err) {
      setSimError(rememberError(err, 'Live Auto-Sync simulation'));
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Live Auto-Sync Tester */}
        <section className="console-panel relative overflow-hidden rounded-2xl p-5 sm:p-6 lg:col-span-7">
          <span className="cf-top-stripe absolute inset-x-0 top-0 h-[3px]" />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="badge-accent inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-bold">
                <Zap className="h-3 w-3" />
                Zero-Seat Admin Preview
              </div>
              <h2 className="mt-2.5 text-base font-bold sm:text-lg">
                Test Clinic Auto-Sync Verdict
              </h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-0.5 text-xs"
              >
                Simulate what <code className="font-mono">myClinic</code>{' '}
                receives for any Clinic Owner Email and/or Website URL without
                consuming a seat.
              </p>
            </div>

            <button
              type="button"
              disabled={probeBusy}
              onClick={handleRunHealthProbe}
              className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-semibold"
            >
              {probeBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Activity
                  style={{ color: 'var(--brand-text)' }}
                  className="h-3.5 w-3.5"
                />
              )}
              Ping RPC
            </button>
          </div>

          {probeResult ? (
            <div
              role="status"
              className="badge-success mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-medium"
            >
              <CheckCircle2
                style={{ color: 'var(--ok-main)' }}
                className="h-4 w-4 shrink-0"
              />
              <span>
                <code className="font-mono">sync_clinic_subscription</code>{' '}
                online · Schema v{probeResult.schemaVersion} ·{' '}
                {probeResult.latencyMs} ms
              </span>
            </div>
          ) : null}

          {probeError ? (
            <div className="mt-4">
              <ErrorAlert
                error={probeError}
                context="RPC Health Probe"
                onRetry={handleRunHealthProbe}
                onDismiss={() => setProbeError(null)}
              />
            </div>
          ) : null}

          <form onSubmit={handleRunSimulation} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="sim-clinic-email"
                  style={{ color: 'var(--text-primary)' }}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Clinic Owner Email
                </label>
                <input
                  id="sim-clinic-email"
                  type="email"
                  value={simEmail}
                  onChange={(e) => setSimEmail(e.target.value)}
                  placeholder="dr.sharma@sharmaclinic.in"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="sim-clinic-origin"
                  style={{ color: 'var(--text-primary)' }}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Clinic Website URL
                </label>
                <input
                  id="sim-clinic-origin"
                  type="url"
                  value={simOrigin}
                  onChange={(e) => setSimOrigin(e.target.value)}
                  placeholder="https://sharmaclinic.github.io"
                  className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 font-mono text-xs"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={simBusy}
              className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold sm:w-auto"
            >
              {simBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run Live Auto-Sync Check
            </button>
          </form>

          {simError ? (
            <div className="mt-4">
              <ErrorAlert
                error={simError}
                context="Auto-Sync Simulation"
                onDismiss={() => setSimError(null)}
              />
            </div>
          ) : null}

          {simResult ? (
            <div className="mt-5 space-y-3">
              <div
                className={`${
                  simResult.allowed ? 'badge-success' : 'badge-error'
                } flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold`}
              >
                <span className="inline-flex items-center gap-2">
                  {simResult.allowed ? (
                    <CheckCircle2
                      style={{ color: 'var(--ok-main)' }}
                      className="h-4 w-4 shrink-0"
                    />
                  ) : (
                    <ShieldAlert
                      style={{ color: 'var(--danger-main)' }}
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  {simResult.allowed
                    ? `UNLOCKED · Plan ${(simResult.plan || simResult.tier || '').toUpperCase()} (${simResult.match_mode || 'matched'})`
                    : `LOCKED (Read-Only) · ${simResult.code || simResult.status}`}
                </span>
                {simLatency !== null ? (
                  <span className="font-mono text-[11px]">{simLatency} ms</span>
                ) : null}
              </div>

              <div className="console-code overflow-hidden rounded-xl">
                <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(simResult, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </section>

        {/* Right Column: Central DB Firewall Posture */}
        <section className="console-panel space-y-4 rounded-2xl p-5 sm:p-6 lg:col-span-5">
          <div className="flex items-center gap-2.5">
            <div className="badge-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Lock style={{ color: 'var(--brand-text)' }} className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">
                Central Supabase Firewall Posture
              </h2>
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="text-xs"
              >
                Active database protections on direct client connections
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {SECURITY_LAYERS.map((layer) => (
              <div key={layer.id} className="console-well rounded-xl p-3.5">
                <div className="flex items-start gap-2">
                  <ShieldCheck
                    style={{ color: 'var(--ok-main)' }}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <div className="text-xs font-bold">{layer.title}</div>
                    <p
                      style={{ color: 'var(--text-secondary)' }}
                      className="mt-0.5 text-[11px] leading-relaxed"
                    >
                      {layer.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default ValidatorLabPage;
