import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  ClipboardList,
  Copy,
  Database,
  Globe,
  Hash,
  KeyRound,
  Loader2,
  Mail,
  Minus,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import RichNotesField from '../RichNotesField.jsx';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  defaultExpirationDate,
  validateProvisionInput,
} from '../../lib/entitlements.mjs';
import { buildInvoiceDraft, termMonths } from '../../lib/invoices.mjs';
import { rememberError } from '../../lib/errors.mjs';
import { copyTextToClipboard } from '../../lib/clipboard.mjs';
import {
  buildTenantConnectionKit,
  connectionReadiness,
  maskTenantKey,
  persistWorkspaceConnection,
  runTenantConnectionChecks,
  slugifyClinicName,
  validateWorkspaceConnection,
} from '../../lib/tenant-connection.mjs';
import {
  KEEP_WARM,
  TENANT_CLINICAL_PROBE_TABLE,
  TENANT_SCHEMA_VERSION,
} from '../../lib/workspace-directory.mjs';
import { verifyRowsLanded } from '../../lib/write-verify.mjs';

/** Check state -> the shell's badge classes (same tones as the rest of the console). */
const CHECK_TONE = {
  pass: 'badge-success',
  warn: 'badge-warning',
  fail: 'badge-error',
  skip: 'console-well',
};

const STEPS = [
  { id: 1, label: 'Identity' },
  { id: 2, label: 'Connection' },
  { id: 3, label: 'Plan' },
  { id: 4, label: 'Term' },
  { id: 5, label: 'Review' },
  { id: 6, label: 'Handoff' },
];

const LAST_STEP = STEPS.length;
const CREATE_STEP = 5;

const HANDOFF_ITEMS = [
  {
    id: 'signin',
    text: 'The clinic opens myClinic at the pinned origin — or signs in with the pinned owner email. No license key is ever typed.',
  },
  {
    id: 'sw',
    text: 'The browser accepts the myClinic service worker once. If an older myClinic was installed there, clear its site data first (Settings → Apps → clear cache).',
  },
  {
    id: 'sync',
    text: 'The client auto-syncs on page open, tab focus, reconnect, and every 30 minutes. Refusals (wrong email/URL) appear in Central with masked evidence.',
  },
  {
    id: 'tenant',
    text: `If a tenant project was linked, copy its connection kit and run the verification SQL in the clinic\u2019s own Supabase (tenant schema v${TENANT_SCHEMA_VERSION}). The workspace pointer goes live only after the 5-point check passes; Central keeps a free-tier project warm with a probe every ${KEEP_WARM.target_days} days, because an idle project pauses after ${KEEP_WARM.pause_days}.`,
  },
];

/**
 * End-to-end clinic onboarding (Enrolliq slice 6, extended by OPD P2 / R2 §6 E3):
 * identity pinning -> TENANT CONNECTION (clinic name, slug, tenant Supabase URL
 * and publishable key, verified by a live 5-point check) -> plan & seats -> term
 * & notes -> review & create (provisioning RPC, unchanged wire shape) -> first
 * invoice draft (schema v4) + workspace directory row (schema v5/v6) -> handoff
 * checklist with the copyable tenant connection kit (E4).
 *
 * The Connection step is optional: a clinic without its own Supabase project
 * still gets a licence. What it cannot get is a workspace pointer, because
 * `is_active` is only set when the 5-point check passes — a dark workspace
 * withdraws the pointer without touching the licence verdict (P1b).
 *
 * @param {object} props
 * @param {object} props.backend resolved Central backend
 * @param {string} [props.operatorEmail] actor recorded on the onboarded event
 * @param {(row: object, meta: object) => void} props.onProvisioned
 * @param {() => void} props.onClose
 */
