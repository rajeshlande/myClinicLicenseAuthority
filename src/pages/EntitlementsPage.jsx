import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Building2,
  Calendar,
  Check,
  Copy,
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
import SlideOverDrawer from '../components/SlideOverDrawer.jsx';
import ClinicCardMobile from '../components/entitlements/ClinicCardMobile.jsx';
import ClinicRowDesktop from '../components/entitlements/ClinicRowDesktop.jsx';
import FleetMetricTiles from '../components/entitlements/FleetMetricTiles.jsx';
import RefusalEvidenceCard from '../components/entitlements/RefusalEvidenceCard.jsx';
import SyncStateBadge from '../components/entitlements/SyncStateBadge.jsx';
import { copyTextToClipboard } from '../lib/clipboard.mjs';
import {
  getGlobalSearchQuery,
  setGlobalSearchQuery,
  subscribeGlobalSearch,
} from '../lib/global-search.mjs';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  TIER_CATALOG,
  computeFleetMetrics,
  computeStanding,
  defaultExpirationDate,
  describeClientSyncState,
  describeClinicIdentity,
  formatDisplayDate,
  formatSyncTimestamp,
  sanitizeCsvCell,
  validateProvisionInput,
  validateRoutingUpdateInput,
} from '../lib/entitlements.mjs';
import { errorLine, rememberError } from '../lib/errors.mjs';
import {
  buildStandingPillStyle,
  buildSyncPillStyle,
} from '../lib/status-palette.mjs';

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
  const [livePolling, setLivePolling] = useState(true);
  const [errorBanner, setErrorBanner] = useState(null);
  const [toast, setToast] = useState(null);

  // The shell topbar's global search pill and this registry filter are ONE
  // piece of state (Enrolliq slice 2): seed from the store and mirror every
  // external change back into the local query.
  const [searchQuery, setSearchQuery] = useState(getGlobalSearchQuery);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');

  const pushSearchQuery = useCallback((value) => {
    setSearchQuery(value);
    setGlobalSearchQuery(value);
  }, []);

  useEffect(() => subscribeGlobalSearch(setSearchQuery), []);

  const [copiedId, setCopiedId] = useState(null);
  const [togglingIds, setTogglingIds] = useState({});

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

  const [customerEmail, setCustomerEmail] = useState('');
  const [allowedOrigin, setAllowedOrigin] = useState('');
  const [lockFirstOrigin, setLockFirstOrigin] = useState(true);
  const [tier, setTier] = useState('growth');
  const [maxMachines, setMaxMachines] = useState(2);
  const [expiresDate, setExpiresDate] = useState(() =>
    defaultExpirationDate(365),
  );
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

  useEffect(() => {
    if (!livePolling) return undefined;
    const pollId = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      void fetchEntitlements({ silent: true });
      if (inspectedLicenseId) {
        void supabase
          .from('activated_machines')
          .select('*')
          .eq('license_id', inspectedLicenseId)
          .then(({ data, error }) => {
            if (!error && Array.isArray(data)) {
              setBoundMachines(data);
            }
          });
      }
    }, 15000);
    return () => clearInterval(pollId);
  }, [livePolling, fetchEntitlements, inspectedLicenseId, supabase]);

  const inspectedRow = useMemo(
    () => records.find((r) => r.license_id === inspectedLicenseId) ?? null,
    [records, inspectedLicenseId],
  );

  const openInspector = async (row) => {
    setInspectedLicenseId(row.license_id);
    setRenewDateInput(
      row.expires_at
        ? String(row.expires_at).slice(0, 10)
        : defaultExpirationDate(365),
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
      showToast(
        `Updated plan to ${nextTier.toUpperCase()} — auto-syncs on client.`,
      );
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

      const nowIso = new Date().toISOString();
      setRecords((prev) =>
        prev.map((item) =>
          item.license_id === row.license_id
            ? { ...item, is_active: nextActiveState, updated_at: nowIso }
            : item,
        ),
      );
      void fetchEntitlements({ silent: true });
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
        const mappedPlan = (
          MYCLINIC_TIER_ENTITLEMENTS[row.tier] ??
          MYCLINIC_TIER_ENTITLEMENTS.standard
        ).plan;
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
      'customer_email,allowed_origin,match_mode,tier,status,client_sync_state,last_heartbeat,registered_machines,max_machines,expires_at,last_refusal_code,refusals_24h',
      ...filteredRecords.map((row) => {
        const standing = computeStanding(row);
        const identity = describeClinicIdentity(row);
        const syncState = describeClientSyncState(row);
        return [
          row.customer_email ?? '',
          row.allowed_origin ?? '',
          identity.mode,
          row.tier,
          standing.label,
          syncState.badgeLabel,
          row.last_heartbeat ?? '',
          row.registered_machines,
          row.max_machines,
          row.expires_at,
          syncState.refusal?.code ?? '',
          syncState.refusals24h ?? 0,
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
      {/* Toast Notification (Mapped to Success / Warning / Error Palettes) */}
      {toast ? (
        <div
          role="status"
          style={{
            boxShadow: 'var(--shadow-float)',
          }}
          className={`${
            toast.tone === 'error'
              ? 'badge-error'
              : toast.tone === 'warn'
                ? 'badge-warning'
                : 'badge-success'
          } fixed right-4 bottom-20 z-50 flex max-w-[92vw] items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-semibold lg:right-6 lg:bottom-6`}
        >
          {toast.tone === 'error' ? (
            <AlertCircle
              style={{ color: 'var(--danger-main)' }}
              className="h-4 w-4 shrink-0"
            />
          ) : toast.tone === 'warn' ? (
            <ShieldAlert
              style={{ color: 'var(--warn-main)' }}
              className="h-4 w-4 shrink-0"
            />
          ) : (
            <ShieldCheck
              style={{ color: 'var(--ok-main)' }}
              className="h-4 w-4 shrink-0"
            />
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

      {/* 1. 4-Metric Zone Overview Strip */}
      <FleetMetricTiles metrics={metrics} onSelectFilter={setStatusFilter} />

      {/* 2. Subscriptions Registry Card (neutral.white #fcfaf5) */}
      <section className="console-panel overflow-hidden rounded-2xl">
        {/* Toolbar */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="space-y-3 p-3.5 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="console-well grid w-full grid-cols-4 gap-1 rounded-xl p-1 sm:flex sm:w-auto sm:items-center">
              {[
                {
                  id: 'all',
                  label: `All (${metrics.total})`,
                  mobileLabel: `All ${metrics.total}`,
                },
                {
                  id: 'active',
                  label: `Active (${metrics.activeCount})`,
                  mobileLabel: `Active ${metrics.activeCount}`,
                },
                {
                  id: 'expiring',
                  label: `Expiring (${metrics.expiringSoonCount})`,
                  mobileLabel: `Soon ${metrics.expiringSoonCount}`,
                },
                {
                  id: 'revoked',
                  label: `Paused (${metrics.revokedOrExpiredCount})`,
                  mobileLabel: `Paused ${metrics.revokedOrExpiredCount}`,
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
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            boxShadow: 'var(--shadow-card)',
                            color: 'var(--text-primary)',
                          }
                        : {
                            border: '1px solid transparent',
                            color: 'var(--text-secondary)',
                          }
                    }
                    className="truncate rounded-lg px-1.5 py-1.5 text-center font-mono text-[10px] font-semibold transition-all sm:px-2.5 sm:text-[11px]"
                  >
                    <span className="sm:hidden">{tab.mobileLabel}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLivePolling((prev) => !prev)}
                title={
                  livePolling
                    ? 'Auto-polling Central every 15s for live client syncs (click to pause)'
                    : 'Click to resume 15s live client sync polling'
                }
                className={`${
                  livePolling ? 'badge-success' : 'console-btn-secondary'
                } inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-mono text-[10.5px] font-bold`}
              >
                <span
                  style={{
                    backgroundColor: livePolling
                      ? 'var(--ok-main)'
                      : 'var(--text-muted)',
                  }}
                  className={`h-1.5 w-1.5 rounded-full ${
                    livePolling ? 'animate-pulse' : ''
                  }`}
                />
                <span>{livePolling ? 'Live 15s' : 'Paused'}</span>
              </button>

              <button
                type="button"
                disabled={filteredRecords.length === 0}
                onClick={handleExportCsv}
                className="console-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <button
                type="button"
                disabled={refreshing}
                onClick={() => fetchEntitlements()}
                className="console-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                type="button"
                onClick={() => setIssueOpen(true)}
                className="console-btn-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold"
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
                style={{ color: 'var(--text-secondary)' }}
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => pushSearchQuery(e.target.value)}
                placeholder="Search by clinic owner email, https:// URL, plan, or billing note..."
                className="console-search-pill h-9 w-full pr-8 pl-8 text-xs"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => pushSearchQuery('')}
                  aria-label="Clear search"
                  style={{ color: 'var(--text-secondary)' }}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              <span className="console-well hidden h-9 w-9 shrink-0 items-center justify-center rounded-full sm:flex">
                <SlidersHorizontal
                  style={{ color: 'var(--text-secondary)' }}
                  className="h-3.5 w-3.5"
                />
              </span>
              <select
                aria-label="Filter by myClinic plan"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="console-search-pill h-9 w-full px-3 font-mono text-xs sm:w-44"
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
            className="flex items-center justify-center py-20 text-xs font-medium"
          >
            <Loader2
              style={{ color: 'var(--brand-primary)' }}
              className="mr-2 h-4 w-4 animate-spin"
            />
            Loading clinic subscriptions...
          </div>
        ) : records.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="badge-brand mx-auto flex h-12 w-12 items-center justify-center rounded-2xl">
              <Building2
                style={{ color: 'var(--brand-text)' }}
                className="h-6 w-6"
              />
            </div>
            <p className="mt-4 text-sm font-bold">
              No clinics added to Central Auto-Sync yet
            </p>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="mx-auto mt-1 max-w-md text-xs leading-relaxed"
            >
              Add your first clinic by <strong>Owner Email</strong>,{' '}
              <strong>Clinic Website URL</strong>, or <strong>both</strong> —
              client <code className="font-mono">myClinic</code> deployments
              will unlock automatically without typing any license key.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setIssueOpen(true)}
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Clinic
              </button>
              {onOpenGuide ? (
                <button
                  type="button"
                    onClick={onOpenGuide}
                    className="console-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  <BookOpen
                    style={{ color: 'var(--brand-text)' }}
                    className="h-3.5 w-3.5"
                  />
                  2-Side Quickstart Guide
                </button>
              ) : null}
            </div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-bold">No clinics match your filter</p>
            <button
              type="button"
              onClick={() => {
                pushSearchQuery('');
                setStatusFilter('all');
                setTierFilter('all');
              }}
                className="console-btn-secondary mt-3 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {/* Mobile & Tablet Card Stack (< 1024px) */}
            <div className="grid gap-3 p-3 lg:hidden">
              {filteredRecords.map((row) => (
                <ClinicCardMobile
                  key={row.license_id}
                  row={row}
                  isToggling={Boolean(togglingIds[row.license_id])}
                  onOpenInspector={openInspector}
                  onToggleKillSwitch={handleToggleKillSwitch}
                />
              ))}
            </div>

            {/* Desktop Table (>= 1024px) */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr
                    style={{
                      backgroundColor: 'var(--bg-well)',
                      borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                    className="font-mono text-[10px] tracking-wider uppercase"
                  >
                    <th className="px-4 py-3 font-bold">
                      Clinic (Email / Website URL)
                    </th>
                    <th className="px-3 py-3 font-bold">
                      Client Sync &amp; Routing
                    </th>
                    <th className="px-3 py-3 font-bold">Plan &amp; Limits</th>
                    <th className="px-3 py-3 font-bold">Seats &amp; Term</th>
                    <th className="px-4 py-3 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((row) => (
                    <ClinicRowDesktop
                      key={row.license_id}
                      row={row}
                      isToggling={Boolean(togglingIds[row.license_id])}
                      onOpenInspector={openInspector}
                      onOpenClientSdk={openClientSdk}
                      onToggleKillSwitch={handleToggleKillSwitch}
                    />
                  ))}
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
        <form
          id="provision-license-form"
          onSubmit={handleProvisionSubmit}
          className="space-y-5"
        >
          <div className="console-well space-y-3.5 rounded-xl p-4">
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="text-xs leading-relaxed"
            >
              Enter <strong>Owner Email</strong>, <strong>Clinic URL</strong>,
              or <strong>both</strong>. Providing both pins the subscription to
              that exact owner and domain.
            </p>

            <div>
              <label
                htmlFor="prov-customer-email"
                style={{ color: 'var(--text-primary)' }}
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
                style={{ color: 'var(--text-primary)' }}
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

          {/* 3-Card Plan Selector */}
          <div>
            <span
              style={{ color: 'var(--text-primary)' }}
              className="block text-xs font-semibold"
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
                            backgroundColor: 'var(--brand-soft)',
                            border: '1px solid var(--brand-border)',
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
                          style={{ color: 'var(--brand-text)' }}
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
          </div>

          {/* Max Seats + Paid Term */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
              >
                Max Allowed Deployments
              </label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setMaxMachines((n) => Math.max(1, Number(n) - 1))
                  }
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
                  className="console-input h-9 w-full rounded-lg px-3 text-center font-mono text-xs font-semibold"
                />
                <button
                  type="button"
                  onClick={() =>
                    setMaxMachines((n) => Math.min(500, Number(n) + 1))
                  }
                  className="console-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="prov-expires-date"
                style={{ color: 'var(--text-primary)' }}
                className="block text-xs font-semibold"
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
                    onClick={() =>
                      setExpiresDate(defaultExpirationDate(preset.days))
                    }
                    className="console-btn-secondary rounded px-2 py-0.5 font-mono text-[10px] font-semibold"
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
              className="console-btn-secondary rounded-lg px-4 py-2.5 text-xs font-semibold"
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
          inspectedRow
            ? describeClinicIdentity(inspectedRow).primary
            : 'Clinic Inspector'
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
            {/* Live Client Sync Receipt Card */}
            {(() => {
              const syncState = describeClientSyncState(inspectedRow);
              const syncPill = buildSyncPillStyle(syncState);
              return (
                <div className="space-y-2.5">
                  <div
                    className={`${syncPill.badgeClass} flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-4 py-3`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono text-xs font-bold">
                        <span
                          style={{ backgroundColor: syncPill.dotColor }}
                          className="h-2 w-2 shrink-0 rounded-full"
                        />
                        <span>Client Status: {syncState.badgeLabel}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] opacity-90">
                        {syncState.detail} · Client updates automatically on page
                        open, tab focus, reconnect, or every 30m.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openInspector(inspectedRow)}
                      className="console-btn-secondary inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[10.5px] font-bold"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Check Now
                    </button>
                  </div>

                  {/* Schema v3 refused-attempt evidence: what the client actually
                      sent, and the one action that clears it. */}
                  <RefusalEvidenceCard
                    refused={syncState.state === 'refused'}
                    refusal={syncState.refusal}
                    pinned={describeClinicIdentity(inspectedRow)}
                  />
                </div>
              );
            })()}

            {/* Live Routing & Tier Editor */}
            <div className="console-well space-y-3.5 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  style={{ color: 'var(--text-secondary)' }}
                  className="font-mono text-[10px] font-bold tracking-wider uppercase"
                >
                  Auto-Sync Identity (Email &amp; Website URL)
                </span>
                <button
                  type="button"
                  onClick={() => openClientSdk(inspectedRow)}
                  style={{ color: 'var(--brand-text)' }}
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-bold hover:underline"
                >
                  Open Client SDK
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    style={{ color: 'var(--text-primary)' }}
                    className="block text-[11px] font-semibold"
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
                    style={{ color: 'var(--text-primary)' }}
                    className="block text-[11px] font-semibold"
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
                      className="console-btn-secondary rounded-lg px-2.5 py-1.5 text-xs font-semibold"
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
                <span
                  style={{ color: 'var(--text-primary)' }}
                  className="text-xs font-semibold"
                >
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
                        className={`${
                          active ? 'badge-brand' : 'console-btn-secondary'
                        } rounded-lg px-3 py-1 font-mono text-[11px] font-bold uppercase`}
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
                  <span className="text-xs font-bold">Subscription Access</span>
                  <Power
                    style={{
                      color: inspectedRow.is_active
                        ? 'var(--ok-main)'
                        : 'var(--danger-main)',
                    }}
                    className="h-4 w-4"
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
                  className={`${
                    inspectedRow.is_active
                      ? 'console-btn-danger'
                      : 'badge-success'
                  } mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold`}
                >
                  <Power className="h-3.5 w-3.5" />
                  {inspectedRow.is_active
                    ? 'Pause Subscription'
                    : 'Resume Subscription'}
                </button>
              </div>

              <div className="console-elevated rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Extend Paid Term</span>
                  <Calendar
                    style={{ color: 'var(--brand-text)' }}
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
                    className="console-btn-secondary rounded px-2.5 py-1 font-mono text-[10px] font-semibold"
                  >
                    +30 Days
                  </button>
                  <button
                    type="button"
                    disabled={savingTerm}
                    onClick={() => handleExtendTerm(defaultExpirationDate(365))}
                    className="console-btn-secondary rounded px-2.5 py-1 font-mono text-[10px] font-semibold"
                  >
                    +1 Year
                  </button>
                </div>
              </div>
            </div>

            {/* Bound Deployment Seats */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold">
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
                  className="console-btn-secondary inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
                >
                  {copiedId === inspectedRow.license_id ? (
                    <Check
                      style={{ color: 'var(--ok-main)' }}
                      className="h-3 w-3"
                    />
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
                      style={{ color: 'var(--text-secondary)' }}
                      className="mx-auto h-5 w-5 opacity-70"
                    />
                    <p
                      style={{ color: 'var(--text-secondary)' }}
                      className="mt-1.5 text-xs"
                    >
                      No clinic browser or desktop deployment has auto-synced
                      yet.
                    </p>
                  </div>
                ) : (
                  boundMachines.map((machine) => (
                    <div
                      key={machine.id}
                      className="console-well flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Globe
                            style={{ color: 'var(--brand-text)' }}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <code className="truncate font-mono text-xs font-bold">
                            {machine.machine_fingerprint}
                          </code>
                          {machine.last_synced_tier ||
                          machine.last_synced_status ? (
                            <span
                              className={`${
                                machine.last_synced_status &&
                                machine.last_synced_status !== 'active'
                                  ? 'badge-error'
                                  : 'badge-success'
                              } rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase`}
                            >
                              {machine.last_synced_status &&
                              machine.last_synced_status !== 'active'
                                ? `${machine.last_synced_status} ack`
                                : `${
                                    MYCLINIC_TIER_ENTITLEMENTS[
                                      machine.last_synced_tier
                                    ]?.plan ??
                                    machine.last_synced_tier ??
                                    'synced'
                                  } ack`}
                            </span>
                          ) : null}
                        </div>
                        <div
                          style={{ color: 'var(--text-secondary)' }}
                          className="mt-0.5 font-mono text-[10px]"
                        >
                          First seen {formatDisplayDate(machine.activated_at)} ·
                          Last sync {formatSyncTimestamp(machine.last_heartbeat)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleReleaseNode(machine.id)}
                        className="console-btn-danger inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold"
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
