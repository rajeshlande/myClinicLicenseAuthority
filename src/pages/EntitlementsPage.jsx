import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Calendar,
  Check,
  Clock,
  Container,
  Copy,
  Cpu,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Minus,
  Plus,
  Power,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import RichNotesField from '../components/RichNotesField.jsx';
import RichNotesView from '../components/RichNotesView.jsx';
import SlideOverDrawer from '../components/SlideOverDrawer.jsx';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  TIER_CATALOG,
  computeFleetMetrics,
  computeStanding,
  defaultExpirationDate,
  formatDisplayDate,
  getTierMeta,
  sanitizeCsvCell,
  validateProvisionInput,
} from '../lib/entitlements.mjs';

function formatCompactKey(rawKey = '') {
  const clean = String(rawKey).trim().toUpperCase();
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

function buildStandingPillStyle(standing) {
  if (standing.isOperational) {
    return {
      bg: 'var(--accent-soft)',
      border: 'var(--accent-border)',
      text: 'var(--accent-primary)',
      dot: 'bg-emerald-400',
    };
  }
  if (standing.stateCode === 'KEY_KILLED') {
    return {
      bg: 'var(--danger-soft)',
      border: 'rgba(244, 63, 94, 0.35)',
      text: 'var(--danger-text)',
      dot: 'bg-rose-400',
    };
  }
  return {
    bg: 'var(--warn-soft)',
    border: 'rgba(245, 158, 11, 0.35)',
    text: 'var(--warn-text)',
    dot: 'bg-amber-400',
  };
}

export default function EntitlementsPage({
  backend,
  issueDrawerSignal = 0,
  onSelectLicenseForKit,
}) {
  const supabase = backend.supabase;

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');
  const [toast, setToast] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');

  const [copiedKeyId, setCopiedKeyId] = useState(null);
  const [togglingIds, setTogglingIds] = useState({});

  // Slide-over drawers
  const [issueOpen, setIssueOpen] = useState(false);
  const [inspectedLicenseId, setInspectedLicenseId] = useState(null);
  const [boundMachines, setBoundMachines] = useState([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [renewDateInput, setRenewDateInput] = useState('');
  const [savingTerm, setSavingTerm] = useState(false);

  // Provision form state
  const [customerEmail, setCustomerEmail] = useState('');
  const [tier, setTier] = useState('growth');
  const [maxMachines, setMaxMachines] = useState(2);
  const [expiresDate, setExpiresDate] = useState(() => defaultExpirationDate(365));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (issueDrawerSignal > 0) {
      setIssueOpen(true);
    }
  }, [issueDrawerSignal]);

  const fetchEntitlements = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRefreshing(true);
      setErrorBanner('');

      try {
        const { data, error } = await supabase
          .from('admin_license_view')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setRecords(Array.isArray(data) ? data : []);
      } catch (err) {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : 'Failed to load entitlements from admin_license_view.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void fetchEntitlements();
  }, [fetchEntitlements]);

  const inspectedRow = useMemo(
    () => records.find((r) => r.license_id === inspectedLicenseId) ?? null,
    [records, inspectedLicenseId],
  );

  const openInspector = async (row) => {
    setInspectedLicenseId(row.license_id);
    setRenewDateInput(
      row.expires_at ? String(row.expires_at).slice(0, 10) : defaultExpirationDate(365),
    );
    setLoadingMachines(true);
    try {
      const { data, error } = await supabase
        .from('activated_machines')
        .select('*')
        .eq('license_id', row.license_id);
      if (error) throw error;
      setBoundMachines(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to fetch bound machines.',
        'error',
      );
    } finally {
      setLoadingMachines(false);
    }
  };

  const handleReleaseNode = async (machineId) => {
    try {
      const { error } = await supabase.rpc('revoke_machine_node', {
        p_machine_id: machineId,
      });
      if (error) throw error;
      setBoundMachines((prev) => prev.filter((m) => m.id !== machineId));
      await fetchEntitlements({ silent: true });
      showToast('Released hardware/origin node seat.');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to release hardware seat.',
        'error',
      );
    }
  };

  const handleExtendTerm = async (nextDateStr) => {
    if (!inspectedRow || !nextDateStr) return;
    setSavingTerm(true);
    try {
      const isoEnd = new Date(`${nextDateStr}T23:59:59.000Z`).toISOString();
      const { error } = await supabase
        .from('subscriptions')
        .update({ expires_at: isoEnd, status: 'active' })
        .eq('id', inspectedRow.subscription_id);
      if (error) throw error;

      setRenewDateInput(nextDateStr);
      await fetchEntitlements({ silent: true });
      showToast(`Extended subscription term to ${nextDateStr}.`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to update expiration date.',
        'error',
      );
    } finally {
      setSavingTerm(false);
    }
  };

  const handleProvisionSubmit = async (event) => {
    event.preventDefault();
    const validation = validateProvisionInput({
      customerEmail,
      tier,
      maxMachines,
      expiresDate,
      notes,
    });

    if (!validation.ok) {
      showToast(validation.error, 'error');
      return;
    }

    setSubmitting(true);
    setErrorBanner('');

    try {
      const { data: rpcRecord, error: rpcError } = await supabase.rpc(
        'create_subscription_with_license',
        validation.payload,
      );

      if (rpcError) throw rpcError;

      if (rpcRecord) {
        const insertedRow = Array.isArray(rpcRecord) ? rpcRecord[0] : rpcRecord;
        setRecords((prev) => [insertedRow, ...prev]);
      } else {
        await fetchEntitlements({ silent: true });
      }

      setCustomerEmail('');
      setMaxMachines(2);
      setExpiresDate(defaultExpirationDate(365));
      setNotes('');
      setIssueOpen(false);
      showToast(
        `Issued ${validation.payload.p_tier.toUpperCase()} key for ${validation.payload.p_customer_email}.`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to provision subscription.';
      setErrorBanner(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleKillSwitch = async (row) => {
    const nextActiveState = !row.is_active;
    setTogglingIds((prev) => ({ ...prev, [row.license_id]: true }));

    try {
      const { error } = await supabase
        .from('licenses')
        .update({ is_active: nextActiveState })
        .eq('id', row.license_id);

      if (error) throw error;

      setRecords((prev) =>
        prev.map((item) =>
          item.license_id === row.license_id
            ? { ...item, is_active: nextActiveState }
            : item,
        ),
      );

      showToast(
        nextActiveState
          ? `Restored license key for ${row.customer_email}.`
          : `Kill-switch engaged: revoked ${row.customer_email} key.`,
        nextActiveState ? 'success' : 'warn',
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to toggle license status.',
        'error',
      );
    } finally {
      setTogglingIds((prev) => ({ ...prev, [row.license_id]: false }));
    }
  };

  const handleCopyLicenseKey = async (licenseId, licenseKey) => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopiedKeyId(licenseId);
      setTimeout(() => {
        setCopiedKeyId((current) => (current === licenseId ? null : current));
      }, 1800);
    } catch {
      showToast('Clipboard permission unavailable.', 'error');
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'customer_email',
      'license_key',
      'tier',
      'standing',
      'registered_machines',
      'max_machines',
      'expires_at',
    ];
    const csvLines = [
      headers.join(','),
      ...filteredRecords.map((row) => {
        const standing = computeStanding(row);
        return [
          row.customer_email,
          row.license_key,
          row.tier,
          standing.label,
          row.registered_machines,
          row.max_machines,
          row.expires_at,
        ]
          .map(sanitizeCsvCell)
          .join(',');
      }),
    ];
    const blob = new Blob([csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `myclinic-entitlements-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    showToast(`Exported ${filteredRecords.length} license records to CSV.`);
  };

  const metrics = useMemo(() => computeFleetMetrics(records), [records]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((row) => {
      const standing = computeStanding(row);
      if (statusFilter === 'active' && !standing.isOperational) return false;
      if (statusFilter === 'revoked' && standing.isOperational) return false;
      if (
        statusFilter === 'expiring' &&
        !(
          standing.isOperational &&
          standing.daysLeft !== null &&
          standing.daysLeft <= 14
        )
      ) {
        return false;
      }

      if (tierFilter !== 'all') {
        const mappedPlan =
          (MYCLINIC_TIER_ENTITLEMENTS[row.tier] ?? MYCLINIC_TIER_ENTITLEMENTS.standard)
            .plan;
        if (mappedPlan !== tierFilter) return false;
      }

      if (!q) return true;
      return (
        String(row.customer_email ?? '').toLowerCase().includes(q) ||
        String(row.license_key ?? '').toLowerCase().includes(q) ||
        String(row.tier ?? '').toLowerCase().includes(q) ||
        String(row.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, searchQuery, statusFilter, tierFilter]);

  const openDeploymentKit = (row) => {
    onSelectLicenseForKit?.(row);
    window.location.hash = '#/node-agent';
  };

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {toast ? (
        <div
          role="status"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
          className="fixed right-5 bottom-5 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium shadow-2xl"
        >
          {toast.tone === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          ) : toast.tone === 'warn' ? (
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <span>{toast.message}</span>
        </div>
      ) : null}

      {errorBanner ? (
        <div
          style={{
            backgroundColor: 'var(--danger-soft)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            color: 'var(--danger-text)',
          }}
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      ) : null}

      {/* 1. Precision 4-Card KPI Telemetry Strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          className="console-panel rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10.5px] font-semibold tracking-wider uppercase"
            >
              Operational Keys
            </span>
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-semibold tracking-tight">
              {metrics.activeCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="tabular-nums font-mono text-xs"
            >
              / {metrics.total} issued
            </span>
          </div>
          <div
            style={{ backgroundColor: 'var(--bg-well)' }}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${
                  metrics.total > 0
                    ? Math.round((metrics.activeCount / metrics.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </button>

        <div className="console-panel rounded-xl p-4 text-left">
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10.5px] font-semibold tracking-wider uppercase"
            >
              Hardware Seat Locks
            </span>
            <Cpu className="h-4 w-4 shrink-0 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-semibold tracking-tight">
              {metrics.totalRegisteredNodes}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="tabular-nums font-mono text-xs"
            >
              / {metrics.totalCapacityNodes} seats
            </span>
          </div>
          <div
            style={{ backgroundColor: 'var(--bg-well)' }}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="h-full rounded-full bg-sky-400 transition-all"
              style={{
                width: `${
                  metrics.totalCapacityNodes > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (metrics.totalRegisteredNodes /
                            metrics.totalCapacityNodes) *
                            100,
                        ),
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter('expiring')}
          className="console-panel rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10.5px] font-semibold tracking-wider uppercase"
            >
              Renewals ≤ 14 Days
            </span>
            <Clock className="h-4 w-4 shrink-0 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-semibold tracking-tight">
              {metrics.expiringSoonCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-xs"
            >
              due soon
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('revoked')}
          className="console-panel rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10.5px] font-semibold tracking-wider uppercase"
            >
              Blocked / Expired
            </span>
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-semibold tracking-tight">
              {metrics.revokedOrExpiredCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-xs"
            >
              blocked
            </span>
          </div>
        </button>
      </div>

      {/* 2. Full-Width Enterprise Registry Panel */}
      <section className="console-panel overflow-hidden rounded-2xl">
        {/* Clean Two-Row Command Header (Zero Awkward Wrapping) */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="space-y-3 p-4"
        >
          {/* Row A: Segmented Standing Tabs + Primary Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div
              style={{
                backgroundColor: 'var(--bg-well)',
                border: '1px solid var(--border-subtle)',
              }}
              className="inline-flex flex-wrap items-center rounded-lg p-0.5 text-xs"
            >
              {[
                { id: 'all', label: `All (${metrics.total})` },
                { id: 'active', label: `Active (${metrics.activeCount})` },
                { id: 'expiring', label: `Expiring (${metrics.expiringSoonCount})` },
                {
                  id: 'revoked',
                  label: `Blocked (${metrics.revokedOrExpiredCount})`,
                },
              ].map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-strong)',
                          }
                        : {
                            color: 'var(--text-secondary)',
                            border: '1px solid transparent',
                          }
                    }
                    className="rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition"
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>

              <button
                type="button"
                onClick={() => fetchEntitlements()}
                disabled={refreshing}
                className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                Refresh
              </button>

              <button
                type="button"
                onClick={() => setIssueOpen(true)}
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                Issue License
              </button>
            </div>
          </div>

          {/* Row B: Full-Flex Search + Plan Tier Filter */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                style={{ color: 'var(--text-muted)' }}
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clinic email, 32-char hex license key, tier, PO/UTR reference..."
                className="console-input w-full rounded-lg py-1.5 pr-8 pl-8 text-xs"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  style={{ color: 'var(--text-muted)' }}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              <SlidersHorizontal
                style={{ color: 'var(--text-muted)' }}
                className="h-3.5 w-3.5 shrink-0"
              />
              <select
                aria-label="Filter by myClinic plan"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="console-input w-full rounded-lg px-2.5 py-1.5 font-mono text-xs sm:w-48"
              >
                <option value="all">All myClinic Plans</option>
                <option value="solo">Solo Plan (1 Doc)</option>
                <option value="growth">Growth Plan (5 Docs)</option>
                <option value="chain">Chain Plan (Unlimited)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Zero-Clipping 5-Column Registry Table */}
        {loading ? (
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="flex items-center justify-center py-20 text-xs"
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
            Querying admin_license_view...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <KeyRound
              style={{ color: 'var(--text-muted)' }}
              className="mx-auto h-8 w-8 opacity-60"
            />
            <p
              style={{ color: 'var(--text-primary)' }}
              className="mt-3 text-sm font-medium"
            >
              No matching license records
            </p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">
              Adjust your search filters or issue a new cryptographic subscription key.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTierFilter('all');
              }}
              className="console-btn-secondary mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            {/* Compact / Split-Pane Structured Security Rows (< 1280px — Zero Horizontal Clipping) */}
            <div className="xl:hidden">
              {filteredRecords.map((row) => {
                const standing = computeStanding(row);
                const pill = buildStandingPillStyle(standing);
                const seatSpec =
                  MYCLINIC_TIER_ENTITLEMENTS[row.tier] ??
                  MYCLINIC_TIER_ENTITLEMENTS.standard;
                const isToggling = Boolean(togglingIds[row.license_id]);
                const isCopied = copiedKeyId === row.license_id;

                return (
                  <div
                    key={row.license_id}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    className="console-row-hover space-y-2.5 p-4 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          style={{
                            backgroundColor: pill.bg,
                            border: `1px solid ${pill.border}`,
                            color: pill.text,
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                          {standing.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => openInspector(row)}
                          style={{ color: 'var(--text-primary)' }}
                          className="truncate text-left text-xs font-semibold hover:underline"
                        >
                          {row.customer_email}
                        </button>
                        <span
                          style={{
                            backgroundColor: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                          }}
                          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
                        >
                          {seatSpec.plan}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openInspector(row)}
                          className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px]"
                        >
                          <Cpu className="h-3 w-3 text-sky-400" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeploymentKit(row)}
                          className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px]"
                        >
                          <Container className="h-3 w-3" />
                          Kit
                        </button>
                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => handleToggleKillSwitch(row)}
                          style={
                            row.is_active
                              ? {
                                  backgroundColor: 'var(--danger-soft)',
                                  border: '1px solid rgba(244, 63, 94, 0.32)',
                                  color: 'var(--danger-text)',
                                }
                              : {
                                  backgroundColor: 'var(--accent-soft)',
                                  border: '1px solid var(--accent-border)',
                                  color: 'var(--accent-primary)',
                                }
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] font-semibold transition hover:opacity-90 disabled:opacity-50"
                        >
                          <Power className="h-3 w-3" />
                          {row.is_active ? 'Kill' : 'Enable'}
                        </button>
                      </div>
                    </div>

                    <div
                      style={{ color: 'var(--text-secondary)' }}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]"
                    >
                      <span className="inline-flex items-center gap-1">
                        <code
                          style={{
                            backgroundColor: 'var(--bg-well)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                          }}
                          className="rounded px-1.5 py-0.5 text-[10.5px]"
                          title={row.license_key}
                        >
                          {formatCompactKey(row.license_key)}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyLicenseKey(row.license_id, row.license_key)
                          }
                          title={`Copy ${row.license_key}`}
                          className="console-btn-secondary inline-flex h-5 w-5 items-center justify-center rounded"
                        >
                          {isCopied ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </span>

                      <span className="tabular-nums">
                        {row.registered_machines}/{row.max_machines} nodes
                      </span>

                      <span style={{ color: 'var(--text-muted)' }}>
                        {seatSpec.doctors === null
                          ? '∞ doc · ∞ br'
                          : `${seatSpec.doctors} doc · ${seatSpec.frontdesk} desk`}
                      </span>

                      <span
                        style={{
                          color:
                            standing.daysLeft !== null && standing.daysLeft <= 14
                              ? 'var(--warn-text)'
                              : 'var(--text-muted)',
                        }}
                        className="tabular-nums"
                      >
                        Exp {formatDisplayDate(row.expires_at)}
                        {standing.daysLeft !== null
                          ? standing.daysLeft < 0
                            ? ` (${Math.abs(standing.daysLeft)}d overdue)`
                            : ` (${standing.daysLeft}d)`
                          : ''}
                      </span>
                    </div>

                    {row.notes ? <RichNotesView notes={row.notes} compact /> : null}
                  </div>
                );
              })}
            </div>

            {/* Wide Desktop 5-Column Registry Table (>= 1280px) */}
            <div className="hidden overflow-x-auto xl:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--bg-well)',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                  }}
                  className="font-mono text-[10px] tracking-wider uppercase"
                >
                  <th className="px-4 py-2.5 font-semibold">Clinic &amp; Standing</th>
                  <th className="px-3 py-2.5 font-semibold">License Key</th>
                  <th className="px-3 py-2.5 font-semibold">Plan &amp; Seats</th>
                  <th className="px-3 py-2.5 font-semibold">Locks &amp; Expiry</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((row) => {
                  const standing = computeStanding(row);
                  const pill = buildStandingPillStyle(standing);
                  const seatSpec =
                    MYCLINIC_TIER_ENTITLEMENTS[row.tier] ??
                    MYCLINIC_TIER_ENTITLEMENTS.standard;
                  const isToggling = Boolean(togglingIds[row.license_id]);
                  const isCopied = copiedKeyId === row.license_id;

                  return (
                    <tr
                      key={row.license_id}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      className="console-row-hover align-top transition-colors"
                    >
                      {/* Col 1: Clinic + Standing Pill + Compact Notes */}
                      <td className="min-w-[200px] px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            style={{
                              backgroundColor: pill.bg,
                              border: `1px solid ${pill.border}`,
                              color: pill.text,
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                            {standing.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => openInspector(row)}
                            style={{ color: 'var(--text-primary)' }}
                            className="truncate text-left font-medium hover:underline"
                          >
                            {row.customer_email}
                          </button>
                        </div>
                        {row.notes ? (
                          <div className="max-w-md">
                            <RichNotesView notes={row.notes} compact />
                          </div>
                        ) : null}
                      </td>

                      {/* Col 2: Compact License Key + Copy */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <code
                            style={{
                              backgroundColor: 'var(--bg-well)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                            }}
                            className="rounded-md px-2 py-1 font-mono text-[11px]"
                            title={row.license_key}
                          >
                            {formatCompactKey(row.license_key)}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyLicenseKey(row.license_id, row.license_key)
                            }
                            title={`Copy ${row.license_key}`}
                            className="console-btn-secondary inline-flex h-6 w-6 items-center justify-center rounded-md"
                          >
                            {isCopied ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Col 3: Plan Badge & Seats */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <span
                          style={{
                            backgroundColor: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                          }}
                          className="inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
                        >
                          {seatSpec.plan}
                        </span>
                        <div
                          style={{ color: 'var(--text-muted)' }}
                          className="mt-1 font-mono text-[10px]"
                        >
                          {seatSpec.doctors === null
                            ? '∞ doc · ∞ br'
                            : `${seatSpec.doctors} doc · ${seatSpec.frontdesk} desk`}
                        </div>
                      </td>

                      {/* Col 4: Seat Locks + Term Expiry */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openInspector(row)}
                          className="group block text-left"
                        >
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="tabular-nums font-semibold">
                              {row.registered_machines}/{row.max_machines} nodes
                            </span>
                            <div
                              style={{ backgroundColor: 'var(--bg-well)' }}
                              className="h-1.5 w-12 overflow-hidden rounded-full"
                            >
                              <div
                                className={`h-full rounded-full ${
                                  standing.usagePct >= 100
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400'
                                }`}
                                style={{
                                  width: `${Math.min(100, standing.usagePct)}%`,
                                }}
                              />
                            </div>
                          </div>
                          <div
                            style={{
                              color:
                                standing.daysLeft !== null && standing.daysLeft <= 14
                                  ? 'var(--warn-text)'
                                  : 'var(--text-muted)',
                            }}
                            className="mt-1 tabular-nums font-mono text-[10px]"
                          >
                            {formatDisplayDate(row.expires_at)}
                            {standing.daysLeft !== null
                              ? standing.daysLeft < 0
                                ? ` · ${Math.abs(standing.daysLeft)}d overdue`
                                : ` · ${standing.daysLeft}d`
                              : ''}
                          </div>
                        </button>
                      </td>

                      {/* Col 5: Controls */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openInspector(row)}
                            title="Inspect nodes & extend term"
                            className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px]"
                          >
                            <Cpu className="h-3 w-3 text-sky-400" />
                            Inspect
                          </button>

                          <button
                            type="button"
                            onClick={() => openDeploymentKit(row)}
                            title="Open Docker / GitHub Pages deployment kit"
                            className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px]"
                          >
                            <Container className="h-3 w-3" />
                            Kit
                          </button>

                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleToggleKillSwitch(row)}
                            style={
                              row.is_active
                                ? {
                                    backgroundColor: 'var(--danger-soft)',
                                    border: '1px solid rgba(244, 63, 94, 0.32)',
                                    color: 'var(--danger-text)',
                                  }
                                : {
                                    backgroundColor: 'var(--accent-soft)',
                                    border: '1px solid var(--accent-border)',
                                    color: 'var(--accent-primary)',
                                  }
                            }
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] font-semibold transition hover:opacity-90 disabled:opacity-50"
                          >
                            <Power className="h-3 w-3" />
                            {row.is_active ? 'Kill' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {/* Slide-Over Drawer 1: Provision New Subscription & License Key */}
      <SlideOverDrawer
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Provision Subscription & RS256 License"
        subtitle="Executes atomic create_subscription_with_license() RPC and mints a 32-char CSPRNG hex key."
      >
        <form id="provision-license-form" onSubmit={handleProvisionSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="prov-customer-email"
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              Clinic Owner / Billing Email
            </label>
            <input
              id="prov-customer-email"
              type="email"
              required
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="owner@cityclinic.in"
              className="console-input mt-1.5 w-full rounded-lg px-3 py-2 text-xs"
            />
          </div>

          {/* Visual 3-Card Plan Picker */}
          <div>
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              myClinic Plan Tier &amp; Seat Entitlements
            </span>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TIER_CATALOG.filter((t) =>
                ['solo', 'growth', 'chain'].includes(t.value),
              ).map((item) => {
                const selected = tier === item.value;
                const seats = MYCLINIC_TIER_ENTITLEMENTS[item.value];
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setTier(item.value)}
                    style={
                      selected
                        ? {
                            backgroundColor: 'var(--accent-soft)',
                            border: '1px solid var(--accent-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-well)',
                            border: '1px solid var(--border-subtle)',
                          }
                    }
                    className="rounded-xl p-3 text-left transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold uppercase">
                        {item.value}
                      </span>
                      {selected ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : null}
                    </div>
                    <p
                      style={{ color: 'var(--text-muted)' }}
                      className="mt-1.5 font-mono text-[10px] leading-relaxed"
                    >
                      {seats.doctors === null
                        ? 'Unlimited doctors & branches'
                        : `${seats.doctors} Doctor · ${seats.frontdesk} Desk · ${seats.branches} Branch`}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Max Hardware / Origin Nodes + Expiration */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Max Bound Nodes / Origins
              </label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMaxMachines((n) => Math.max(1, Number(n) - 1))}
                  className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={maxMachines}
                  onChange={(e) =>
                    setMaxMachines(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="console-input w-full rounded-lg px-3 py-1.5 text-center font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setMaxMachines((n) => Math.min(500, Number(n) + 1))}
                  className="console-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="prov-expires-date"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Paid Term End Date
              </label>
              <input
                id="prov-expires-date"
                type="date"
                required
                value={expiresDate}
                onChange={(e) => setExpiresDate(e.target.value)}
                className="console-input mt-1.5 w-full rounded-lg px-3 py-1.5 font-mono text-xs"
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
                    className="console-btn-secondary rounded px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <RichNotesField value={notes} onChange={setNotes} />

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIssueOpen(false)}
              className="console-btn-secondary rounded-lg px-4 py-2 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="console-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              Provision License Key
            </button>
          </div>
        </form>
      </SlideOverDrawer>

      {/* Slide-Over Drawer 2: License Dossier & Hardware Lock Inspector */}
      <SlideOverDrawer
        open={Boolean(inspectedRow)}
        onClose={() => setInspectedLicenseId(null)}
        title={inspectedRow ? inspectedRow.customer_email : 'License Inspector'}
        subtitle={
          inspectedRow
            ? `Subscription ${String(inspectedRow.subscription_id).slice(0, 8)} · ${getTierMeta(inspectedRow.tier).label}`
            : ''
        }
        widthClass="max-w-2xl"
      >
        {inspectedRow ? (
          <div className="space-y-6">
            {/* Key & Deployment Kit Card */}
            <div className="console-well rounded-xl p-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  style={{ color: 'var(--text-muted)' }}
                  className="font-mono text-[10px] font-semibold tracking-wider uppercase"
                >
                  32-Character CSPRNG License Key
                </span>
                <button
                  type="button"
                  onClick={() => openDeploymentKit(inspectedRow)}
                  style={{ color: 'var(--accent-primary)' }}
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold hover:underline"
                >
                  Open in Deployment &amp; Pages Kit
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <code className="break-all font-mono text-xs font-semibold">
                  {inspectedRow.license_key}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyLicenseKey(
                      inspectedRow.license_id,
                      inspectedRow.license_key,
                    )
                  }
                  className="console-btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px]"
                >
                  {copiedKeyId === inspectedRow.license_id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy Key
                    </>
                  )}
                </button>
              </div>

              {inspectedRow.notes ? (
                <div className="mt-3">
                  <RichNotesView notes={inspectedRow.notes} />
                </div>
              ) : null}
            </div>

            {/* Remote Kill-Switch & Term Extension */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="console-elevated rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Remote Kill-Switch</span>
                  <Power
                    className={`h-4 w-4 ${
                      inspectedRow.is_active ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="mt-1 text-[11px] leading-relaxed"
                >
                  {inspectedRow.is_active
                    ? 'Key is active. Clinic nodes can refresh 7-day RS256 capability tokens.'
                    : 'Kill-switch engaged. Edge validator returns HTTP 403 on renewal.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleToggleKillSwitch(inspectedRow)}
                  disabled={Boolean(togglingIds[inspectedRow.license_id])}
                  className="console-btn-secondary mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-semibold"
                >
                  <Power className="h-3.5 w-3.5" />
                  {inspectedRow.is_active ? 'Engage Kill-Switch' : 'Restore License Key'}
                </button>
              </div>

              <div className="console-elevated rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Extend Paid Term</span>
                  <Calendar className="h-4 w-4 text-sky-400" />
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="date"
                    value={renewDateInput}
                    onChange={(e) => setRenewDateInput(e.target.value)}
                    className="console-input w-full rounded-lg px-2.5 py-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(renewDateInput)}
                    className="console-btn-primary shrink-0 rounded-lg px-3 py-1.5 text-xs"
                  >
                    Save
                  </button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(defaultExpirationDate(30))}
                    className="console-btn-secondary rounded px-2 py-0.5 font-mono text-[10px]"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(defaultExpirationDate(365))}
                    className="console-btn-secondary rounded px-2 py-0.5 font-mono text-[10px]"
                  >
                    +1 Year
                  </button>
                </div>
              </div>
            </div>

            {/* Bound Hardware & GitHub Pages Origin Seats */}
            <div>
              <h3 className="text-xs font-semibold">
                Bound Hardware &amp; Web Origin Locks ({boundMachines.length} /{' '}
                {inspectedRow.max_machines})
              </h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px]">
                Release a seat when a clinic migrates servers or changes its GitHub Pages domain.
              </p>

              <div className="mt-3 space-y-2">
                {loadingMachines ? (
                  <div
                    style={{ color: 'var(--text-secondary)' }}
                    className="flex items-center gap-2 py-6 text-xs"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    Loading bound fingerprints...
                  </div>
                ) : boundMachines.length === 0 ? (
                  <div className="console-well rounded-xl p-5 text-center">
                    <Server
                      style={{ color: 'var(--text-muted)' }}
                      className="mx-auto h-5 w-5 opacity-60"
                    />
                    <p
                      style={{ color: 'var(--text-secondary)' }}
                      className="mt-1.5 text-xs"
                    >
                      No clinic containers or GitHub Pages origins have phoned home yet.
                    </p>
                  </div>
                ) : (
                  boundMachines.map((machine) => {
                    const isWebOrigin = String(
                      machine.machine_fingerprint ?? '',
                    ).startsWith('web:');
                    return (
                      <div
                        key={machine.id}
                        className="console-well flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {isWebOrigin ? (
                              <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            ) : (
                              <Cpu className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                            )}
                            <code className="truncate font-mono text-xs font-medium">
                              {machine.machine_fingerprint}
                            </code>
                          </div>
                          <div
                            style={{ color: 'var(--text-muted)' }}
                            className="mt-1 font-mono text-[10px]"
                          >
                            Activated {formatDisplayDate(machine.activated_at)} · Last
                            heartbeat {formatDisplayDate(machine.last_heartbeat)}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleReleaseNode(machine.id)}
                          style={{
                            backgroundColor: 'var(--danger-soft)',
                            border: '1px solid rgba(244, 63, 94, 0.3)',
                            color: 'var(--danger-text)',
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold hover:opacity-90"
                        >
                          <Trash2 className="h-3 w-3" />
                          Release Seat
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SlideOverDrawer>
    </div>
  );
}
