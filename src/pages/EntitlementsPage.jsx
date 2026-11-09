import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Building2,
  Calendar,
  Check,
  Clock,
  Copy,
  Cpu,
  Download,
  Globe,
  Loader2,
  Mail,
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
import ErrorAlert from '../components/ErrorAlert.jsx';
import RichNotesField from '../components/RichNotesField.jsx';
import RichNotesView from '../components/RichNotesView.jsx';
import SlideOverDrawer from '../components/SlideOverDrawer.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  TIER_CATALOG,
  computeFleetMetrics,
  computeStanding,
  defaultExpirationDate,
  describeClinicIdentity,
  formatDisplayDate,
  sanitizeCsvCell,
  validateProvisionInput,
  validateRoutingUpdateInput,
} from '../lib/entitlements.mjs';
import { errorLine, rememberError } from '../lib/errors.mjs';

function buildStandingPillStyle(standing) {
  if (standing.isOperational) {
    return {
      bg: 'var(--ok-soft)',
      border: 'var(--ok-border)',
      text: 'var(--ok-text)',
      dot: 'bg-emerald-500',
    };
  }
  if (standing.stateCode === 'KEY_KILLED') {
    return {
      bg: 'var(--danger-soft)',
      border: 'rgba(239, 68, 68, 0.35)',
      text: 'var(--danger-text)',
      dot: 'bg-rose-500',
    };
  }
  return {
    bg: 'var(--warn-soft)',
    border: 'rgba(245, 158, 11, 0.35)',
    text: 'var(--warn-text)',
    dot: 'bg-amber-500',
  };
}