export default function OnboardingWizard({
  backend,
  operatorEmail = '',
  onProvisioned,
  onClose,
}) {
  const supabase = backend.supabase;
  const [step, setStep] = useState(1);
  const [customerEmail, setCustomerEmail] = useState('');
  const [allowedOrigin, setAllowedOrigin] = useState('');
  const [lockFirstOrigin, setLockFirstOrigin] = useState(true);
  const [tier, setTier] = useState('growth');
  const [maxMachines, setMaxMachines] = useState(2);
  const [expiresDate, setExpiresDate] = useState(() =>
    defaultExpirationDate(365),
  );
  const [notes, setNotes] = useState('');
  const [stepError, setStepError] = useState('');

  // OPD tenant connection (step 2)
  const [clinicName, setClinicName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tenantUrl, setTenantUrl] = useState('');
  const [tenantKey, setTenantKey] = useState('');
  const [connChecks, setConnChecks] = useState(null);
  const [connBusy, setConnBusy] = useState(false);
  const [connError, setConnError] = useState('');
  const [workspaceWarning, setWorkspaceWarning] = useState('');
  const [linkedWorkspace, setLinkedWorkspace] = useState(null);
  const [workspaceStamped, setWorkspaceStamped] = useState(false);
  const [kitCopied, setKitCopied] = useState(false);
  const [kitError, setKitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdRow, setCreatedRow] = useState(null);
  const [createdInvoice, setCreatedInvoice] = useState(null);
  const [invoiceWarning, setInvoiceWarning] = useState('');
  const [checked, setChecked] = useState({});

  const months = useMemo(
    () => termMonths(new Date(`${expiresDate}T23:59:59.000Z`)),
    [expiresDate],
  );

  // validateProvisionInput() takes camelCase fields and returns the exact
  // `p_*` RPC payload — one validator, one wire shape, same as v2.
  const payload = useMemo(
    () => ({
      customerEmail,
      allowedOrigin,
      lockFirstOrigin,
      tier,
      maxMachines,
      expiresDate,
      notes,
    }),
    [customerEmail, allowedOrigin, lockFirstOrigin, tier, maxMachines, expiresDate, notes],
  );

  // Offline gate for the Connection step. `skipped` is a first-class outcome:
  // no tenant project yet, licence still issued.
  const connection = useMemo(
    () =>
      validateWorkspaceConnection({
        clinicName,
        slug: tenantSlug,
        supabaseUrl: tenantUrl,
        supabaseAnonKey: tenantKey,
      }),
    [clinicName, tenantSlug, tenantUrl, tenantKey],
  );

  const readiness = useMemo(() => connectionReadiness(connChecks), [connChecks]);

  // Any edit invalidates a previous probe: a stale "pass" next to changed
  // credentials is worse than no result at all.
  const connectionEdited = () => setConnChecks(null);

  const handleClinicName = (value) => {
    setClinicName(value);
    if (!slugTouched) setTenantSlug(slugifyClinicName(value));
    connectionEdited();
  };

  const tenantKit = useMemo(
    () =>
      buildTenantConnectionKit({
        workspace: linkedWorkspace
          ? {
              clinic_name: linkedWorkspace.clinic_name ?? clinicName,
              slug: linkedWorkspace.slug ?? tenantSlug,
              supabase_url: linkedWorkspace.supabase_url ?? tenantUrl,
              supabase_anon_key: tenantKey,
              tenant_schema_version:
                linkedWorkspace.tenant_schema_version ?? TENANT_SCHEMA_VERSION,
              is_active: Boolean(linkedWorkspace.is_active),
            }
          : null,
      }),
    [linkedWorkspace, clinicName, tenantSlug, tenantUrl, tenantKey],
  );

  async function handleRunConnectionCheck() {
    setConnBusy(true);
    setConnError('');
    setConnChecks(null);
    try {
      if (!connection.ok || connection.skipped) {
        throw new Error(
          connection.error?.message ??
            'Enter the clinic name, slug, tenant URL and publishable key first.',
        );
      }
      setConnChecks(
        await runTenantConnectionChecks({
          supabaseUrl: connection.value.supabase_url,
          supabaseAnonKey: connection.value.supabase_anon_key,
        }),
      );
    } catch (err) {
      const explained = rememberError(err, 'Tenant connection check');
      setConnError(explained.message ?? String(explained));
    } finally {
      setConnBusy(false);
    }
  }

  async function handleCopyTenantKit() {
    setKitError('');
    const res = await copyTextToClipboard(tenantKit.text);
    if (!res.ok) {
      setKitError(res.error);
      return;
    }
    setKitCopied(true);
    setTimeout(() => setKitCopied(false), 2200);
  }

  const previewInvoice = useMemo(
    () =>
      buildInvoiceDraft({
        subscriptionId: 'preview',
        tier,
        seats: maxMachines,
        termMonths: months,
        existingCount: 0,
      }),
    [tier, maxMachines, months],
  );

  const validateStep = (target) => {
    if (target >= 2) {
      const check = validateProvisionInput(payload);
      if (!check.ok) {
        setStepError(check.error?.message ?? String(check.error));
        return false;
      }
    }
    // Leaving the Connection step: either a valid handover, or nothing typed.
    if (target >= 3 && !connection.ok) {
      setStepError(
        `${connection.error?.message ?? 'Invalid tenant connection.'} ${connection.error?.hint ?? ''}`.trim(),
      );
      return false;
    }
    if (target >= CREATE_STEP && months < 1) {
      setStepError('Subscription end date must be in the future.');
      return false;
    }
    setStepError('');
    return true;
  };

  const goNext = () => {
    if (!validateStep(step + 1)) return;
    setStep((s) => Math.min(LAST_STEP, s + 1));
  };

  const createSubscription = async () => {
    if (!validateStep(CREATE_STEP)) return;
    setSubmitting(true);
    setStepError('');
    try {
      const check = validateProvisionInput(payload);
      if (!check.ok) throw check.error;
      const { data, error } = await supabase.rpc(
        'create_subscription_with_license',
        check.payload,
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('Central returned no provisioned row.');

      // OPD workspace directory (schema v5 tables, v6 keep-warm stamp).
      // Best-effort like the invoice draft: the licence already exists, so a
      // Central still on v4/v5 keeps onboarding and shows a warning. `isActive`
      // is the 5-point verdict — never a typed value on its own.
      let linked = null;
      if (connection.ok && !connection.skipped) {
        const probed = (connChecks ?? []).find(
          (c) => c.id === 'schema-version' && c.state === 'pass',
        );
        try {
          const result = await persistWorkspaceConnection(supabase, {
            value: connection.value,
            subscriptionId: row.subscription_id,
            tenantSchemaVersion: probed ? TENANT_SCHEMA_VERSION : 0,
            isActive: readiness.linkable,
            stampKeepWarm: readiness.linkable,
          });
          linked = result.workspace;
          setLinkedWorkspace(result.workspace);
          setWorkspaceStamped(result.stamped);
          if (result.warnings.length) setWorkspaceWarning(result.warnings.join(' '));
        } catch (wsErr) {
          setWorkspaceWarning(
            `Subscription created, but the tenant workspace could not be linked (${wsErr?.message ?? wsErr}). Central needs schema v5 or later.`,
          );
        }
      }

      // First invoice draft (schema v4). Best-effort: a Central project still
      // on schema v3 keeps onboarding working, with a visible warning.
      let invoice = null;
      try {
        const countRes = await supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true });
        const draft = buildInvoiceDraft({
          subscriptionId: row.subscription_id,
          licenseId: row.license_id,
          tier,
          seats: maxMachines,
          termMonths: months,
          existingCount: countRes.count ?? 0,
        });
        const invRes = await supabase.from('invoices').insert(draft).select('id');
        if (invRes.error) throw invRes.error;
        // `invoices_admin_insert` is a WITH CHECK policy: a refused append
        // returns no error at all, so without this the wizard would report a
        // stored draft that the billing history never received.
        verifyRowsLanded(invRes, {
          action: 'Store the first invoice draft',
          table: 'invoices',
        });
        invoice = draft;
      } catch (invErr) {
        setInvoiceWarning(
          invErr?.silent
            ? `Subscription created, but the first invoice draft was refused: ${invErr.message}`
            : `Subscription created, but the first invoice draft could not be stored (${invErr.message ?? invErr}). Central needs schema v4.`,
        );
      }

      setCreatedRow(row);
      setCreatedInvoice(invoice);
      onProvisioned(row, {
        tier,
        seats: maxMachines,
        invoice: invoice?.invoice_number ?? null,
        label:
          row.customer_email || row.allowed_origin || clinicName || 'clinic',
        workspace: linked
          ? { slug: linked.slug, active: Boolean(linked.is_active) }
          : null,
      });
      setStep(LAST_STEP);
    } catch (err) {
      const explained = rememberError(err, 'Onboard clinic');
      setStepError(explained.message ?? String(explained));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="console-well flex items-center gap-1 overflow-x-auto rounded-xl p-1 no-scrollbar">
        {STEPS.map((s) => {
          const active = step === s.id;
          const done = step > s.id;
          const reachable = s.id < step && !createdRow;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!reachable && !active}
              onClick={() => reachable && setStep(s.id)}
              style={
                active
                  ? {
                      backgroundColor: 'var(--accent-badge-bg)',
                      color: 'var(--accent-badge-text)',
                    }
                  : {
                      color: done
                        ? 'var(--ok-text)'
                        : 'var(--text-secondary)',
                    }
              }
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] font-semibold disabled:cursor-default"
            >
              <span
                style={
                  done
                    ? { backgroundColor: 'var(--ok-main)' }
                    : active
                      ? { backgroundColor: 'var(--accent-badge-text)' }
                      : { backgroundColor: 'var(--border-strong)' }
                }
                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
              >
                {done ? <Check className="h-2.5 w-2.5" /> : s.id}
              </span>
              {s.label}
            </button>
          );
        })}
      </div>

      {stepError ? (
        <div className="badge-error rounded-xl px-3.5 py-2.5 text-xs font-semibold">
          {stepError}
        </div>
      ) : null}

      {/* Step 1 — Identity pinning */}
      {step === 1 ? (
        <div className="console-well space-y-3.5 rounded-xl p-4">
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="text-xs leading-relaxed"
          >
            Enter <strong>Owner Email</strong>, <strong>Clinic URL</strong>, or{' '}
            <strong>both</strong>. Providing both pins the subscription to that
            exact owner and domain — the client must then match BOTH.
          </p>
          <div>
            <label
              htmlFor="wiz-customer-email"
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <Mail className="h-3.5 w-3.5" />
              Clinic Owner Email{' '}
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="font-normal"
              >
                (optional if URL set)
              </span>
            </label>
            <input
              id="wiz-customer-email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="dr.sharma@sharmaclinic.in"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
            />
          </div>
          <div>
            <label
              htmlFor="wiz-allowed-origin"
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <Globe className="h-3.5 w-3.5" />
              Clinic Website URL{' '}
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="font-normal"
              >
                (optional if Email set)
              </span>
            </label>
            <input
              id="wiz-allowed-origin"
              type="url"
              value={allowedOrigin}
              onChange={(e) => setAllowedOrigin(e.target.value)}
              placeholder="https://sharmaclinic.github.io"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 font-mono text-xs"
            />
          </div>
          {!allowedOrigin.trim() ? (
            <label className="flex cursor-pointer items-start gap-2.5 pt-0.5 text-xs">
              <input
                type="checkbox"
                checked={lockFirstOrigin}
                onChange={(e) => setLockFirstOrigin(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="text-[11px] leading-relaxed"
              >
                <strong style={{ color: 'var(--text-primary)' }}>
                  Auto-lock first cloud URL
                </strong>{' '}
                — pins their domain automatically the first time they open{' '}
                <code className="font-mono">myClinic</code>.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {/* Step 2 — Tenant connection (OPD multi-tenant, R2 §6 E3) */}
      {step === 2 ? (
        <div className="space-y-4">
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="text-xs leading-relaxed"
          >
            Every clinic keeps its <strong>own</strong> Supabase project (free
            tier: 2 active projects per org) and hands over the project URL plus
            its <strong>publishable</strong> key. This step is{' '}
            <strong>optional</strong> — leave all four fields empty and the
            licence still works; the workspace pointer simply stays dark.
          </p>

          <div className="console-well space-y-3.5 rounded-xl p-4">
            <div>
              <label
                htmlFor="wiz-clinic-name"
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <Building2 className="h-3.5 w-3.5" />
                Clinic Name
              </label>
              <input
                id="wiz-clinic-name"
                type="text"
                value={clinicName}
                onChange={(e) => handleClinicName(e.target.value)}
                placeholder="Sunrise OPD"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="wiz-tenant-slug"
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <Hash className="h-3.5 w-3.5" />
                Tenant Slug
              </label>
              <input
                id="wiz-tenant-slug"
                type="text"
                value={tenantSlug}
                onChange={(e) => {
                  setTenantSlug(e.target.value.toLowerCase());
                  setSlugTouched(true);
                  connectionEdited();
                }}
                placeholder="sunrise-opd"
                spellCheck={false}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 font-mono text-xs"
              />
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 font-mono text-[10px] leading-relaxed"
              >
                derived from the clinic name · becomes the tenant_slug claim and
                the offline storage namespace
              </p>
            </div>

            <div>
              <label
                htmlFor="wiz-tenant-url"
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <Database className="h-3.5 w-3.5" />
                Tenant Supabase URL
              </label>
              <input
                id="wiz-tenant-url"
                type="url"
                value={tenantUrl}
                onChange={(e) => {
                  setTenantUrl(e.target.value);
                  connectionEdited();
                }}
                placeholder="https://project-ref.supabase.co"
                spellCheck={false}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="wiz-tenant-key"
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Publishable Key
              </label>
              <input
                id="wiz-tenant-key"
                type="text"
                value={tenantKey}
                onChange={(e) => {
                  setTenantKey(e.target.value);
                  connectionEdited();
                }}
                placeholder="sb_publishable_..."
                spellCheck={false}
                autoComplete="off"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 font-mono text-xs"
              />
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 font-mono text-[10px] leading-relaxed"
              >
                public by design · a secret key is refused here AND by the
                directory CHECK constraint
                {tenantKey ? ` · stored as ${maskTenantKey(tenantKey)}` : ''}
              </p>
            </div>
          </div>

          {/* The live 5-point check */}
          <div className="console-panel space-y-3 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold">Live 5-point check</span>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="mt-0.5 font-mono text-[10px] leading-relaxed"
                >
                  url shape · publishable key · REST answers · tenant schema v
                  {TENANT_SCHEMA_VERSION} · anon read of{' '}
                  {TENANT_CLINICAL_PROBE_TABLE} refused
                </p>
              </div>
              <button
                type="button"
                disabled={connBusy || !connection.ok || connection.skipped}
                onClick={() => void handleRunConnectionCheck()}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {connBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {connBusy ? 'Checking...' : 'Run check'}
              </button>
            </div>

            {!connection.ok ? (
              <div className="badge-error rounded-lg px-3 py-2.5 text-[11px] leading-relaxed">
                <strong>{connection.error?.message}</strong>
                {connection.error?.hint ? (
                  <span className="block opacity-90">{connection.error.hint}</span>
                ) : null}
              </div>
            ) : null}

            {connError ? (
              <div className="badge-error rounded-lg px-3 py-2.5 text-[11px] leading-relaxed">
                {connError}
              </div>
            ) : null}

            {connChecks ? (
              <>
                <ul className="space-y-1.5">
                  {connChecks.map((c) => (
                    <li
                      key={c.id}
                      className={`${CHECK_TONE[c.state] ?? 'console-well'} rounded-lg px-3 py-2 text-[11px] leading-relaxed`}
                    >
                      <span className="flex items-center gap-1.5 font-bold">
                        {c.state === 'pass' ? (
                          <Check className="h-3 w-3 shrink-0" />
                        ) : null}
                        <span className="font-mono text-[10px] uppercase opacity-80">
                          {c.id}
                        </span>
                        <span className="truncate">{c.label}</span>
                      </span>
                      <span
                        style={{ color: 'var(--text-secondary)' }}
                        className="mt-0.5 block break-words"
                      >
                        {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
                <div
                  className={`${readiness.linkable ? 'badge-success' : 'badge-warning'} rounded-lg px-3 py-2 text-[11px] font-semibold leading-relaxed`}
                >
                  {readiness.headline}
                  {readiness.linkable
                    ? ' — the workspace will be activated and its pointer served to the clinic.'
                    : ' — the workspace is recorded INACTIVE, so the pointer stays dark until this passes.'}
                </div>
              </>
            ) : (
              <p
                style={{ color: 'var(--text-secondary)' }}
                className="console-well rounded-lg px-3 py-2.5 text-[11px] leading-relaxed"
              >
                Nothing sent yet. The check uses only the clinic&apos;s
                publishable key — the same credentials the client will use — so
                a pass here is a pass in production.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* Step 3 — Plan & seats */}
      {step === 3 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {['solo', 'growth', 'chain'].map((value) => {
              const selected = tier === value;
              const seats = MYCLINIC_TIER_ENTITLEMENTS[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTier(value)}
                  style={
                    selected
                      ? {
                          backgroundColor: 'var(--accent-badge-bg)',
                          border: '1px solid var(--accent-badge-border)',
                        }
                      : {
                          backgroundColor: 'var(--bg-well)',
                          border: '1px solid var(--border-subtle)',
                        }
                  }
                  className="rounded-xl p-3 text-left transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase">
                      {value}
                    </span>
                    {selected ? (
                      <Check
                        style={{ color: 'var(--accent-badge-text)' }}
                        className="h-3.5 w-3.5"
                      />
                    ) : null}
                  </div>
                  <p
                    style={{ color: 'var(--text-secondary)' }}
                    className="mt-1 font-mono text-[10px] leading-relaxed"
                  >
                    {seats.doctors === null
                      ? 'Unlimited doctors & branches'
                      : `${seats.doctors} Doc · ${seats.frontdesk} Desk`}
                  </p>
                </button>
              );
            })}
          </div>
          <div className="console-well rounded-xl p-4">
            <span className="block text-xs font-semibold">
              Max Allowed Deployments
            </span>
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMaxMachines((n) => Math.max(1, Number(n) - 1))}
                className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={1}
                max={500}
                value={maxMachines}
                onChange={(e) =>
                  setMaxMachines(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                }
                className="console-input h-9 w-full rounded-lg px-3 text-center font-mono text-xs font-semibold"
              />
              <button
                type="button"
                onClick={() => setMaxMachines((n) => Math.min(500, Number(n) + 1))}
                className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 4 — Term & notes */}
      {step === 4 ? (
        <div className="space-y-4">
          <div className="console-well rounded-xl p-4">
            <label
              htmlFor="wiz-expires-date"
              className="block text-xs font-semibold"
            >
              Subscription End Date
            </label>
            <input
              id="wiz-expires-date"
              type="date"
              value={expiresDate}
              onChange={(e) => setExpiresDate(e.target.value)}
              className="console-input mt-1.5 h-9 w-full rounded-lg px-3 font-mono text-xs"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[
                { label: '+30d', days: 30 },
                { label: '+90d', days: 90 },
                { label: '+1yr', days: 365 },
                { label: '+2yr', days: 730 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setExpiresDate(defaultExpirationDate(preset.days))}
                  className="console-btn-secondary rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold"
                >
                  {preset.label}
                </button>
              ))}
              <span
                style={{ color: 'var(--text-secondary)' }}
                className="ml-auto self-center font-mono text-[10px]"
              >
                billed term: {months} month{months === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <RichNotesField value={notes} onChange={setNotes} />
        </div>
      ) : null}

      {/* Step 5 — Review & create */}
      {step === CREATE_STEP ? (
        <div className="space-y-4">
          <div className="console-well divide-y divide-[var(--border-subtle)] rounded-xl text-xs">
            {[
              ['Identity', customerEmail || allowedOrigin || '—', customerEmail && allowedOrigin ? allowedOrigin : ''],
              [
                'Connection',
                connection.skipped
                  ? 'no tenant project'
                  : connection.ok
                    ? connection.value.slug
                    : 'invalid',
                connection.skipped
                  ? 'pointer stays dark'
                  : readiness.linkable
                    ? 'verified — will be activated'
                    : connChecks
                      ? readiness.headline
                      : 'not checked — recorded inactive',
              ],
              ['Plan', tier.toUpperCase(), `${maxMachines} seats`],
              ['Term', expiresDate, `${months} months`],
              ['Notes', notes ? 'recorded' : 'none', ''],
            ].map(([label, a, b]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span
                  style={{ color: 'var(--text-secondary)' }}
                  className="font-mono text-[10px] font-bold uppercase"
                >
                  {label}
                </span>
                <span className="truncate font-mono text-[11px] font-semibold">
                  {a}
                  {b ? ` · ${b}` : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="console-panel rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
                First invoice draft (preview)
              </span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {previewInvoice.invoice_number} · GST 18%
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {previewInvoice.line_items.map((li) => (
                <li
                  key={li.description}
                  className="flex items-center justify-between gap-3 font-mono text-[11px]"
                >
                  <span className="truncate">{li.description}</span>
                  <span className="shrink-0 tabular-nums">
                    ₹{(li.qty * li.unit).toLocaleString('en-IN')}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span>GST @ 18%</span>
                <span className="tabular-nums">₹{previewInvoice.tax_amount.toLocaleString('en-IN')}</span>
              </li>
              <li className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-1 font-mono text-xs font-bold">
                <span>Total</span>
                <span className="tabular-nums">₹{previewInvoice.total.toLocaleString('en-IN')}</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void createSubscription()}
            className="console-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 stroke-[2.4]" />
            )}
            Create subscription + license + invoice draft
          </button>
        </div>
      ) : null}

      {/* Step 6 — Handoff checklist */}
      {step === LAST_STEP && createdRow ? (
        <div className="space-y-4">
          <div className="badge-success rounded-xl px-4 py-3 text-xs font-semibold">
            {createdRow.customer_email || createdRow.allowed_origin} is live on{' '}
            {String(createdRow.tier).toUpperCase()}
            {createdInvoice ? ` · draft ${createdInvoice.invoice_number}` : ''}
            {operatorEmail ? ` · logged by ${operatorEmail}` : ''}
          </div>
          {invoiceWarning ? (
            <div className="badge-warning rounded-xl px-4 py-2.5 text-[11px] font-semibold">
              {invoiceWarning}
            </div>
          ) : null}

          {workspaceWarning ? (
            <div className="badge-warning rounded-xl px-4 py-2.5 text-[11px] font-semibold">
              {workspaceWarning}
            </div>
          ) : null}

          {linkedWorkspace ? (
            <div className="console-well space-y-2.5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold">
                  <Database className="h-3.5 w-3.5" />
                  Tenant connection
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyTenantKit()}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold"
                >
                  {kitCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied kit
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy tenant connection kit
                    </>
                  )}
                </button>
              </div>

              <div className="divide-y divide-[var(--border-subtle)] text-[11px]">
                {[
                  ['slug', linkedWorkspace.slug],
                  [
                    'workspace pointer',
                    linkedWorkspace.is_active
                      ? 'ACTIVE — served on the anon RPC'
                      : 'DARK — inactive until the 5-point check passes',
                  ],
                  [
                    'tenant schema',
                    linkedWorkspace.tenant_schema_version
                      ? `v${linkedWorkspace.tenant_schema_version}`
                      : 'not verified',
                  ],
                  ['publishable key', maskTenantKey(tenantKey) || '—'],
                  [
                    'keep-warm',
                    workspaceStamped
                      ? `stamped now — pg_cron re-probes every ${KEEP_WARM.target_days} days (free tier pauses after ${KEEP_WARM.pause_days} idle)`
                      : `not armed — inactive workspaces are not probed`,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 py-1.5"
                  >
                    <span
                      style={{ color: 'var(--text-secondary)' }}
                      className="font-mono text-[10px] font-bold uppercase"
                    >
                      {label}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-right font-mono">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {kitError ? (
                <p className="badge-error rounded-lg px-3 py-2 text-[11px] leading-relaxed">
                  {kitError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="console-well space-y-2.5 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <ClipboardList
                style={{ color: 'var(--brand-text)' }}
                className="h-4 w-4"
              />
              <span className="text-xs font-bold">Handoff checklist</span>
            </div>
            {HANDOFF_ITEMS.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-2.5 text-xs"
              >
                <input
                  type="checkbox"
                  checked={Boolean(checked[item.id])}
                  onChange={(e) =>
                    setChecked((prev) => ({
                      ...prev,
                      [item.id]: e.target.checked,
                    }))
                  }
                  className="mt-0.5 rounded"
                />
                <span
                  style={{ color: 'var(--text-secondary)' }}
                  className="text-[11px] leading-relaxed"
                >
                  {item.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* Footer verbs */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {step > 1 && step < LAST_STEP ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="console-btn-secondary rounded-xl px-4 py-2.5 text-xs font-semibold"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {step < CREATE_STEP ? (
          <button
            type="button"
            onClick={goNext}
            className="console-btn-primary rounded-xl px-5 py-2.5 text-xs font-semibold"
          >
            Continue
          </button>
        ) : null}
        {step === LAST_STEP ? (
          <button
            type="button"
            onClick={onClose}
            className="console-btn-primary rounded-xl px-5 py-2.5 text-xs font-semibold"
          >
            Done
          </button>
        ) : null}
        {step === CREATE_STEP ? <span /> : null}
      </div>
    </div>
  );
}
