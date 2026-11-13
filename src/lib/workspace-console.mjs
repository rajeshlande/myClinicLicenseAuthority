/**
 * T5 · §14 operator console — the PURE half.
 *
 * Everything here decides what an operator action MEANS: the closed audit
 * vocabulary, the shapes it accepts, and how a clinic's publishable key is
 * reduced to something safe to store. No client and no query live in this file —
 * that half is `src/pages/WorkspacesPage.jsx`, the single module the
 * directory-authority allowlist covers (check-admin-static invariant D). Splitting
 * them is what makes the vocabulary testable without a database, and it keeps the
 * privileged surface at ONE new file instead of two.
 *
 * §14 standing rule: never log a clinic's publishable key or a token. The database
 * enforces that too — the v8 audit table's payload CHECK refuses a key or JWT
 * literal — so `isSafeAuditPayload` is a pre-flight, not the authority: a UI bug
 * still cannot leak a credential into the trail.
 *
 * Rows arrive here already renamed to neutral camelCase fields by the page, so no
 * privileged column name appears in this module at all.
 */
import {
  DIRECTORY_ROLES,
  FORBIDDEN_TENANT_KEY_PATTERN,
  KEEP_WARM,
  TENANT_SCHEMA_VERSION,
  TENANT_SUPABASE_URL_PATTERN,
  WORKSPACE_SLUG_PATTERN,
} from './workspace-directory.mjs';

/**
 * The closed audit vocabulary. It mirrors the CHECK on `workspace_audit_log`
 * (schema v8) exactly; tests/workspace-console.test.mjs parses supabase/schema.sql
 * and compares, so the two lists can never drift apart silently.
 */
export const AUDIT_ACTIONS = Object.freeze([
  'workspace_deactivated',
  'workspace_reactivated',
  'workspace_key_rotated',
  'workspace_revoked',
  'member_added',
  'member_role_changed',
  'member_removed',
]);

/** Operator-facing wording. "Deactivate" is not "revoke" — §8.4 proved the
 *  difference: a deactivated clinic comes back, a revoked one is deleted and its
 *  public booking link still resolves until the row is gone. */
export const ACTION_LABELS = Object.freeze({
  workspace_deactivated: 'Deactivated — directory dark, restorable',
  workspace_reactivated: 'Reactivated — serving again',
  workspace_key_rotated: 'Publishable key rotated',
  workspace_revoked: 'Revoked — directory row deleted',
  member_added: 'Member added',
  member_role_changed: 'Member role changed',
  member_removed: 'Member removed',
});

export const MEMBER_ROLES = DIRECTORY_ROLES;
export const KEY_TAIL_LENGTH = 6;
export const AUDIT_PAGE_SIZE = 25;

/** The same literals the v8 payload CHECK refuses. Kept as a source string so a
 *  test can assert the JS pre-flight and the SQL constraint agree. */
export const FORBIDDEN_PAYLOAD_PATTERN =
  'sb_secret|service_role|sb_publishable|eyJ[A-Za-z0-9_-]{10,}';

const FORBIDDEN_PAYLOAD_RE = new RegExp(FORBIDDEN_PAYLOAD_PATTERN, 'i');
const FORBIDDEN_KEY_RE = new RegExp(FORBIDDEN_TENANT_KEY_PATTERN, 'i');
const SLUG_RE = new RegExp(WORKSPACE_SLUG_PATTERN);
const URL_RE = new RegExp(TENANT_SUPABASE_URL_PATTERN);

const ok = (value) => Object.freeze({ ok: true, value });
const no = (reason) => Object.freeze({ ok: false, reason });

/**
 * Would the database accept this payload? Serialises the same way Postgres would
 * see it (a JSON string) and applies the v8 CHECK.
 */
export function isSafeAuditPayload(payload) {
  let text;
  try {
    text = JSON.stringify(payload ?? {});
  } catch {
    return false;
  }
  return typeof text === 'string' && !FORBIDDEN_PAYLOAD_RE.test(text);
}

/**
 * The only part of a publishable key that may ever be stored or displayed: its
 * last 6 characters, prefixed with an ellipsis. '' when there is no key.
 */
export function keyTail(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `…${text.slice(-KEY_TAIL_LENGTH)}`;
}

export function validateSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!slug) return no('A slug is required.');
  if (!SLUG_RE.test(slug)) {
    return no(
      'Slug must be 3-40 characters, lowercase letters, digits or hyphens, and must start and end alphanumeric.',
    );
  }
  return ok(slug);
}

export function validateProjectUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return no('The clinic project URL is required to publish it.');
  if (!URL_RE.test(url)) {
    return no('Expected https://<project-ref>.supabase.co — nothing else is accepted.');
  }
  return ok(url.replace(/\/$/, ''));
}

/**
 * A publishable key is safe to STORE (it is public by design, C1) but must never be
 * a privileged one. The database column carries the same CHECK.
 */
export function validatePublishableKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return no('A publishable key is required.');
  if (FORBIDDEN_KEY_RE.test(key)) {
    return no(
      'That looks like a privileged key (service_role / sb_secret). Only a publishable key may be stored — a privileged key would hand the whole clinic project to the browser.',
    );
  }
  if (key.length < 20) return no('That is too short to be a project key.');
  return ok(key);
}

const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A member is identified by their Central Auth UUID (D6-A: staff are invite-only
 * users of the Central project, so there is no email lookup to offer here). The
 * column is a bare uuid with no foreign key, so a typo would otherwise store a
 * member row nobody can ever sign in as.
 */
export function validateUserId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!USER_ID_RE.test(id)) {
    return no(
      'Expected the Central Auth user UUID (Authentication → Users → copy user UID).',
    );
  }
  return ok(id);
}

