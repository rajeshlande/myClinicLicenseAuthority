import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Send,
} from 'lucide-react';
import { logClinicActivity } from '../lib/activity.mjs';
import { buildInvoicePdfBytes } from '../lib/invoice-pdf.mjs';
import { rememberError } from '../lib/errors.mjs';

const STATUS_META = {
  draft: { label: 'Draft', badge: 'badge-info' },
  issued: { label: 'Issued', badge: 'badge-warning' },
  paid: { label: 'Paid', badge: 'badge-success' },
  void: { label: 'Void', badge: 'badge-error' },
};

const inr = (n) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDate = (iso) => (iso ? String(iso).slice(0, 10) : '—');

/**
 * Invoices (Enrolliq slice 7): billing documents from schema v4 with the
 * three lifecycle verbs (issue / mark paid / void — each appended to the
 * activity log) and a zero-dependency PDF download.
 */
export default function InvoicesPage({ backend, operatorEmail = '' }) {
  const supabase = backend.supabase;
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [errorBanner, setErrorBanner] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setRefreshing(true);
      try {
        const [inv, subs] = await Promise.all([
          supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(200),
          supabase.from('subscriptions').select('id, customer_email, allowed_origin'),
        ]);
        if (inv.error) throw inv.error;
        const map = {};
        for (const sub of subs.data ?? []) {
          map[sub.id] = {
            label: sub.customer_email || sub.allowed_origin || sub.id.slice(0, 8),
            email: sub.customer_email,
            origin: sub.allowed_origin,
          };
        }
        setClinics(map);
        setRows(inv.data ?? []);
        setErrorBanner(null);
      } catch (err) {
        const explained = rememberError(err, 'Load invoices');
        setErrorBanner(explained);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const logEvent = useCallback(
    async (row, eventKind, payload) => {
      const { error } = await logClinicActivity(supabase, {
        subscriptionId: row.subscription_id,
        licenseId: row.license_id ?? null,
        eventKind,
        actor: operatorEmail,
        payload,
      });
      if (error) {
        showToast('Done — but the activity log could not be written (Central needs schema v4).', 'warn');
      }
    },
    [supabase, operatorEmail, showToast],
  );

  const transition = useCallback(
    async (row, next, eventKind) => {
      setBusyId(row.id);
      try {
        const stamp = new Date().toISOString();
        const patch =
          next === 'paid'
            ? { status: 'paid', paid_at: stamp }
            : next === 'void'
              ? { status: 'void' }
              : { status: 'issued', issued_at: stamp };
        const { error } = await supabase
          .from('invoices')
          .update(patch)
          .eq('id', row.id);
        if (error) throw error;
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
        await logEvent(row, eventKind, {
          invoice: row.invoice_number,
          from: row.status,
          to: next,
        });
        showToast(
          next === 'paid'
            ? `${row.invoice_number} marked paid.`
            : next === 'void'
              ? `${row.invoice_number} voided.`
              : `${row.invoice_number} issued.`,
          next === 'void' ? 'warn' : 'success',
        );
      } catch (err) {
        const explained = rememberError(err, 'Invoice lifecycle');
        showToast(explained.message ?? String(explained), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [supabase, logEvent, showToast],
  );

  const downloadPdf = useCallback(
    (row) => {
      try {
        const bytes = buildInvoicePdfBytes(row, clinics[row.subscription_id] ?? {});
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${row.invoice_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast(`${row.invoice_number}.pdf downloaded.`);
      } catch (err) {
        showToast(`PDF failed: ${err.message ?? err}`, 'error');
      }
    },
    [clinics, showToast],
  );

  return (
    <div className="space-y-4">
      {toast ? (
        <div
          className={`${
            toast.tone === 'error'
              ? 'badge-error'
              : toast.tone === 'warn'
                ? 'badge-warning'
                : 'badge-success'
          } fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold lg:bottom-8`}
        >
          {toast.message}
        </div>
      ) : null}

      {errorBanner ? (
        <div className="badge-error rounded-2xl px-4 py-3 text-xs font-semibold">
          {errorBanner.message}
          <span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-normal">
            Invoices live in schema v4 — re-apply supabase/schema.sql to Central if this project predates it.
          </span>
        </div>
      ) : null}

      <section className="console-panel overflow-hidden rounded-2xl">
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex flex-wrap items-center justify-between gap-2.5 p-3.5 sm:p-4"
        >
          <div>
            <h2 className="text-sm font-bold tracking-tight">Invoices</h2>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-0.5 font-mono text-[10.5px]">
              Billing documents · GST-style tax line · zero-dependency PDF
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => load({ silent: true })}
            className="console-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-secondary)' }} className="py-16 text-center font-mono text-[11px]">
            Loading invoices...
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Banknote style={{ color: 'var(--brand-text)' }} className="mx-auto h-6 w-6" />
            <p className="mt-3 text-sm font-bold">No invoices yet</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mt-1 max-w-sm text-xs leading-relaxed">
              The onboarding wizard mints the first draft automatically; every
              draft can then be issued, paid, voided and downloaded as PDF.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {rows.map((row) => {
              const meta = STATUS_META[row.status] ?? STATUS_META.draft;
              const clinic = clinics[row.subscription_id];
              const open = expandedId === row.id;
              return (
                <li key={row.id}>
                  <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3 sm:px-4">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : row.id)}
                      aria-label={open ? 'Collapse invoice' : 'Expand invoice'}
                      className="console-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold">{row.invoice_number}</span>
                        <span className={`${meta.badge} inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase`}>
                          {meta.label}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }} className="mt-0.5 truncate font-mono text-[10.5px]">
                        {clinic?.label ?? row.subscription_id.slice(0, 8)} · due {shortDate(row.due_at)}
                        {row.paid_at ? ` · paid ${shortDate(row.paid_at)}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums">{inr(row.total)}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.status === 'draft' ? (
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void transition(row, 'issued', 'invoice_issued')}
                          className="console-btn-secondary inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                          Issue
                        </button>
                      ) : null}
                      {row.status === 'issued' ? (
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void transition(row, 'paid', 'invoice_paid')}
                          className="console-btn-secondary inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Mark paid
                        </button>
                      ) : null}
                      {row.status !== 'void' && row.status !== 'paid' ? (
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void transition(row, 'void', 'invoice_void')}
                          className="console-btn-danger inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" />
                          Void
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => downloadPdf(row)}
                        title="Download PDF"
                        aria-label={`Download ${row.invoice_number} as PDF`}
                        className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-xl"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="space-y-3 px-4 pb-4 sm:px-14">
                      <div className="console-well overflow-hidden rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr
                              style={{ backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-secondary)' }}
                              className="font-mono text-[10px] tracking-wider uppercase"
                            >
                              <th className="px-3 py-2 font-bold">Description</th>
                              <th className="px-3 py-2 text-right font-bold">Qty</th>
                              <th className="px-3 py-2 text-right font-bold">Unit</th>
                              <th className="px-3 py-2 text-right font-bold">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(row.line_items ?? []).map((li, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                <td className="px-3 py-2">{li.description}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{li.qty}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{inr(li.unit)}</td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums">{inr(li.qty * li.unit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="ml-auto w-full max-w-xs space-y-1 font-mono text-[11px]">
                        <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                          <span>Subtotal</span>
                          <span className="tabular-nums">{inr(row.subtotal)}</span>
                        </div>
                        <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                          <span>GST @ {(Number(row.tax_rate) * 100).toFixed(0)}%</span>
                          <span className="tabular-nums">{inr(row.tax_amount)}</span>
                        </div>
                        <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1 text-xs font-bold">
                          <span>Total</span>
                          <span className="tabular-nums">{inr(row.total)}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
