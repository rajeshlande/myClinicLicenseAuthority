import React, { useMemo, useState } from 'react';
import {
  Check,
  ClipboardList,
  Globe,
  Loader2,
  Mail,
  Minus,
  Plus,
} from 'lucide-react';
import RichNotesField from '../RichNotesField.jsx';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  defaultExpirationDate,
  validateProvisionInput,
} from '../../lib/entitlements.mjs';
import { buildInvoiceDraft, termMonths } from '../../lib/invoices.mjs';
import { rememberError } from '../../lib/errors.mjs';

const STEPS = [
  { id: 1, label: 'Identity' },
  { id: 2, label: 'Plan' },
  { id: 3, label: 'Term' },
  { id: 4, label: 'Review' },
  { id: 5, label: 'Handoff' },
];

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
];

/**
 * End-to-end clinic onboarding (Enrolliq slice 6): identity pinning -> plan &
 * seats -> term & notes -> review & create (provisioning RPC, unchanged wire
 * shape) -> first invoice draft (schema v4) -> handoff checklist.
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
    if (target >= 4 && months < 1) {
      setStepError('Subscription end date must be in the future.');
      return false;
    }
    setStepError('');
    return true;
  };

  const goNext = () => {
    if (!validateStep(step + 1)) return;
    setStep((s) => Math.min(5, s + 1));
  };

  const createSubscription = async () => {
    if (!validateStep(4)) return;
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
        const invRes = await supabase.from('invoices').insert(draft);
        if (invRes.error) throw invRes.error;
        invoice = draft;
      } catch (invErr) {
        setInvoiceWarning(
          `Subscription created, but the first invoice draft could not be stored (${invErr.message ?? invErr}). Central needs schema v4.`,
        );
      }

      setCreatedRow(row);
      setCreatedInvoice(invoice);
      onProvisioned(row, {
        tier,
        seats: maxMachines,
        invoice: invoice?.invoice_number ?? null,
        label:
          row.customer_email || row.allowed_origin || 'clinic',
      });
      setStep(5);
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

      {/* Step 2 — Plan & seats */}
      {step === 2 ? (
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

      {/* Step 3 — Term & notes */}
      {step === 3 ? (
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

      {/* Step 4 — Review & create */}
      {step === 4 ? (
        <div className="space-y-4">
          <div className="console-well divide-y divide-[var(--border-subtle)] rounded-xl text-xs">
            {[
              ['Identity', customerEmail || allowedOrigin || '—', customerEmail && allowedOrigin ? allowedOrigin : ''],
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

      {/* Step 5 — Handoff checklist */}
      {step === 5 && createdRow ? (
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
        {step > 1 && step < 5 ? (
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
        {step < 4 ? (
          <button
            type="button"
            onClick={goNext}
            className="console-btn-primary rounded-xl px-5 py-2.5 text-xs font-semibold"
          >
            Continue
          </button>
        ) : null}
        {step === 5 ? (
          <button
            type="button"
            onClick={onClose}
            className="console-btn-primary rounded-xl px-5 py-2.5 text-xs font-semibold"
          >
            Done
          </button>
        ) : null}
        {step === 4 ? <span /> : null}
      </div>
    </div>
  );
}
