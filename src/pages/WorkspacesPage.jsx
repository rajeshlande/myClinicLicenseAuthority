import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Power,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { buildAdminGrantSql, rememberError } from '../lib/errors.mjs';
import { verifyRowsLanded } from '../lib/write-verify.mjs';
import {
  ACTION_LABELS,
  AUDIT_PAGE_SIZE,
  MEMBER_ROLES,
  auditRow,
  describeAuditRow,
  filterDirectoryEntries,
  isRevokeConfirmed,
  memberChangeAction,
  rotateKeyPayload,
  summarizeDirectoryEntry,
  toggleAction,
  toggleHint,
  toggleLabel,
  validateProjectUrl,
  validatePublishableKey,
  validateRole,
  validateUserId,
} from '../lib/workspace-console.mjs';

/**
 * T5 · §14 operator console — the privileged half.
 *
 * This is the only surface that lists the clinic directory and mutates it, so it is
 * the fifth (and newest) entry in check-admin-static's DIRECTORY_AUTHORITY_ALLOWLIST:
 * invariant D confines the directory terms to Master-side modules, and a new file
 * naming them is exactly what the ratchet exists to catch. The decisions — audit
 * vocabulary, key masking, validation — live in src/lib/workspace-console.mjs, which
 * names none of them and needs no allowlist entry.
 *
 * Two rules shape every handler below:
 *
 * 1. NO WRITE IS REPORTED UNTIL ITS ROW COUNT IS PROVEN. Central's RLS refuses a
 *    non-admin UPDATE/DELETE SILENTLY ({ data: null, error: null }), so `error` alone
 *    would let this page announce a clinic was deactivated when nothing happened.
 *    Every chain ends in .select(...) + verifyRowsLanded(...) — which is also what
 *    scripts/check-write-verify.mjs (T1) now enforces in CI for these tables.
 *
 * 2. EVERY ACTION LEAVES ATTRIBUTION. Each write is followed by an append to
 *    workspace_audit_log (schema v8), itself a verified write: the append policy is
 *    WITH CHECK, so a non-admin's insert stores nothing and must not be reported as
 *    recorded history. Revocation deletes the directory row, so its audit entry
 *    carries workspace_id = null and the slug instead — the trail outlives the row.
 */

// Table names are written as LITERALS at every call site, never as constants:
// scripts/check-write-verify.mjs matches `.from('<table>')` textually, so a
// constant would hide the write from the ratchet instead of being checked by it.

const TABS = Object.freeze([
  { id: 'directory', label: 'Directory & keys', icon: Power },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'audit', label: 'Audit trail', icon: ScrollText },
]);

