import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  FORBIDDEN_PAYLOAD_PATTERN,
  KEY_TAIL_LENGTH,
  MEMBER_ROLES,
  auditRow,
  describeAuditRow,
  filterDirectoryEntries,
  isRevokeConfirmed,
  isSafeAuditPayload,
  keepWarmState,
  memberChangeAction,
  rotateKeyPayload,
  summarizeDirectoryEntry,
  toggleAction,
  toggleHint,
  toggleLabel,
  validateProjectUrl,
  validatePublishableKey,
  validateRole,
  validateSlug,
  validateUserId,
} from '../src/lib/workspace-console.mjs';
import {
  DIRECTORY_ROLES,
  KEEP_WARM,
  TENANT_SCHEMA_VERSION,
} from '../src/lib/workspace-directory.mjs';
import { DIRECTORY_AUTHORITY_ALLOWLIST } from '../scripts/check-admin-static.mjs';
import { PRIVILEGED_TABLES, findWriteSites } from '../scripts/check-write-verify.mjs';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');
const pagePath = 'src/pages/WorkspacesPage.jsx';
const page = readFileSync(pagePath, 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const shell = readFileSync('src/components/AppShell.jsx', 'utf8');

/** The DDL of the v8 audit table, so the JS vocabulary can be compared to SQL. */
function auditDdl() {
  const start = schemaSql.indexOf('create table if not exists public.workspace_audit_log');
  assert.ok(start > -1, 'the v8 audit table is missing from supabase/schema.sql');
  return schemaSql.slice(start, schemaSql.indexOf('\n);', start));
}

const KEY = 'sb_publishable_abcdefghijklmnopqrstuvwxyz012345';

test('T5: the audit vocabulary in JS is the CHECK in SQL — they cannot drift', () => {
  const ddl = auditDdl();
  const sqlActions = [...ddl.matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1])
    .filter((a) => a.startsWith('workspace_') || a.startsWith('member_'));
  assert.deepEqual([...AUDIT_ACTIONS].sort(), [...new Set(sqlActions)].sort());
  assert.equal(AUDIT_ACTIONS.length, 7, 'four §14 runbook actions plus three member edits');
  for (const action of AUDIT_ACTIONS) {
    assert.ok(ACTION_LABELS[action], `every action has operator-facing wording: ${action}`);
  }
  // The masking rule is enforced twice: here as a pre-flight, in SQL as the authority.
  const sqlPattern = /payload::text !~\* '([^']+)'/.exec(ddl)?.[1];
  assert.equal(FORBIDDEN_PAYLOAD_PATTERN, sqlPattern);
});

test('T5: a publishable key is reduced to a tail, and never survives into the view', () => {
  const tail = summarizeDirectoryEntry({
    id: 'w1',
    clinicName: 'Sunrise OPD',
    slug: 'sunrise-demo',
    projectUrl: 'https://sunrise-demo.supabase.co',
    publishableKey: KEY,
    isActive: true,
    tenantSchemaVersion: TENANT_SCHEMA_VERSION,
  });
  assert.equal(tail.keyTail, `…${KEY.slice(-KEY_TAIL_LENGTH)}`);
  assert.ok(tail.keyTail.length <= KEY_TAIL_LENGTH + 1);
  assert.ok(
    !JSON.stringify(tail).includes(KEY),
    'the view model must not carry the key — only its tail (§14: never log it)',
  );
  assert.equal(tail.published, true);
  assert.equal(tail.schemaCurrent, true);
  assert.equal(
    summarizeDirectoryEntry({ tenantSchemaVersion: TENANT_SCHEMA_VERSION - 1 }).schemaCurrent,
    false,
    'a tenant behind the template is flagged, not silently accepted',
  );
  assert.equal(summarizeDirectoryEntry({}).keyTail, '');
  assert.equal(summarizeDirectoryEntry({}).published, false);
});

