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
  describeClientSyncState,
  describeClinicIdentity,
  formatDisplayDate,
  formatSyncTimestamp,
  sanitizeCsvCell,
  validateProvisionInput,
  validateRoutingUpdateInput,
} from '../lib/entitlements.mjs';
import { errorLine, rememberError } from '../lib/errors.mjs';

/**
 * Client Sync badge palette (UI Component Mapping Guide).
 *
 * `error` is the schema-v3 `Refused` state: the client IS calling Central and is
 * being turned away, which is a fault, not a neutral "not connected yet".
 */
function buildSyncPillStyle(syncState) {
  if (syncState.tone === 'ok') {
    return {
      badgeClass: 'badge-success',
      dotColor: 'var(--ok-main)',
      textColor: 'var(--ok-text)',
    };
  }
  if (syncState.tone === 'warn') {
    return {
      badgeClass: 'badge-warning',
      dotColor: 'var(--warn-main)',
      textColor: 'var(--warn-text)',
    };
  }
  if (syncState.tone === 'error') {
    return {
      badgeClass: 'badge-error',
      dotColor: 'var(--danger-main)',
      textColor: 'var(--danger-text)',
    };
  }
  return {
    badgeClass: 'console-well',
    dotColor: 'var(--text-muted)',
    textColor: 'var(--text-secondary)',
  };
}