/** Raw directory row -> the neutral shape the pure half accepts. */
function toDirectoryEntry(row) {
  return {
    id: row?.id ?? '',
    clinicName: row?.clinic_name ?? '',
    slug: row?.slug ?? '',
    projectUrl: row?.supabase_url ?? '',
    publishableKey: row?.supabase_anon_key ?? '',
    isActive: Boolean(row?.is_active),
    tenantSchemaVersion: row?.tenant_schema_version ?? 0,
    keepWarmAt: row?.keep_warm_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

const stamp = (value) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function WorkspacesPage({ backend, operatorEmail = '' }) {
  const supabase = backend?.supabase ?? null;

  const [rows, setRows] = useState([]);
  const [members, setMembers] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('directory');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [banner, setBanner] = useState(null);
  const [notice, setNotice] = useState(null);
  const [rotateForm, setRotateForm] = useState({ key: '', url: '', reason: '' });
  const [revokeTyped, setRevokeTyped] = useState('');
  const [memberForm, setMemberForm] = useState({ userId: '', role: 'staff' });

  const entries = useMemo(
    () => rows.map((row) => summarizeDirectoryEntry(toDirectoryEntry(row))),
    [rows],
  );
  const visible = useMemo(() => filterDirectoryEntries(entries, query), [entries, query]);
  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const selectedRaw = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const loadDetail = useCallback(
    async (entry) => {
      if (!supabase || !entry?.id) {
        setMembers([]);
        setAuditRows([]);
        return;
      }
      const [memberResult, auditResult] = await Promise.all([
        supabase.from('workspace_members').select('*').eq('workspace_id', entry.id),
        // The slug half of this filter is what still finds a revocation after the
        // directory row is gone (workspace_id is set null by the v8 foreign key).
        supabase
          .from('workspace_audit_log')
          .select('*')
          .or(`workspace_id.eq.${entry.id},workspace_slug.eq.${entry.slug}`)
          .order('at', { ascending: false })
          .limit(AUDIT_PAGE_SIZE),
      ]);
      if (memberResult.error) throw memberResult.error;
      if (auditResult.error) throw auditResult.error;
      setMembers(memberResult.data ?? []);
      setAuditRows(auditResult.data ?? []);
    },
    [supabase],
  );

  const load = useCallback(
    async ({ silent = false, keepSelection = true } = {}) => {
      if (!supabase) {
        setLoading(false);
        setBanner({
          message: 'Central Supabase is not configured, so there is no directory to show.',
          fix: 'Open Settings & Health and set the Central project URL and publishable key.',
        });
        return;
      }
      if (!silent) setLoading(true);
      setRefreshing(true);
      try {
        const result = await supabase.from('workspaces').select('*').order('clinic_name');
        if (result.error) throw result.error;
        const next = result.data ?? [];
        setRows(next);
        setBanner(null);
        if (!keepSelection || !next.some((row) => row.id === selectedId)) {
          setSelectedId(next[0]?.id ?? null);
        }
      } catch (err) {
        setBanner(rememberError(err, 'Load the clinic directory'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase, selectedId],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (!selected) return;
    setRotateForm({ key: '', url: selected.projectUrl, reason: '' });
    setRevokeTyped('');
    setMemberForm({ userId: '', role: 'staff' });
    loadDetail(selected).catch((err) => setBanner(rememberError(err, 'Load clinic detail')));
  }, [selected, loadDetail]);

  /**
   * One verified append to the audit trail. Throws when the row did not land, so a
   * caller can never report an action as recorded when RLS swallowed it.
   */
  const appendAudit = useCallback(
    async ({ action, entry, workspaceId = null, payload = {} }) => {
      const built = auditRow({
        action,
        slug: entry.slug,
        actor: operatorEmail,
        payload,
        workspaceId,
      });
      if (!built.ok) throw new Error(built.reason);
      const logged = await supabase.from('workspace_audit_log').insert(built.value).select('id');
      if (logged.error) throw logged.error;
      verifyRowsLanded(logged, {
        action: `Record "${ACTION_LABELS[action] ?? action}" in the audit trail`,
        table: 'workspace_audit_log',
      });
      return logged;
    },
    [operatorEmail, supabase],
  );

  const runAction = useCallback(async (label, fn) => {
    setBusy(label);
    setBanner(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setBanner(rememberError(err, label));
    } finally {
      setBusy(null);
    }
  }, []);

  const handleToggleActive = (entry) =>
    runAction(`${toggleLabel(entry.isActive)} ${entry.slug}`, async () => {
      const nextActive = !entry.isActive;
      const updated = await supabase
        .from('workspaces')
        .update({ is_active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', entry.id)
        .select('id');
      if (updated.error) throw updated.error;
      verifyRowsLanded(updated, {
        action: `${toggleLabel(entry.isActive)} clinic`,
        table: 'workspaces',
      });
      await appendAudit({
        action: toggleAction(entry.isActive),
        entry,
        workspaceId: entry.id,
        payload: { is_active: nextActive },
      });
      await load({ silent: true });
      setNotice(
        `${entry.clinicName} ${
          nextActive ? 'is served by the directory again' : 'is dark in the directory'
        } — recorded against ${operatorEmail || 'this session'}.`,
      );
    });

  const handleRotateKey = (entry) =>
    runAction(`Rotate the publishable key for ${entry.slug}`, async () => {
      const keyCheck = validatePublishableKey(rotateForm.key);
      if (!keyCheck.ok) throw new Error(keyCheck.reason);
      const urlCheck = validateProjectUrl(rotateForm.url || entry.projectUrl);
      if (!urlCheck.ok) throw new Error(urlCheck.reason);
      const evidence = rotateKeyPayload({
        previousKey: selectedRaw?.supabase_anon_key ?? '',
        nextKey: keyCheck.value,
        reason: rotateForm.reason,
      });
      if (!evidence.ok) throw new Error(evidence.reason);
      const rotated = await supabase
        .from('workspaces')
        .update({
          supabase_anon_key: keyCheck.value,
          supabase_url: urlCheck.value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
        .select('id');
      if (rotated.error) throw rotated.error;
      verifyRowsLanded(rotated, {
        action: 'Rotate the publishable key',
        table: 'workspaces',
      });
      await appendAudit({
        action: 'workspace_key_rotated',
        entry,
        workspaceId: entry.id,
        payload: evidence.value,
      });
      setRotateForm({ key: '', url: urlCheck.value, reason: '' });
      await load({ silent: true });
      setNotice(
        `Key rotated for ${entry.clinicName}: the directory now serves …${evidence.value.next_key_tail}. Clients revalidate on their next boot (C6).`,
      );
    });

  const handleRevoke = (entry) =>
    runAction(`Revoke ${entry.slug}`, async () => {
      if (!isRevokeConfirmed(entry.slug, revokeTyped)) {
        throw new Error(
          `Type the slug "${entry.slug}" to confirm. Revoking DELETES the directory row — that is not the same as deactivating it.`,
        );
      }
      const deleted = await supabase
        .from('workspaces')
        .delete()
        .eq('id', entry.id)
        .select('id');
      if (deleted.error) throw deleted.error;
      verifyRowsLanded(deleted, { action: 'Revoke the clinic', table: 'workspaces' });
      // The row no longer exists, so the audit entry cannot point at it: v8 sets
      // workspace_id null and the slug carries the attribution.
      await appendAudit({
        action: 'workspace_revoked',
        entry,
        workspaceId: null,
        payload: { members_at_revoke: members.length },
      });
      setRevokeTyped('');
      setSelectedId(null);
      await load({ silent: true, keepSelection: false });
      setNotice(
        `${entry.clinicName} (${entry.slug}) was deleted from the directory. Its public booking link now fails closed, and the revocation is attributed in the audit trail.`,
      );
    });

  const handleAddMember = (entry) =>
    runAction(`Add a member to ${entry.slug}`, async () => {
      const idCheck = validateUserId(memberForm.userId);
      if (!idCheck.ok) throw new Error(idCheck.reason);
      const roleCheck = validateRole(memberForm.role);
      if (!roleCheck.ok) throw new Error(roleCheck.reason);
      const inserted = await supabase
        .from('workspace_members')
        .insert({ workspace_id: entry.id, user_id: idCheck.value, role: roleCheck.value })
        .select('user_id');
      if (inserted.error) throw inserted.error;
      verifyRowsLanded(inserted, { action: 'Add a clinic member', table: 'workspace_members' });
      await appendAudit({
        action: 'member_added',
        entry,
        workspaceId: entry.id,
        payload: { user_id: idCheck.value, role: roleCheck.value },
      });
      setMemberForm({ userId: '', role: 'staff' });
      await loadDetail(entry);
      setNotice(`Member ${idCheck.value.slice(0, 8)}… added as ${roleCheck.value}.`);
    });

  const handleChangeRole = (entry, member, nextRole) =>
    runAction(`Change the role of ${String(member.user_id).slice(0, 8)}…`, async () => {
      const roleCheck = validateRole(nextRole);
      if (!roleCheck.ok) throw new Error(roleCheck.reason);
      const action = memberChangeAction({
        existed: true,
        previousRole: member.role,
        nextRole: roleCheck.value,
      });
      // A no-op is not an event: logging one would bury the changes that matter.
      if (!action) {
        setNotice('That member already holds this role — nothing was written.');
        return;
      }
      const updated = await supabase
        .from('workspace_members')
        .update({ role: roleCheck.value })
        .eq('workspace_id', entry.id)
        .eq('user_id', member.user_id)
        .select('user_id');
      if (updated.error) throw updated.error;
      verifyRowsLanded(updated, { action: 'Change a clinic member role', table: 'workspace_members' });
      await appendAudit({
        action,
        entry,
        workspaceId: entry.id,
        payload: { user_id: member.user_id, from: member.role, to: roleCheck.value },
      });
      await loadDetail(entry);
      setNotice(`Role changed from ${member.role} to ${roleCheck.value}.`);
    });

  const handleRemoveMember = (entry, member) =>
    runAction(`Remove ${String(member.user_id).slice(0, 8)}… from ${entry.slug}`, async () => {
      const deleted = await supabase
        .from('workspace_members')
        .delete()
        .eq('workspace_id', entry.id)
        .eq('user_id', member.user_id)
        .select('user_id');
      if (deleted.error) throw deleted.error;
      verifyRowsLanded(deleted, { action: 'Remove a clinic member', table: 'workspace_members' });
      await appendAudit({
        action: 'member_removed',
        entry,
        workspaceId: entry.id,
        payload: { user_id: member.user_id, role: member.role },
      });
      await loadDetail(entry);
      setNotice(
        'Member removed here. Their tenant-side membership is a separate row: run the §14 revoke-a-user runbook on that clinic project too, or their cached access survives until the next revalidation.',
      );
    });

  const adminHint = useMemo(
    () => (entries.length === 0 && !loading && !banner ? buildAdminGrantSql(operatorEmail) : ''),
    [entries.length, loading, banner, operatorEmail],
  );

  if (loading) {
    return (
      <div
        style={{ color: 'var(--text-secondary)' }}
        className="flex min-h-[280px] items-center justify-center gap-2.5 text-xs font-medium"
      >
        <div
          style={{ borderColor: 'var(--border-strong)', borderTopColor: 'var(--brand-primary)' }}
          className="h-4 w-4 animate-spin rounded-full border-2"
        />
        <span>Loading the clinic directory…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banner ? (
        <div className="badge-error rounded-2xl px-4 py-3 text-xs font-semibold">
          {banner.message}
          {banner.fix ? (
            <span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-normal">
              {banner.fix}
            </span>
          ) : null}
          {adminHint ? (
            <pre
              style={{ borderColor: 'var(--border-subtle)' }}
              className="mt-2 overflow-x-auto rounded-xl border p-2 text-[11px] font-normal"
            >
              {adminHint}
            </pre>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          className="rounded-2xl border px-4 py-3 text-xs"
        >
          {notice}
        </div>
      ) : null}

      {adminHint && !banner ? (
        <div className="badge-error rounded-2xl px-4 py-3 text-xs font-semibold">
          <ShieldAlert className="mr-1.5 inline h-4 w-4" />
          The directory looks empty. Central's RLS hides every row from an account that is
          neither a licence admin nor a member, and it does so silently — so an empty list is
          also what a non-admin sees. Confirm this session holds
          <code className="mx-1">app_metadata.role = 'admin'</code>
          before concluding there are no clinics:
          <pre
            style={{ borderColor: 'var(--border-subtle)' }}
            className="mt-2 overflow-x-auto rounded-xl border p-2 text-[11px] font-normal"
          >
            {adminHint}
          </pre>
        </div>
      ) : null}

      <section className="console-panel overflow-hidden rounded-2xl">
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex flex-wrap items-center justify-between gap-2.5 p-3.5 sm:p-4"
        >
          <div>
            <h2 className="text-sm font-bold tracking-tight">Workspace Directory</h2>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-0.5 text-xs">
              {entries.length} clinic{entries.length === 1 ? '' : 's'} ·{' '}
              {entries.filter((entry) => entry.isActive).length} active · §14 operator actions,
              every one attributed in the audit trail (schema v8)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label
              style={{ borderColor: 'var(--border-strong)' }}
              className="flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5"
            >
              <Search className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name or slug"
                className="w-40 bg-transparent text-xs outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void load({ silent: true })}
              disabled={Boolean(busy) || refreshing}
              className="btn-ghost rounded-xl px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(240px,320px)_1fr]">
          <div
            style={{ borderRight: '1px solid var(--border-subtle)' }}
            className="max-h-[560px] overflow-y-auto p-2"
          >
            {visible.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }} className="p-3 text-xs">
                No clinic matches “{query || '…'}”. Clinics are created by onboarding a
                subscription or by <code>scripts/provision-tenant.mjs</code>.
              </p>
            ) : null}
            {visible.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                style={{
                  borderColor:
                    entry.id === selectedId ? 'var(--brand-primary)' : 'var(--border-subtle)',
                }}
                className="mb-1.5 w-full rounded-xl border px-3 py-2 text-left"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold">{entry.clinicName}</span>
                  <span
                    className={entry.isActive ? 'badge-success shrink-0' : 'badge-error shrink-0'}
                  >
                    {entry.isActive ? 'active' : 'dark'}
                  </span>
                </span>
                <span style={{ color: 'var(--text-secondary)' }} className="mt-0.5 block text-[11px]">
                  {entry.slug} · tenant v{entry.tenantSchemaVersion}
                  {entry.schemaCurrent ? '' : ' (behind)'} · warm:{' '}
                  {entry.keepWarm === 'never' ? 'never probed' : entry.keepWarm}
                </span>
              </button>
            ))}
          </div>

          <div className="p-3.5 sm:p-4">
            {!selected ? (
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                Select a clinic to operate on it.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {TABS.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setTab(entry.id)}
                        className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold ${
                          tab === entry.id ? 'btn-primary' : 'btn-ghost'
                        }`}
                      >
                        <Icon className="mr-1 inline h-3.5 w-3.5" />
                        {entry.label}
                      </button>
                    );
                  })}
                </div>

                {tab === 'directory' ? (
                  <div className="mt-3 space-y-3">
                    <dl className="grid gap-2 text-xs sm:grid-cols-2">
                      {[
                        ['Clinic', selected.clinicName],
                        ['Slug', selected.slug],
                        ['Project URL', selected.projectUrl || '— not published'],
                        ['Publishable key', selected.keyTail || '— none stored'],
                        ['Tenant schema', `v${selected.tenantSchemaVersion}`],
                        ['Last keep-warm', stamp(selected.keepWarmAt)],
                        ['Updated', stamp(selected.updatedAt)],
                        ['State', selected.isActive ? 'active' : 'dark (fails closed)'],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          style={{ borderColor: 'var(--border-subtle)' }}
                          className="rounded-xl border px-3 py-2"
                        >
                          <dt style={{ color: 'var(--text-secondary)' }} className="text-[11px]">
                            {label}
                          </dt>
                          <dd className="mt-0.5 break-all font-semibold">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    <div style={{ borderColor: 'var(--border-subtle)' }} className="rounded-xl border p-3">
                      <h3 className="text-xs font-bold">
                        <Power className="mr-1 inline h-3.5 w-3.5" />
                        {toggleLabel(selected.isActive)} this clinic
                      </h3>
                      <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-[11px]">
                        {toggleHint(selected.isActive)}
                      </p>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void handleToggleActive(selected)}
                        className="btn-ghost mt-2 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {busy === `${toggleLabel(selected.isActive)} ${selected.slug}`
                          ? 'Writing…'
                          : `${toggleLabel(selected.isActive)} ${selected.slug}`}
                      </button>
                    </div>

                    <div style={{ borderColor: 'var(--border-subtle)' }} className="rounded-xl border p-3">
                      <h3 className="text-xs font-bold">
                        <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                        Rotate the publishable key
                      </h3>
                      <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-[11px]">
                        §14: rotate the key in the clinic's own Supabase project first, then paste
                        the new publishable key here. Only the last 6 characters are ever recorded —
                        the audit trail refuses to store a key literal, and so does the database.
                      </p>
                      <div className="mt-2 grid gap-2">
                        <input
                          value={rotateForm.key}
                          onChange={(event) =>
                            setRotateForm({ ...rotateForm, key: event.target.value })
                          }
                          placeholder="New publishable key (sb_publishable_…)"
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        />
                        <input
                          value={rotateForm.url}
                          onChange={(event) =>
                            setRotateForm({ ...rotateForm, url: event.target.value })
                          }
                          placeholder="Project URL (https://<ref>.supabase.co)"
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        />
                        <input
                          value={rotateForm.reason}
                          onChange={(event) =>
                            setRotateForm({ ...rotateForm, reason: event.target.value })
                          }
                          placeholder="Reason (leak, scheduled rotation, …)"
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          disabled={Boolean(busy) || !rotateForm.key.trim()}
                          onClick={() => void handleRotateKey(selected)}
                          className="btn-ghost justify-self-start rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Rotate key
                        </button>
                      </div>
                    </div>

                    <div
                      style={{ borderColor: 'var(--border-strong)' }}
                      className="rounded-xl border p-3"
                    >
                      <h3 className="text-xs font-bold">
                        <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                        Revoke — delete the directory row
                      </h3>
                      <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-[11px]">
                        Revoke is NOT deactivate. The row, its member rows and its cascade go; the
                        public booking link then fails closed (§8.4 proved the difference). Type the
                        slug to confirm.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          value={revokeTyped}
                          onChange={(event) => setRevokeTyped(event.target.value)}
                          placeholder={selected.slug}
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          disabled={Boolean(busy) || !isRevokeConfirmed(selected.slug, revokeTyped)}
                          onClick={() => void handleRevoke(selected)}
                          className="btn-danger rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Revoke {selected.slug}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === 'members' ? (
                  <div className="mt-3 space-y-3">
                    <div style={{ borderColor: 'var(--border-subtle)' }} className="rounded-xl border p-3">
                      <h3 className="text-xs font-bold">
                        <UserPlus className="mr-1 inline h-3.5 w-3.5" />
                        Add a member
                      </h3>
                      <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-[11px]">
                        D6-A: staff are invite-only users of the CENTRAL project, so this takes a
                        Central Auth user UUID. Adding the row here does not create the login —
                        invite the user in Authentication → Users first.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          value={memberForm.userId}
                          onChange={(event) =>
                            setMemberForm({ ...memberForm, userId: event.target.value })
                          }
                          placeholder="00000000-0000-0000-0000-000000000000"
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="min-w-[260px] flex-1 rounded-xl border px-2.5 py-1.5 text-xs"
                        />
                        <select
                          value={memberForm.role}
                          onChange={(event) =>
                            setMemberForm({ ...memberForm, role: event.target.value })
                          }
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2.5 py-1.5 text-xs"
                        >
                          {MEMBER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void handleAddMember(selected)}
                          className="btn-ghost rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Add member
                        </button>
                      </div>
                    </div>

                    {members.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                        No member rows. A clinic with no members is still bookable by the public
                        link — membership only governs who can sign in and see it.
                      </p>
                    ) : null}
                    {members.map((member) => (
                      <div
                        key={member.user_id}
                        style={{ borderColor: 'var(--border-subtle)' }}
                        className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                      >
                        <code className="break-all">{member.user_id}</code>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          granted {stamp(member.granted_at)}
                        </span>
                        <select
                          value={member.role}
                          onChange={(event) =>
                            void handleChangeRole(selected, member, event.target.value)
                          }
                          disabled={Boolean(busy)}
                          style={{ borderColor: 'var(--border-strong)' }}
                          className="rounded-xl border px-2 py-1 text-xs"
                        >
                          {MEMBER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void handleRemoveMember(selected, member)}
                          className="btn-danger ml-auto rounded-xl px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {tab === 'audit' ? (
                  <div className="mt-3 space-y-2">
                    <p style={{ color: 'var(--text-secondary)' }} className="text-[11px]">
                      Newest first, up to {AUDIT_PAGE_SIZE} rows. Append-only in the database: no
                      role — not even an admin — can edit or delete this history. Rows whose clinic
                      was revoked keep their slug and show as detached.
                    </p>
                    {auditRows.length === 0 ? (
                      <p className="text-xs">
                        No audit rows for this clinic yet. Every action on this page writes one.
                      </p>
                    ) : null}
                    {auditRows.map((row) => {
                      const described = describeAuditRow(row);
                      return (
                        <div
                          key={described.id}
                          style={{ borderColor: 'var(--border-subtle)' }}
                          className="rounded-xl border px-3 py-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <ScrollText className="h-3.5 w-3.5" />
                            <span className="font-bold">{described.label}</span>
                            {described.detached ? (
                              <span className="badge-error">clinic revoked</span>
                            ) : null}
                            <span style={{ color: 'var(--text-secondary)' }} className="ml-auto">
                              {stamp(described.at)}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }} className="mt-1 text-[11px]">
                            by {described.actor}
                            {described.detail ? ` · ${described.detail}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