test('T5: the payload pre-flight refuses exactly what the database refuses', () => {
  assert.equal(isSafeAuditPayload({ key_tail: KEY.slice(-6), reason: 'leak' }), true);
  assert.equal(isSafeAuditPayload({ key: KEY }), false, 'a publishable key literal');
  assert.equal(isSafeAuditPayload({ key: 'sb_secret_xxxxxxxxxxxx' }), false);
  assert.equal(isSafeAuditPayload({ role: 'service_role' }), false);
  assert.equal(isSafeAuditPayload({ token: `eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(12)}` }), false);
  assert.equal(isSafeAuditPayload({}), true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(isSafeAuditPayload(cyclic), false, 'an unserialisable payload is not safe');
});

test('T5: rotation evidence is two tails and a reason, and nothing else', () => {
  const evidence = rotateKeyPayload({
    previousKey: KEY,
    nextKey: 'sb_publishable_next_key_value_999',
    reason: 'x'.repeat(400),
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.value.previous_key_tail, KEY.slice(-6));
  assert.equal(evidence.value.next_key_tail, 'alue_999'.slice(-6));
  assert.equal(evidence.value.reason.length, 200, 'the reason is bounded');
  assert.ok(!JSON.stringify(evidence.value).includes(KEY));
  const unsafe = rotateKeyPayload({ previousKey: KEY, nextKey: KEY, reason: KEY });
  assert.equal(unsafe.ok, false, 'a reason containing a key literal refuses the whole record');
});

test('T5: inputs are validated against the directory contract, not a local guess', () => {
  assert.equal(validateSlug('sunrise-opd').ok, true);
  assert.equal(validateSlug('  Sunrise-OPD  ').value, 'sunrise-opd', 'normalised, not rejected');
  for (const bad of ['', 'ab', '-lead', 'trail-', 'has space', 'x'.repeat(41)]) {
    assert.equal(validateSlug(bad).ok, false, `slug refused: ${bad}`);
  }
  // 'UPPER' is deliberately NOT in that list: a slug is normalised, not rejected,
  // because an operator pasting a display name should not get a validation error.
  assert.equal(validateProjectUrl('https://sunrise-opd.supabase.co').ok, true);
  assert.equal(validateProjectUrl('https://sunrise-opd.supabase.co/').value, 'https://sunrise-opd.supabase.co');
  for (const bad of ['', 'http://x.supabase.co', 'https://evil.example.com', 'https://sunrise-opd.supabase.co.evil.test']) {
    assert.equal(validateProjectUrl(bad).ok, false, `project url refused: ${bad}`);
  }
  assert.equal(validatePublishableKey(KEY).ok, true);
  // Built from parts, like tests/errors.test.mjs and tests/auto-sync-client.test.mjs
  // do: check-contributing scans `git ls-files` for /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  // so a literal here fails the gate once the file is tracked (it does not while
  // untracked — which is why the pre-commit verify run looked green).
  assert.equal(validatePublishableKey(['sb_secret', 'leaked_value_here'].join('_')).ok, false);
  assert.equal(validatePublishableKey('service_role_key_value_here').ok, false);
  assert.equal(validatePublishableKey('short').ok, false);
  assert.equal(validatePublishableKey('').ok, false);
  assert.deepEqual([...MEMBER_ROLES], [...DIRECTORY_ROLES], 'roles come from the contract');
  for (const role of MEMBER_ROLES) assert.equal(validateRole(role.toUpperCase()).value, role);
  assert.equal(validateRole('owner').ok, false, "the tenant-side name is not a Central role");
  assert.equal(validateUserId('00000000-0000-0000-0000-000000000002').ok, true);
  for (const bad of ['', 'not-a-uuid', '00000000-0000-0000-0000-00000000000', 'ops@clinic.in']) {
    assert.equal(validateUserId(bad).ok, false, `user uuid refused: ${bad}`);
  }
});

test('T5: revoke is slug-confirmed, and is not the same verb as deactivate', () => {
  assert.equal(isRevokeConfirmed('sunrise-opd', 'sunrise-opd'), true);
  assert.equal(isRevokeConfirmed('sunrise-opd', '  SUNRISE-OPD '), true, 'case and space tolerant');
  assert.equal(isRevokeConfirmed('sunrise-opd', 'sunrise'), false);
  assert.equal(isRevokeConfirmed('sunrise-opd', ''), false);
  assert.equal(isRevokeConfirmed('', ''), false, 'a blank slug can never be confirmed');
  assert.equal(toggleAction(true), 'workspace_deactivated');
  assert.equal(toggleAction(false), 'workspace_reactivated');
  assert.equal(toggleLabel(true), 'Deactivate');
  assert.equal(toggleLabel(false), 'Reactivate');
  assert.match(toggleHint(true), /dark/i, 'the operator is told what deactivating does');
  assert.notEqual(toggleAction(true), 'workspace_revoked', 'revoke is a separate, deleting verb');
});

test('T5: keep-warm state follows the contract cadence', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 13);
  assert.equal(keepWarmState(null, now), 'never');
  assert.equal(keepWarmState('not-a-date', now), 'never');
  assert.equal(keepWarmState(new Date(now - day).toISOString(), now), 'warm');
  assert.equal(
    keepWarmState(new Date(now - KEEP_WARM.target_days * day).toISOString(), now),
    'due',
  );
  assert.equal(
    keepWarmState(new Date(now - KEEP_WARM.pause_days * day).toISOString(), now),
    'due',
    'a row this old is about to be paused by the free tier',
  );
});