function buildStandingPillStyle(standing) {
  if (standing.isOperational) {
    return {
      bg: 'var(--ok-soft)',
      border: 'var(--ok-border)',
      text: 'var(--ok-text)',
      dotColor: 'var(--ok-main)',
    };
  }
  if (standing.stateCode === 'KEY_KILLED') {
    return {
      bg: 'var(--danger-soft)',
      border: 'var(--danger-border)',
      text: 'var(--danger-text)',
      dotColor: 'var(--danger-main)',
    };
  }
  return {
    bg: 'var(--warn-soft)',
    border: 'var(--warn-border)',
    text: 'var(--warn-text)',
    dotColor: 'var(--warn-main)',
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
  const [livePolling, setLivePolling] = useState(true);
  const [errorBanner, setErrorBanner] = useState(null);
  const [toast, setToast] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          className="console-panel relative overflow-hidden rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <span
            style={{ backgroundColor: 'var(--brand-primary)' }}
            className="absolute inset-x-0 top-0 h-[3px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="font-mono text-[10px] font-bold tracking-wider uppercase"
            >
              Active Clinics
            </span>
            <ShieldCheck
              style={{ color: 'var(--ok-main)' }}
              className="h-4 w-4 shrink-0"
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.activeCount}
            </span>
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="tabular-nums font-mono text-xs"
            >
              / {metrics.total}
            </span>
          </div>
        </button>

        <div className="console-panel relative overflow-hidden rounded-xl p-4 text-left">
          <span
            style={{ backgroundColor: 'var(--accent-energy)' }}
            className="absolute inset-x-0 top-0 h-[3px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="font-mono text-[10px] font-bold tracking-wider uppercase"
            >
              Client Sync Live
            </span>
            <Globe
              style={{ color: 'var(--brand-text)' }}
              className="h-4 w-4 shrink-0"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.inSyncClinicsCount}
            </span>
            <span
              style={{
                color:
                  metrics.refusedClinicsCount > 0
                    ? 'var(--danger-text)'
                    : metrics.pendingSyncClinicsCount > 0
                      ? 'var(--warn-text)'
                      : 'var(--text-secondary)',
              }}
              className="tabular-nums font-mono text-[11px] font-semibold"
            >
              {metrics.refusedClinicsCount > 0
                ? `synced · ${metrics.refusedClinicsCount} refused`
                : metrics.pendingSyncClinicsCount > 0
                  ? `synced · ${metrics.pendingSyncClinicsCount} pending`
                  : `/ ${metrics.connectedClinicsCount} connected`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusFilter('expiring')}
          className="console-panel relative overflow-hidden rounded-xl p-4 text-left transition hover:opacity-95"
        >
          <span
            style={{ backgroundColor: 'var(--warn-main)' }}
            className="absolute inset-x-0 top-0 h-[3px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="font-mono text-[10px] font-bold tracking-wider uppercase"
            >
              Expiring &le; 14d
            </span>
            <Clock
              style={{ color: 'var(--warn-main)' }}
              className="h-4 w-4 shrink-0"
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.expiringSoonCount}
            </span>
            <span
              style={{ color: 'var(--text-secondary)' }}
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
          <span
            style={{ backgroundColor: 'var(--danger-main)' }}
            className="absolute inset-x-0 top-0 h-[3px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="font-mono text-[10px] font-bold tracking-wider uppercase"
            >
              Paused / Lapsed
            </span>
            <ShieldAlert
              style={{ color: 'var(--danger-main)' }}
              className="h-4 w-4 shrink-0"
            />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular-nums text-2xl font-bold tracking-tight">
              {metrics.revokedOrExpiredCount}
            </span>
            <span
              style={{ color: 'var(--text-secondary)' }}
              className="font-mono text-xs"
            >
              read-only
            </span>
          </div>
        </button>
      </div>

      {/* 2. Subscriptions Registry Card (neutral.white #fcfaf5) */}
      <section className="console-panel overflow-hidden rounded-2xl">
        {/* Toolbar */}
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="space-y-3 p-3.5 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="console-well grid w-full grid-cols-4 gap-1 rounded-lg p-1 sm:flex sm:w-auto sm:items-center">
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
                            border: '1px solid var(--brand-border)',
                            color: 'var(--text-primary)',
                          }
                        : {
                            border: '1px solid transparent',
                            color: 'var(--text-secondary)',
                          }
                    }
                    className="truncate rounded-md px-1.5 py-1 text-center font-mono text-[10px] font-semibold transition-all sm:px-2.5 sm:text-[11px]"
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
                } inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[10.5px] font-bold`}
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
                className="console-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <button
                type="button"
                disabled={refreshing}
                onClick={() => fetchEntitlements()}
                className="console-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold"
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
                style={{ color: 'var(--text-secondary)' }}
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
                  style={{ color: 'var(--text-secondary)' }}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              <SlidersHorizontal
                style={{ color: 'var(--text-secondary)' }}
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
                className="console-btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Clinic
              </button>
              {onOpenGuide ? (
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="console-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
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
                setSearchQuery('');
                setStatusFilter('all');
                setTierFilter('all');
              }}
              className="console-btn-secondary mt-3 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {/* Mobile & Tablet Card Stack (< 1024px) */}
            <div className="divide-y divide-[var(--border-subtle)] lg:hidden">
              {filteredRecords.map((row) => {
                const standing = computeStanding(row);
                const pill = buildStandingPillStyle(standing);
                const identity = describeClinicIdentity(row);
                const syncState = describeClientSyncState(row);
                const syncPill = buildSyncPillStyle(syncState);
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
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase"
                          >
                            <span
                              style={{ backgroundColor: pill.dotColor }}
                              className="h-1.5 w-1.5 rounded-full"
                            />
                            {standing.stateCode === 'KEY_KILLED'
                              ? 'PAUSED'
                              : standing.label}
                          </span>

                          <span className="badge-accent rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                            {seatSpec.plan}
                          </span>

                          <span
                            className={`${syncPill.badgeClass} inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold`}
                          >
                            <span
                              style={{ backgroundColor: syncPill.dotColor }}
                              className="h-1.5 w-1.5 rounded-full"
                            />
                            {syncState.badgeLabel}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => openInspector(row)}
                          className="mt-2 block max-w-full truncate text-left text-sm font-bold hover:underline"
                        >
                          {identity.primary}
                        </button>

                        {identity.secondary ? (
                          <div
                            style={{ color: 'var(--text-secondary)' }}
                            className="mt-0.5 flex items-center gap-1 font-mono text-[11px]"
                          >
                            <Globe className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {identity.secondary}
                            </span>
                          </div>
                        ) : null}

                        <div
                          style={{ color: syncPill.textColor }}
                          className="mt-1 font-mono text-[10.5px]"
                        >
                          {identity.modeLabel} · {syncState.detail}
                        </div>
                      </div>
                    </div>

                    <div className="console-well grid grid-cols-2 gap-2 rounded-xl p-2.5 font-mono text-[11px]">
                      <div>
                        <span
                          style={{ color: 'var(--text-secondary)' }}
                          className="block text-[9.5px] font-semibold uppercase"
                        >
                          Deployments
                        </span>
                        <span className="font-bold">
                          {row.registered_machines} / {row.max_machines} active
                        </span>
                      </div>
                      <div>
                        <span
                          style={{ color: 'var(--text-secondary)' }}
                          className="block text-[9.5px] font-semibold uppercase"
                        >
                          Valid Until
                        </span>
                        <span
                          style={{
                            color:
                              standing.daysLeft !== null &&
                              standing.daysLeft <= 14
                                ? 'var(--warn-text)'
                                : 'var(--text-primary)',
                          }}
                          className="font-bold"
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
                        className="console-btn-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"
                      >
                        <Cpu className="h-3.5 w-3.5" />
                        Manage Clinic
                      </button>

                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleKillSwitch(row)}
                        className={`${
                          row.is_active ? 'console-btn-danger' : 'badge-success'
                        } inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold disabled:opacity-50`}
                      >
                        <Power className="h-3.5 w-3.5" />
                        {row.is_active ? 'Pause Clinic' : 'Resume Clinic'}
                      </button>
                    </div>
                  </div>
                );
              })}
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
                  {filteredRecords.map((row) => {
                    const standing = computeStanding(row);
                    const pill = buildStandingPillStyle(standing);
                    const identity = describeClinicIdentity(row);
                    const syncState = describeClientSyncState(row);
                    const syncPill = buildSyncPillStyle(syncState);
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
                              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase"
                            >
                              <span
                                style={{ backgroundColor: pill.dotColor }}
                                className="h-1.5 w-1.5 rounded-full"
                              />
                              {standing.stateCode === 'KEY_KILLED'
                                ? 'PAUSED'
                                : standing.label}
                            </span>

                            <button
                              type="button"
                              onClick={() => openInspector(row)}
                              className="truncate text-left font-bold hover:underline"
                            >
                              {identity.primary}
                            </button>
                          </div>

                          {identity.secondary ? (
                            <div
                              style={{ color: 'var(--text-secondary)' }}
                              className="mt-1 flex items-center gap-1 font-mono text-[11px]"
                            >
                              <Globe
                                style={{ color: 'var(--brand-text)' }}
                                className="h-3 w-3 shrink-0"
                              />
                              <span className="truncate">
                                {identity.secondary}
                              </span>
                            </div>
                          ) : null}

                          {row.notes ? (
                            <div className="mt-1 max-w-md">
                              <RichNotesView notes={row.notes} compact />
                            </div>
                          ) : null}
                        </td>

                        {/* Col 2: Live Client Connection & Plan Sync Receipt */}
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`${
                                syncPill.badgeClass
                              } inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold`}
                            >
                              <span
                                style={{ backgroundColor: syncPill.dotColor }}
                                className="h-1.5 w-1.5 rounded-full"
                              />
                              {syncState.badgeLabel}
                            </span>

                            <span className="console-well inline-block rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                              {identity.modeLabel}
                            </span>
                          </div>
                          <div
                            style={{ color: syncPill.textColor }}
                            className="mt-1 font-mono text-[10px] font-medium"
                          >
                            {syncState.detail}
                          </div>
                        </td>

                        {/* Col 3 */}
                        <td className="px-3 py-3.5 whitespace-nowrap">
                          <span className="badge-accent inline-block rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase">
                            {seatSpec.plan}
                          </span>
                          <div
                            style={{ color: 'var(--text-secondary)' }}
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
                              <span className="tabular-nums font-bold">
                                {row.registered_machines}/{row.max_machines}{' '}
                                seats
                              </span>
                              <div
                                style={{ backgroundColor: 'var(--bg-well)' }}
                                className="h-1.5 w-12 overflow-hidden rounded-full"
                              >
                                <div
                                  style={{
                                    width: `${Math.min(100, standing.usagePct)}%`,
                                    backgroundColor:
                                      standing.usagePct >= 100
                                        ? 'var(--warn-main)'
                                        : 'var(--ok-main)',
                                  }}
                                  className="h-full rounded-full"
                                />
                              </div>
                            </div>
                            <div
                              style={{
                                color:
                                  standing.daysLeft !== null &&
                                  standing.daysLeft <= 14
                                    ? 'var(--warn-text)'
                                    : 'var(--text-secondary)',
                              }}
                              className="mt-1 tabular-nums font-mono text-[10.5px] font-medium"
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
                              className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                            >
                              Manage
                            </button>

                            <button
                              type="button"
                              onClick={() => openClientSdk(row)}
                              title="Open myClinic Client SDK"
                              className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
                            >
                              <Blocks className="h-3.5 w-3.5" />
                              SDK
                            </button>

                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleToggleKillSwitch(row)}
                              className={`${
                                row.is_active
                                  ? 'console-btn-danger'
                                  : 'badge-success'
                              } inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50`}
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
              const refusal = syncState.refusal;
              const isRefused = syncState.state === 'refused';
              const pinned = describeClinicIdentity(inspectedRow);
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
                  {isRefused && refusal ? (
                    <div className="badge-error space-y-1 rounded-xl px-4 py-3">
                      <div className="font-mono text-[10px] font-bold tracking-wider uppercase">
                        Refused {refusal.ago} · {refusal.code}
                        {refusal.count24h > 1
                          ? ` · ${refusal.count24h} attempts in 24h`
                          : ''}
                      </div>
                      {refusal.claim ? (
                        <p className="break-words font-mono text-[11px]">
                          Client sent {refusal.claim}
                        </p>
                      ) : null}
                      <p
                        style={{ color: 'var(--danger-text)' }}
                        className="break-words font-mono text-[11px] opacity-95"
                      >
                        Pinned here: {pinned.primary}
                        {pinned.secondary ? ` · ${pinned.secondary}` : ''}
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        {refusal.hint}
                      </p>
                    </div>
                  ) : refusal && refusal.count24h > 0 ? (
                    <div className="console-well rounded-xl px-4 py-2.5">
                      <p
                        style={{ color: 'var(--text-secondary)' }}
                        className="break-words font-mono text-[10.5px]"
                      >
                        {refusal.count24h} refused attempt
                        {refusal.count24h === 1 ? '' : 's'} in the last 24h ·
                        latest {refusal.code} {refusal.ago}
                      </p>
                    </div>
                  ) : null}
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