export default function EntitlementsPage({
  backend,
  issueDrawerSignal = 0,
  onSelectLicenseForKit,
  onOpenGuide,
}) {
  const supabase = backend.supabase;

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [toast, setToast] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');

  const [copiedId, setCopiedId] = useState(null);
  const [togglingIds, setTogglingIds] = useState({});

  // Slide-over drawers
  const [issueOpen, setIssueOpen] = useState(false);
  const [inspectedLicenseId, setInspectedLicenseId] = useState(null);
  const [boundMachines, setBoundMachines] = useState([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [renewDateInput, setRenewDateInput] = useState('');
  const [savingTerm, setSavingTerm] = useState(false);
  const [editEmailInput, setEditEmailInput] = useState('');
  const [editOriginInput, setEditOriginInput] = useState('');
  const [editLockFirstOrigin, setEditLockFirstOrigin] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [savingTier, setSavingTier] = useState(false);

  // Provision form state (Email, Clinic URL, or BOTH)
  const [customerEmail, setCustomerEmail] = useState('');
  const [allowedOrigin, setAllowedOrigin] = useState('');
  const [lockFirstOrigin, setLockFirstOrigin] = useState(true);
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
    const timer = setTimeout(() => setToast(null), 3600);
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
      setErrorBanner(null);

      try {
        const { data, error } = await supabase
          .from('admin_license_view')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setRecords(Array.isArray(data) ? data : []);
      } catch (err) {
        setErrorBanner(rememberError(err, 'Load clinic subscriptions'));
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
    setEditEmailInput(row.customer_email ?? '');
    setEditOriginInput(row.allowed_origin ?? '');
    setEditLockFirstOrigin(Boolean(row.lock_first_origin));
    setLoadingMachines(true);
    try {
      const { data, error } = await supabase
        .from('activated_machines')
        .select('*')
        .eq('license_id', row.license_id);
      if (error) throw error;
      setBoundMachines(Array.isArray(data) ? data : []);
    } catch (err) {
      rememberError(err, 'Fetch bound deployments');
      showToast(
        errorLine(err, { context: 'Could not load bound deployments' }),
        'error',
      );
    } finally {
      setLoadingMachines(false);
    }
  };

  const handleSaveRouting = async () => {
    if (!inspectedRow) return;
    const check = validateRoutingUpdateInput({
      subscriptionId: inspectedRow.subscription_id,
      customerEmail: editEmailInput,
      allowedOrigin: editOriginInput,
      lockFirstOrigin: editLockFirstOrigin,
    });
    if (!check.ok) {
      showToast(check.error, 'error');
      return;
    }

    setSavingRouting(true);
    try {
      const { data, error } = await supabase.rpc(
        'update_subscription_routing',
        check.payload,
      );
      if (error) throw error;
      if (data) {
        const updated = Array.isArray(data) ? data[0] : data;
        setRecords((prev) =>
          prev.map((r) => (r.license_id === updated.license_id ? updated : r)),
        );
        setEditEmailInput(updated.customer_email ?? '');
        setEditOriginInput(updated.allowed_origin ?? '');
        setEditLockFirstOrigin(Boolean(updated.lock_first_origin));
      } else {
        await fetchEntitlements({ silent: true });
      }
      showToast('Saved clinic Email / URL auto-sync rules.');
    } catch (err) {
      rememberError(err, 'Update clinic routing');
      showToast(
        errorLine(err, { context: 'Could not update clinic email/URL' }),
        'error',
      );
    } finally {
      setSavingRouting(false);
    }
  };

  const handleUpdateTier = async (nextTier) => {
    if (!inspectedRow || !nextTier || inspectedRow.tier === nextTier) return;
    setSavingTier(true);
    try {
      const { error } = await supabase
        .from('subscriptions')
        .update({ tier: nextTier })
        .eq('id', inspectedRow.subscription_id);
      if (error) throw error;
      await fetchEntitlements({ silent: true });
      showToast(`Updated plan to ${nextTier.toUpperCase()} — auto-syncs on client.`);
    } catch (err) {
      rememberError(err, 'Change subscription tier');
      showToast(errorLine(err, { context: 'Could not change tier' }), 'error');
    } finally {
      setSavingTier(false);
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
      showToast('Released deployment seat.');
    } catch (err) {
      rememberError(err, 'Release machine node');
      showToast(
        errorLine(err, { context: 'Could not release deployment seat' }),
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
      showToast(`Extended paid term to ${nextDateStr}.`);
    } catch (err) {
      rememberError(err, 'Extend subscription term');
      showToast(
        errorLine(err, { context: 'Could not update expiration date' }),
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
      allowedOrigin,
      lockFirstOrigin,
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
    setErrorBanner(null);

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

      const targetLabel =
        validation.payload.p_customer_email ||
        validation.payload.p_allowed_origin ||
        'clinic';
      setCustomerEmail('');
      setAllowedOrigin('');
      setLockFirstOrigin(true);
      setMaxMachines(2);
      setExpiresDate(defaultExpirationDate(365));
      setNotes('');
      setIssueOpen(false);
      showToast(
        `Added ${validation.payload.p_tier.toUpperCase()} subscription for ${targetLabel}.`,
      );
    } catch (err) {
      const explained = rememberError(err, 'Add clinic subscription');
      setErrorBanner(explained);
      showToast(explained.message, 'error');
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
          ? 'Subscription resumed — clinic can auto-sync.'
          : 'Subscription paused — clinic enters read-only on next sync.',
        nextActiveState ? 'success' : 'warn',
      );
    } catch (err) {
      rememberError(err, 'Toggle pause switch');
      showToast(
        errorLine(err, { context: 'Could not update subscription state' }),
        'error',
      );
    } finally {
      setTogglingIds((prev) => ({ ...prev, [row.license_id]: false }));
    }
  };

  const handleCopyValue = async (id, text, label = 'Copied') => {
    const res = await copyTextToClipboard(text);
    if (!res.ok) {
      showToast(res.error, 'error');
      return;
    }
    setCopiedId(id);
    showToast(label);
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 1800);
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
        String(row.allowed_origin ?? '').toLowerCase().includes(q) ||
        String(row.license_key ?? '').toLowerCase().includes(q) ||
        String(row.tier ?? '').toLowerCase().includes(q) ||
        String(row.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, searchQuery, statusFilter, tierFilter]);

  const handleExportCsv = () => {
    if (filteredRecords.length === 0) return;
    const csvLines = [
      'customer_email,allowed_origin,match_mode,tier,status,registered_machines,max_machines,expires_at',
      ...filteredRecords.map((row) => {
        const standing = computeStanding(row);
        const identity = describeClinicIdentity(row);
        return [
          row.customer_email ?? '',
          row.allowed_origin ?? '',
          identity.mode,
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
    link.download = `myclinic-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    showToast(`Exported ${filteredRecords.length} clinic records.`);
  };

  const openClientSdk = (row) => {
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
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-float)',
          }}
          className="fixed right-4 bottom-20 z-50 flex max-w-[92vw] items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium lg:right-6 lg:bottom-6"
        >
          {toast.tone === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
          ) : toast.tone === 'warn' ? (
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          )}
          <span className="truncate">{toast.message}</span>
        </div>
      ) : null}

      {errorBanner ? (
        <ErrorAlert
          error={errorBanner}
          context="Subscription registry error"
          onRetry={() => fetchEntitlements()}
          onDismiss={() => setErrorBanner(null)}
        />
      ) : null}

      {/* 1. Cloudflare 4-Metric Zone Overview Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          className="console-panel relative overflow-hidden rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <span className="absolute inset-x-0 top-0 h-[2.5px] bg-emerald-500" />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10px] font-semibold tracking-wider uppercase"
            >
              Active Clinics
            </span>
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.activeCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="tabular-nums font-mono text-xs"
            >
              / {metrics.total}
            </span>
          </div>
        </button>

        <div className="console-panel relative overflow-hidden rounded-xl p-4 text-left">
          <span
            style={{ backgroundColor: 'var(--cf-orange)' }}
            className="absolute inset-x-0 top-0 h-[2.5px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10px] font-semibold tracking-wider uppercase"
            >
              Synced Deployments
            </span>
            <Globe style={{ color: 'var(--cf-orange)' }} className="h-4 w-4 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.totalRegisteredNodes}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="tabular-nums font-mono text-xs"
            >
              / {metrics.totalCapacityNodes}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter('expiring')}
          className="console-panel relative overflow-hidden rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <span className="absolute inset-x-0 top-0 h-[2.5px] bg-amber-500" />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10px] font-semibold tracking-wider uppercase"
            >
              Expiring &le; 14d
            </span>
            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.expiringSoonCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-xs"
            >
              renew soon
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('revoked')}
          className="console-panel relative overflow-hidden rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <span className="absolute inset-x-0 top-0 h-[2.5px] bg-rose-500" />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-[10px] font-semibold tracking-wider uppercase"
            >
              Paused / Lapsed
            </span>
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.revokedOrExpiredCount}
            </span>
            <span
              style={{ color: 'var(--text-muted)' }}
              className="font-mono text-xs"
            >
              read-only
            </span>
          </div>
        </button>
      </div>

      {/* 2. Cloudflare Registry Card (Toolbar + Responsive List/Table) */}
      <section className="console-panel overflow-hidden rounded-2xl">
        {/* Toolbar */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="space-y-3 p-3.5 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Scrollable Filter Chips on Mobile */}
            <div className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg p-1 console-well">
              {[
                { id: 'all', label: `All (${metrics.total})` },
                { id: 'active', label: `Active (${metrics.activeCount})` },
                { id: 'expiring', label: `Expiring (${metrics.expiringSoonCount})` },
                { id: 'revoked', label: `Paused (${metrics.revokedOrExpiredCount})` },
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
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--cf-orange-border)',
                            color: 'var(--text-primary)',
                          }
                        : {
                            border: '1px solid transparent',
                            color: 'var(--text-muted)',
                          }
                    }
                    className="shrink-0 rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold transition-all sm:px-2.5 sm:text-[11px]"
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={filteredRecords.length === 0}
                onClick={handleExportCsv}
                className="console-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <button
                type="button"
                disabled={refreshing}
                onClick={() => fetchEntitlements()}
                className="console-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                type="button"
                onClick={() => setIssueOpen(true)}
                className="console-btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5 stroke-[2.4]" />
                <span>Add Clinic</span>
              </button>
            </div>
          </div>

          {/* Search & Plan Filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                style={{ color: 'var(--text-muted)' }}
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by clinic owner email, https:// URL, plan, or billing note..."
                className="console-input w-full rounded-lg py-2 pr-8 pl-8 text-xs"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  style={{ color: 'var(--text-muted)' }}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              <SlidersHorizontal
                style={{ color: 'var(--text-muted)' }}
                className="hidden h-3.5 w-3.5 shrink-0 sm:block"
              />
              <select
                aria-label="Filter by myClinic plan"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="console-input w-full rounded-lg px-2.5 py-2 font-mono text-xs sm:w-48"
              >
                <option value="all">All Plans</option>
                <option value="solo">Solo Plan (1 Doc)</option>
                <option value="growth">Growth Plan (5 Docs)</option>
                <option value="chain">Chain Plan (Unlimited)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Empty / Loading / Data States */}
        {loading ? (
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="flex items-center justify-center py-20 text-xs"
          >
            <Loader2
              style={{ color: 'var(--cf-orange)' }}
              className="mr-2 h-4 w-4 animate-spin"
            />
            Loading clinic subscriptions...
          </div>
        ) : records.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div
              style={{
                backgroundColor: 'var(--cf-orange-soft)',
                border: '1px solid var(--cf-orange-border)',
              }}
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
            >
              <Building2 style={{ color: 'var(--cf-orange)' }} className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-bold">
              No clinics added to Central Auto-Sync yet
            </p>
            <p
              style={{ color: 'var(--text-muted)' }}
              className="mx-auto mt-1 max-w-md text-xs leading-relaxed"
            >
              Add your first clinic by <strong>Owner Email</strong>,{' '}
              <strong>Clinic Website URL</strong>, or <strong>both</strong> — client{' '}
              <code className="font-mono">myClinic</code> deployments will unlock
              automatically without typing any license key.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setIssueOpen(true)}
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Clinic
              </button>
              {onOpenGuide ? (
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
                >
                  <BookOpen
                    style={{ color: 'var(--cf-orange)' }}
                    className="h-3.5 w-3.5"
                  />
                  2-Side Quickstart Guide
                </button>
              ) : null}
            </div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-semibold">No clinics match your filter</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTierFilter('all');
              }}
              className="console-btn-secondary mt-3 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {/* Mobile & Tablet Card Stack (< 1024px — Zero Horizontal Scroll) */}
            <div className="divide-y divide-[var(--border-subtle)] lg:hidden">
              {filteredRecords.map((row) => {
                const standing = computeStanding(row);
                const pill = buildStandingPillStyle(standing);
                const identity = describeClinicIdentity(row);
                const seatSpec =
                  MYCLINIC_TIER_ENTITLEMENTS[row.tier] ??
                  MYCLINIC_TIER_ENTITLEMENTS.standard;
                const isToggling = Boolean(togglingIds[row.license_id]);

                return (
                  <div key={row.license_id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            style={{
                              backgroundColor: pill.bg,
                              border: `1px solid ${pill.border}`,
                              color: pill.text,
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                            {standing.stateCode === 'KEY_KILLED'
                              ? 'PAUSED'
                              : standing.label}
                          </span>

                          <span
                            style={{
                              backgroundColor: 'var(--cf-orange-soft)',
                              border: '1px solid var(--cf-orange-border)',
                              color: 'var(--cf-orange)',
                            }}
                            className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                          >
                            {seatSpec.plan}
                          </span>

                          <span className="console-well rounded px-1.5 py-0.5 font-mono text-[10px]">
                            {identity.modeLabel}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => openInspector(row)}
                          className="mt-2 block max-w-full truncate text-left text-sm font-semibold hover:underline"
                        >
                          {identity.primary}
                        </button>

                        {identity.secondary ? (
                          <div
                            style={{ color: 'var(--text-muted)' }}
                            className="mt-0.5 flex items-center gap-1 font-mono text-[11px]"
                          >
                            <Globe className="h-3 w-3 shrink-0" />
                            <span className="truncate">{identity.secondary}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{ color: 'var(--text-secondary)' }}
                      className="grid grid-cols-2 gap-2 rounded-xl p-2.5 font-mono text-[11px] console-well"
                    >
                      <div>
                        <span style={{ color: 'var(--text-muted)' }} className="block text-[9.5px] uppercase">
                          Deployments
                        </span>
                        <span className="font-semibold">
                          {row.registered_machines} / {row.max_machines} active
                        </span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }} className="block text-[9.5px] uppercase">
                          Valid Until
                        </span>
                        <span
                          style={{
                            color:
                              standing.daysLeft !== null && standing.daysLeft <= 14
                                ? 'var(--warn-text)'
                                : 'var(--text-primary)',
                          }}
                          className="font-semibold"
                        >
                          {formatDisplayDate(row.expires_at)}
                        </span>
                      </div>
                    </div>

                    {row.notes ? <RichNotesView notes={row.notes} compact /> : null}

                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => openInspector(row)}
                        className="console-btn-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium"
                      >
                        <Cpu className="h-3.5 w-3.5" />
                        Manage Clinic
                      </button>

                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleKillSwitch(row)}
                        style={
                          row.is_active
                            ? {
                                backgroundColor: 'var(--danger-soft)',
                                border: '1px solid rgba(239, 68, 68, 0.35)',
                                color: 'var(--danger-text)',
                              }
                            : {
                                backgroundColor: 'var(--ok-soft)',
                                border: '1px solid var(--ok-border)',
                                color: 'var(--ok-text)',
                              }
                        }
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {row.is_active ? 'Pause Clinic' : 'Resume Clinic'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Cloudflare Zone Table (>= 1024px) */}
            <div className="hidden overflow-x-auto lg:block">
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
                    <th className="px-4 py-3 font-semibold">Clinic (Email / Website URL)</th>
                    <th className="px-3 py-3 font-semibold">Auto-Sync Routing</th>
                    <th className="px-3 py-3 font-semibold">Plan &amp; Limits</th>
                    <th className="px-3 py-3 font-semibold">Seats &amp; Term</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((row) => {
                    const standing = computeStanding(row);
                    const pill = buildStandingPillStyle(standing);
                    const identity = describeClinicIdentity(row);
                    const seatSpec =
                      MYCLINIC_TIER_ENTITLEMENTS[row.tier] ??
                      MYCLINIC_TIER_ENTITLEMENTS.standard;
                    const isToggling = Boolean(togglingIds[row.license_id]);

                    return (
                      <tr
                        key={row.license_id}
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        className="console-row-hover align-top transition-colors"
                      >
                        {/* Col 1 */}
                        <td className="min-w-[230px] px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              style={{
                                backgroundColor: pill.bg,
                                border: `1px solid ${pill.border}`,
                                color: pill.text,
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                              {standing.stateCode === 'KEY_KILLED'
                                ? 'PAUSED'
                                : standing.label}
                            </span>

                            <button
                              type="button"
                              onClick={() => openInspector(row)}
                              className="truncate text-left font-semibold hover:underline"
                            >
                              {identity.primary}
                            </button>
                          </div>

                          {identity.secondary ? (
                            <div
                              style={{ color: 'var(--text-muted)' }}
                              className="mt-1 flex items-center gap-1 font-mono text-[11px]"
                            >
                              <Globe
                                style={{ color: 'var(--cf-orange)' }}
                                className="h-3 w-3 shrink-0"
                              />
                              <span className="truncate">{identity.secondary}</span>
                            </div>
                          ) : null}

                          {row.notes ? (
                            <div className="mt-1 max-w-md">
                              <RichNotesView notes={row.notes} compact />
                            </div>
                          ) : null}
                        </td>

                        {/* Col 2 */}
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <span className="console-well inline-block rounded-md px-2 py-0.5 font-mono text-[10.5px] font-semibold">
                            {identity.modeLabel}
                          </span>
                          <div
                            style={{ color: 'var(--text-muted)' }}
                            className="mt-1 font-mono text-[10px]"
                          >
                            {row.last_heartbeat
                              ? `Synced ${formatDisplayDate(row.last_heartbeat)}`
                              : 'Awaiting first sync'}
                          </div>
                        </td>

                        {/* Col 3 */}
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <span
                            style={{
                              backgroundColor: 'var(--cf-orange-soft)',
                              border: '1px solid var(--cf-orange-border)',
                              color: 'var(--cf-orange)',
                            }}
                            className="inline-block rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase"
                          >
                            {seatSpec.plan}
                          </span>
                          <div
                            style={{ color: 'var(--text-muted)' }}
                            className="mt-1 font-mono text-[10px]"
                          >
                            {seatSpec.doctors === null
                              ? 'Unlimited docs & branches'
                              : `${seatSpec.doctors} doc · ${seatSpec.frontdesk} desk`}
                          </div>
                        </td>

                        {/* Col 4 */}
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openInspector(row)}
                            className="block text-left"
                          >
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="tabular-nums font-semibold">
                                {row.registered_machines}/{row.max_machines} seats
                              </span>
                              <div
                                style={{ backgroundColor: 'var(--bg-well)' }}
                                className="h-1.5 w-12 overflow-hidden rounded-full"
                              >
                                <div
                                  className={`h-full rounded-full ${
                                    standing.usagePct >= 100
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
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
                              className="mt-1 tabular-nums font-mono text-[10.5px]"
                            >
                              {formatDisplayDate(row.expires_at)}
                              {standing.daysLeft !== null
                                ? standing.daysLeft < 0
                                  ? ` · ${Math.abs(standing.daysLeft)}d overdue`
                                  : ` · ${standing.daysLeft}d left`
                                : ''}
                            </div>
                          </button>
                        </td>

                        {/* Col 5 */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openInspector(row)}
                              className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                            >
                              Manage
                            </button>

                            <button
                              type="button"
                              onClick={() => openClientSdk(row)}
                              title="Open myClinic Client SDK"
                              className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                            >
                              <Blocks className="h-3.5 w-3.5" />
                              SDK
                            </button>

                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleToggleKillSwitch(row)}
                              style={
                                row.is_active
                                  ? {
                                      backgroundColor: 'var(--danger-soft)',
                                      border: '1px solid rgba(239, 68, 68, 0.32)',
                                      color: 'var(--danger-text)',
                                    }
                                  : {
                                      backgroundColor: 'var(--ok-soft)',
                                      border: '1px solid var(--ok-border)',
                                      color: 'var(--ok-text)',
                                    }
                              }
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50"
                            >
                              <Power className="h-3 w-3" />
                              {row.is_active ? 'Pause' : 'Resume'}
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

      {/* Drawer 1: Add Clinic Subscription */}
      <SlideOverDrawer
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Add Clinic Subscription"
        subtitle="Keyless Central Auto-Sync — match by Clinic Owner Email, Website URL, or both."
      >
        <form id="provision-license-form" onSubmit={handleProvisionSubmit} className="space-y-5">
          <div className="console-well space-y-3.5 rounded-xl p-4">
            <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">
              Enter <strong>Owner Email</strong>, <strong>Clinic URL</strong>, or{' '}
              <strong>both</strong>. Providing both pins the subscription to that exact
              owner and domain.
            </p>

            <div>
              <label
                htmlFor="prov-customer-email"
                style={{ color: 'var(--text-secondary)' }}
                className="flex items-center gap-1.5 text-xs font-medium"
              >
                <Mail className="h-3.5 w-3.5" />
                Clinic Owner Email{' '}
                <span style={{ color: 'var(--text-muted)' }}>(optional if URL set)</span>
              </label>
              <input
                id="prov-customer-email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="dr.sharma@sharmaclinic.in"
                className="console-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="prov-allowed-origin"
                style={{ color: 'var(--text-secondary)' }}
                className="flex items-center gap-1.5 text-xs font-medium"
              >
                <Globe className="h-3.5 w-3.5" />
                Clinic Website URL{' '}
                <span style={{ color: 'var(--text-muted)' }}>(optional if Email set)</span>
              </label>
              <input
                id="prov-allowed-origin"
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
                <span style={{ color: 'var(--text-secondary)' }} className="text-[11px] leading-relaxed">
                  <strong>Auto-lock first cloud URL</strong> — pins their domain
                  automatically the first time they open <code className="font-mono">myClinic</code>.
                </span>
              </label>
            ) : null}
          </div>

          {/* 3-Card Plan Selector */}
          <div>
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="block text-xs font-medium"
            >
              myClinic Plan Tier
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
                            backgroundColor: 'var(--cf-orange-soft)',
                            border: '1px solid var(--cf-orange-border)',
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
                        {item.value}
                      </span>
                      {selected ? (
                        <Check
                          style={{ color: 'var(--cf-orange)' }}
                          className="h-3.5 w-3.5"
                        />
                      ) : null}
                    </div>
                    <p
                      style={{ color: 'var(--text-muted)' }}
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
          </div>

          {/* Max Seats + Paid Term */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Max Allowed Deployments
              </label>
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
                  required
                  value={maxMachines}
                  onChange={(e) =>
                    setMaxMachines(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="console-input h-9 w-full rounded-lg px-3 text-center font-mono text-xs"
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

            <div>
              <label
                htmlFor="prov-expires-date"
                style={{ color: 'var(--text-secondary)' }}
                className="block text-xs font-medium"
              >
                Subscription End Date
              </label>
              <input
                id="prov-expires-date"
                type="date"
                required
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
                    className="console-btn-secondary rounded px-2 py-0.5 font-mono text-[10px]"
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
              className="console-btn-secondary rounded-lg px-4 py-2.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="console-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 stroke-[2.4]" />
              )}
              Save Subscription
            </button>
          </div>
        </form>
      </SlideOverDrawer>

      {/* Drawer 2: Clinic Dossier & Live Auto-Sync Controls */}
      <SlideOverDrawer
        open={Boolean(inspectedRow)}
        onClose={() => setInspectedLicenseId(null)}
        title={
          inspectedRow ? describeClinicIdentity(inspectedRow).primary : 'Clinic Inspector'
        }
        subtitle={
          inspectedRow
            ? `${describeClinicIdentity(inspectedRow).modeLabel} · Auto-updates myClinic`
            : ''
        }
        widthClass="max-w-2xl"
      >
        {inspectedRow ? (
          <div className="space-y-5">
            {/* Live Routing & Tier Editor */}
            <div className="console-well space-y-3.5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  style={{ color: 'var(--text-muted)' }}
                  className="font-mono text-[10px] font-semibold tracking-wider uppercase"
                >
                  Auto-Sync Identity (Email &amp; Website URL)
                </span>
                <button
                  type="button"
                  onClick={() => openClientSdk(inspectedRow)}
                  style={{ color: 'var(--cf-orange)' }}
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold hover:underline"
                >
                  Open Client SDK
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-[11px] font-medium"
                  >
                    Clinic Owner Email
                  </label>
                  <input
                    type="email"
                    value={editEmailInput}
                    onChange={(e) => setEditEmailInput(e.target.value)}
                    placeholder="owner@cityclinic.in"
                    className="console-input mt-1 w-full rounded-lg px-2.5 py-2 text-xs"
                  />
                </div>
                <div>
                  <label
                    style={{ color: 'var(--text-secondary)' }}
                    className="block text-[11px] font-medium"
                  >
                    Clinic Website URL
                  </label>
                  <input
                    type="url"
                    value={editOriginInput}
                    onChange={(e) => setEditOriginInput(e.target.value)}
                    placeholder="https://sharmaclinic.github.io"
                    className="console-input mt-1 w-full rounded-lg px-2.5 py-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={editLockFirstOrigin}
                    onChange={(e) => setEditLockFirstOrigin(e.target.checked)}
                    className="rounded"
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Auto-lock first cloud URL when URL blank
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  {editOriginInput ? (
                    <button
                      type="button"
                      onClick={() => setEditOriginInput('')}
                      className="console-btn-secondary rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      Clear URL
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={savingRouting}
                    onClick={handleSaveRouting}
                    className="console-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {savingRouting ? 'Saving...' : 'Save Identity'}
                  </button>
                </div>
              </div>

              {/* Live Plan Switcher */}
              <div
                style={{ borderTop: '1px solid var(--border-subtle)' }}
                className="flex flex-wrap items-center justify-between gap-2 pt-3"
              >
                <span style={{ color: 'var(--text-secondary)' }} className="text-xs font-medium">
                  Active Plan Tier:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {['solo', 'growth', 'chain'].map((planOpt) => {
                    const active = inspectedRow.tier === planOpt;
                    return (
                      <button
                        key={planOpt}
                        type="button"
                        disabled={savingTier}
                        onClick={() => handleUpdateTier(planOpt)}
                        style={
                          active
                            ? {
                                backgroundColor: 'var(--cf-orange-soft)',
                                border: '1px solid var(--cf-orange-border)',
                                color: 'var(--cf-orange)',
                              }
                            : undefined
                        }
                        className="console-btn-secondary rounded-lg px-3 py-1 font-mono text-[11px] font-bold uppercase"
                      >
                        {planOpt}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Pause Switch & Term Extension */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="console-elevated rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Subscription Access</span>
                  <Power
                    className={`h-4 w-4 ${
                      inspectedRow.is_active ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  />
                </div>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="mt-1 text-[11px] leading-relaxed"
                >
                  {inspectedRow.is_active
                    ? 'Active. Client myClinic syncs full read/write capabilities.'
                    : 'Paused. Client downgrades to read-only immediately on next sync.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleToggleKillSwitch(inspectedRow)}
                  disabled={Boolean(togglingIds[inspectedRow.license_id])}
                  className="console-btn-secondary mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                >
                  <Power className="h-3.5 w-3.5" />
                  {inspectedRow.is_active ? 'Pause Subscription' : 'Resume Subscription'}
                </button>
              </div>

              <div className="console-elevated rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Extend Paid Term</span>
                  <Calendar
                    style={{ color: 'var(--cf-orange)' }}
                    className="h-4 w-4"
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="date"
                    value={renewDateInput}
                    onChange={(e) => setRenewDateInput(e.target.value)}
                    className="console-input w-full rounded-lg px-2.5 py-1.5 font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(renewDateInput)}
                    className="console-btn-primary shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
                  >
                    Save
                  </button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(defaultExpirationDate(30))}
                    className="console-btn-secondary rounded px-2.5 py-1 font-mono text-[10px]"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(defaultExpirationDate(365))}
                    className="console-btn-secondary rounded px-2.5 py-1 font-mono text-[10px]"
                  >
                    +1 Year
                  </button>
                </div>
              </div>
            </div>

            {/* Bound Deployment Seats */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">
                  Synced Clinic Deployments ({boundMachines.length} /{' '}
                  {inspectedRow.max_machines})
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyValue(
                      inspectedRow.license_id,
                      inspectedRow.license_key,
                      'Copied legacy backup key',
                    )
                  }
                  className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px]"
                >
                  {copiedId === inspectedRow.license_id ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Backup Key
                </button>
              </div>

              <div className="mt-2.5 space-y-2">
                {loadingMachines ? (
                  <div
                    style={{ color: 'var(--text-secondary)' }}
                    className="flex items-center gap-2 py-5 text-xs"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading synced deployments...
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
                      No clinic browser or desktop deployment has auto-synced yet.
                    </p>
                  </div>
                ) : (
                  boundMachines.map((machine) => (
                    <div
                      key={machine.id}
                      className="console-well flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Globe
                            style={{ color: 'var(--cf-orange)' }}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <code className="truncate font-mono text-xs font-medium">
                            {machine.machine_fingerprint}
                          </code>
                        </div>
                        <div
                          style={{ color: 'var(--text-muted)' }}
                          className="mt-0.5 font-mono text-[10px]"
                        >
                          First seen {formatDisplayDate(machine.activated_at)} · Last
                          sync {formatDisplayDate(machine.last_heartbeat)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleReleaseNode(machine.id)}
                        style={{
                          backgroundColor: 'var(--danger-soft)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: 'var(--danger-text)',
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold"
                      >
                        <Trash2 className="h-3 w-3" />
                        Release
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SlideOverDrawer>
    </div>
  );
}