test('T5: the list filter is case-insensitive, matches name or slug, and sorts', () => {
  const entries = [
    summarizeDirectoryEntry({ id: '1', clinicName: 'Sunrise OPD', slug: 'sunrise-opd' }),
    summarizeDirectoryEntry({ id: '2', clinicName: 'Bay Clinic', slug: 'bay-clinic' }),
    summarizeDirectoryEntry({ id: '3', clinicName: 'Anna Nursing Home', slug: 'anna-care' }),
  ];
  assert.deepEqual(filterDirectoryEntries(entries).map((e) => e.slug), [
    'anna-care',
    'bay-clinic',
    'sunrise-opd',
  ]);
  assert.deepEqual(filterDirectoryEntries(entries, 'SUN').map((e) => e.id), ['1']);
  assert.deepEqual(filterDirectoryEntries(entries, 'anna').map((e) => e.id), ['3'], 'matches the slug too');
  assert.deepEqual(filterDirectoryEntries(entries, 'nope'), []);
  assert.deepEqual(filterDirectoryEntries(null, 'x'), [], 'a missing list is empty, not a crash');
  assert.ok(AUDIT_PAGE_SIZE > 0);
});

test('T5: a member edit that changes nothing is not an event', () => {
  assert.equal(memberChangeAction({ existed: false, nextRole: 'staff' }), 'member_added');
  assert.equal(memberChangeAction({ existed: true, previousRole: 'staff', nextRole: 'doctor' }), 'member_role_changed');
  assert.equal(
    memberChangeAction({ existed: true, previousRole: 'staff', nextRole: 'staff' }),
    null,
    'a no-op must not be logged — a trail of no-ops hides the changes that matter',
  );
});