export function validateRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!MEMBER_ROLES.includes(role)) {
    return no(`Role must be one of: ${MEMBER_ROLES.join(', ')}.`);
  }
  return ok(role);
}

/**
 * Revoking deletes the directory row, so it is confirmed by typing the slug —
 * the same shape as the §8.4 rehearsal, where a mistyped confirmation must do
 * nothing rather than take a clinic dark.
 */
export function isRevokeConfirmed(slug, typed) {
  const want = String(slug ?? '').trim().toLowerCase();
  const got = String(typed ?? '').trim().toLowerCase();
  return Boolean(want) && want === got;
}

/** Deactivate and reactivate are one toggle; only the audit verb differs. */
export function toggleAction(isActive) {
  return isActive ? 'workspace_deactivated' : 'workspace_reactivated';
}

export function toggleLabel(isActive) {
  return isActive ? 'Deactivate' : 'Reactivate';
}

export function toggleHint(isActive) {
  return isActive
    ? 'Directory goes dark at once: discovery stops returning this clinic and its public booking link fails closed. Nothing is deleted, and existing sessions lose the clinic on their next revalidation.'
    : 'The clinic is served again by discovery and by the anonymous booking directory.';
}

/**
 * Keep-warm state, from the contract cadence (pause_days 7, target_days 5): a row
 * that has never been probed, one that is due, and one that is warm.
 */
export function keepWarmState(keepWarmAt, now = Date.now()) {
  if (!keepWarmAt) return 'never';
  const stamped = new Date(keepWarmAt).getTime();
  if (!Number.isFinite(stamped)) return 'never';
  const ageDays = (now - stamped) / 86_400_000;
  if (ageDays >= Number(KEEP_WARM.target_days ?? 5)) return 'due';
  return 'warm';
}

/** The display shape for one directory entry (neutral field names in, view out). */
export function summarizeDirectoryEntry(entry, now = Date.now()) {
  const {
    id = '',
    clinicName = '',
    slug = '',
    projectUrl = '',
    publishableKey = '',
    isActive = false,
    tenantSchemaVersion = 0,
    keepWarmAt = null,
    updatedAt = null,
  } = entry ?? {};
  const version = Number(tenantSchemaVersion) || 0;
  return Object.freeze({
    id,
    clinicName: String(clinicName),
    slug: String(slug),
    projectUrl: String(projectUrl ?? ''),
    isActive: Boolean(isActive),
    published: Boolean(projectUrl) && Boolean(publishableKey),
    keyTail: keyTail(publishableKey),
    tenantSchemaVersion: version,
    schemaCurrent: version === Number(TENANT_SCHEMA_VERSION),
    keepWarm: keepWarmState(keepWarmAt, now),
    keepWarmAt,
    updatedAt,
  });
}

/** Case-insensitive name/slug filter, then a stable name sort. */
export function filterDirectoryEntries(entries, query = '') {
  const needle = String(query ?? '').trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  const filtered = needle
    ? list.filter(
        (entry) =>
          String(entry.clinicName ?? '').toLowerCase().includes(needle) ||
          String(entry.slug ?? '').toLowerCase().includes(needle),
      )
    : [...list];
  return filtered.sort((a, b) =>
    String(a.clinicName ?? '').localeCompare(String(b.clinicName ?? '')),
  );
}

/**
 * Which audit verb a member edit deserves. `previousRole === null` means the row
 * did not exist; an unchanged role is not an event and must not be logged, because
 * a trail full of no-ops hides the ones that matter.
 */
export function memberChangeAction({ existed, previousRole = null, nextRole }) {
  if (!existed) return 'member_added';
  if (String(previousRole ?? '') === String(nextRole ?? '')) return null;
  return 'member_role_changed';
}

/**
 * Rotation evidence: the two tails and the operator's reason. The keys themselves
 * are never included — and `isSafeAuditPayload` proves it before anything is sent.
 */
export function rotateKeyPayload({ previousKey = '', nextKey = '', reason = '' } = {}) {
  const payload = {
    previous_key_tail: keyTail(previousKey).replace('…', ''),
    next_key_tail: keyTail(nextKey).replace('…', ''),
    reason: String(reason ?? '').slice(0, 200),
  };
  return isSafeAuditPayload(payload)
    ? ok(payload)
    : no('Refusing to record this rotation: the evidence would contain a key literal.');
}

/**
 * Build one audit row, refusing anything the vocabulary or the payload CHECK would
 * reject. The page sends the result straight to the database; a refusal here means
 * no write is attempted at all.
 */
export function auditRow({ action, slug, actor = '', payload = {}, workspaceId = null }) {
  if (!AUDIT_ACTIONS.includes(action)) {
    return no(`'${action}' is not part of the audit vocabulary.`);
  }
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) return no(slugCheck.reason);
  if (!isSafeAuditPayload(payload)) {
    return no('Refusing to record this action: the evidence would contain a key or token literal.');
  }
  return ok(
    Object.freeze({
      workspace_id: workspaceId ?? null,
      workspace_slug: slugCheck.value,
      action,
      actor: String(actor ?? '').slice(0, 254),
      payload: { ...payload },
    }),
  );
}

/** One trail row as the operator reads it. */
export function describeAuditRow(row) {
  const action = String(row?.action ?? '');
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const detail = Object.entries(payload)
    .filter(([key]) => key !== 'probe')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
  return Object.freeze({
    id: row?.id ?? '',
    action,
    label: ACTION_LABELS[action] ?? action,
    actor: String(row?.actor ?? '') || 'unknown operator',
    slug: String(row?.workspace_slug ?? ''),
    at: row?.at ?? null,
    detail,
    detached: row?.workspace_id === null || row?.workspace_id === undefined,
  });
}