test('T5: auditRow refuses anything the vocabulary or the payload CHECK would reject', () => {
  const good = auditRow({
    action: 'workspace_deactivated',
    slug: 'sunrise-opd',
    actor: 'ops@clinic.in',
    payload: { is_active: false },
    workspaceId: 'w1',
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value, {
    workspace_id: 'w1',
    workspace_slug: 'sunrise-opd',
    action: 'workspace_deactivated',
    actor: 'ops@clinic.in',
    payload: { is_active: false },
  });
  assert.ok(Object.isFrozen(good.value));
  assert.equal(auditRow({ action: 'clinic_deleted', slug: 'sunrise-opd' }).ok, false);
  assert.equal(auditRow({ action: 'workspace_revoked', slug: 'BAD SLUG' }).ok, false);
  assert.equal(
    auditRow({ action: 'workspace_key_rotated', slug: 'sunrise-opd', payload: { key: KEY } }).ok,
    false,
    'a credential in the evidence refuses the whole row',
  );
  // Revocation has no row left to point at: workspace_id defaults to null and the
  // slug carries the attribution (v8 ON DELETE SET NULL).
  assert.equal(auditRow({ action: 'workspace_revoked', slug: 'sunrise-opd' }).value.workspace_id, null);
  assert.equal(
    auditRow({ action: 'member_added', slug: 'sunrise-opd', actor: 'x'.repeat(400) }).value.actor.length,
    254,
    'the actor is bounded like the column',
  );
});

test('T5: a trail row reads as an operator sentence, and a revoked clinic stays attributed', () => {
  const described = describeAuditRow({
    id: 'a1',
    action: 'workspace_key_rotated',
    actor: 'ops@clinic.in',
    workspace_id: 'w1',
    workspace_slug: 'sunrise-opd',
    at: '2026-11-13T10:00:00Z',
    payload: { previous_key_tail: 'abc123', next_key_tail: 'xyz789', reason: 'leak' },
  });
  assert.equal(described.label, ACTION_LABELS.workspace_key_rotated);
  assert.equal(described.detached, false);
  assert.match(described.detail, /next_key_tail: xyz789/);
  assert.match(described.detail, /reason: leak/);
  const detached = describeAuditRow({
    id: 'a2',
    action: 'workspace_revoked',
    workspace_id: null,
    workspace_slug: 'gone-clinic',
    actor: '',
  });
  assert.equal(detached.detached, true, 'the row outlived the directory entry');
  assert.equal(detached.actor, 'unknown operator');
  assert.equal(detached.detail, '');
  assert.equal(describeAuditRow({ action: 'something_new' }).label, 'something_new');
});

test('T5: the console page is allowlisted, and its writes are ratcheted', () => {
  assert.ok(
    DIRECTORY_AUTHORITY_ALLOWLIST.includes(pagePath),
    'the console names directory terms, so invariant D must allowlist it explicitly',
  );
  assert.equal(
    DIRECTORY_AUTHORITY_ALLOWLIST.length,
    5,
    'one page, one new entry — the pure half needs none',
  );
  assert.ok(
    !DIRECTORY_AUTHORITY_ALLOWLIST.includes('src/lib/workspace-console.mjs'),
    'the pure half names no privileged term, so it must NOT be allowlisted',
  );
  assert.ok(PRIVILEGED_TABLES.includes('workspace_audit_log'), 'the trail is a privileged write');

  // Table names must stay LITERALS: the ratchet matches `.from('<table>')` textually,
  // so a constant would hide the write from the gate instead of being checked by it.
  const sites = findWriteSites([{ file: pagePath, text: page }]);
  const unverified = sites.filter((site) => !site.verified);
  assert.deepEqual(
    unverified.map((site) => `${site.file}:${site.line} [${site.table}] ${site.reason}`),
    [],
    'every privileged write in the console counts the rows it changed',
  );
  assert.equal(sites.length, 7, 'toggle, rotate, revoke, 3 member edits, 1 audit append');
  for (const table of ['workspaces', 'workspace_members', 'workspace_audit_log']) {
    assert.ok(sites.some((site) => site.table === table), `${table} writes are audited`);
    assert.ok(
      page.includes(`.from('${table}')`),
      `${table} is named as a literal so the ratchet can see it`,
    );
  }
  // The order that makes the ratchet meaningful: the row count is proven BEFORE the
  // audit append and before any success notice, never after an optimistic update.
  assert.ok(
    page.indexOf('verifyRowsLanded(updated') <
      page.indexOf('await appendAudit({\n        action: toggleAction'),
    'the toggle counts its rows before it records or reports anything',
  );
  assert.equal(
    (page.match(/^\s*verifyRowsLanded\(/gm) ?? []).length,
    7,
    'one row-count check per privileged write (the header comment does not count)',
  );
});

test('T5: the console is reachable — route, nav entry and hash alias all exist', () => {
  assert.match(app, /const WorkspacesPage = lazy\(\(\) => import\('\.\/pages\/WorkspacesPage\.jsx'\)\);/);
  assert.match(app, /directory:\s*\{\s*title: 'Workspace Directory'/);
  assert.match(app, /activeRoute === 'directory' &&/);
  assert.match(app, /<WorkspacesPage\s+backend=\{backend\}\s+operatorEmail=\{session\?\.user\?\.email \?\? ''\}/);
  assert.match(app, /cleaned === 'directory'/, 'the hash route deep-links to the console');
  assert.match(shell, /id: 'directory',\s*label: 'Workspace Directory',/);
  assert.match(shell, /section: 'Control Plane',/);
  // The route id must NOT be the directory term: `\bworkspaces\b` outside the
  // allowlist is invariant D's whole point, and the shell is not a Master module.
  assert.ok(!shell.includes("'workspaces'"), 'the nav id avoids the privileged term');
});
