/**
 * Free-tier keep-warm (OPD P2, owner FYI 2026-11-11).
 *
 * A Supabase FREE project pauses after 7 days without activity. Data survives,
 * but the clinic's app goes dark until someone restores the project by hand —
 * an outage no licence verdict can explain. Every clinic runs on the free tier,
 * so Central owns the mitigation: touch each ACTIVE workspace's REST root often
 * enough that the idle clock never reaches the pause window.
 *
 * Two producers, one cadence (both read the contract, never a literal):
 *   1. `public.run_keep_warm_cycle()` scheduled by pg_cron + pg_net inside
 *      supabase/schema.sql — runs whether or not anyone has the console open.
 *   2. The Settings & Health panel — an operator probes the due tenants from
 *      the browser and stamps them, which is also how a freshly restored
 *      project gets back on schedule.
 *
 * `workspaces.keep_warm_at` is the shared stamp. This module is the pure half:
 * status wording, due selection, fleet summary and the probe itself with an
 * injected fetch so the whole thing is testable offline.
 */

import { buildCentralPostgrestHeaders } from './auto-sync-client.mjs';
import { KEEP_WARM } from './workspace-directory.mjs';
import { normalizeTenantUrl } from './tenant-connection.mjs';

export const KEEP_WARM_PAUSE_DAYS = KEEP_WARM.pause_days;
export const KEEP_WARM_TARGET_DAYS = KEEP_WARM.target_days;
export const KEEP_WARM_PROBE_PATH = KEEP_WARM.probe_path;
export const KEEP_WARM_CRON_SCHEDULE = KEEP_WARM.cron_schedule;
export const KEEP_WARM_STAMP_COLUMN = KEEP_WARM.stamp_column;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The directory reaches the console in database column names (`keep_warm_at`,
 * `is_active`, `supabase_url`) while UI state often carries camelCase. Accept
 * both, so a caller cannot silently get "unarmed" for a warm workspace.
 */
function readWorkspaceFields(workspace = {}) {
  return {
    keepWarmAt: workspace.keepWarmAt ?? workspace.keep_warm_at ?? null,
    isActive: workspace.isActive ?? workspace.is_active ?? true,
    supabaseUrl: workspace.supabaseUrl ?? workspace.supabase_url ?? '',
  };
}

/**
 * How idle is one workspace?
 *
 * `fresh`     stamped inside the target window — nothing to do.
 * `due`       past the target but inside the pause window — probe on this cycle.
 * `overdue`   the project may already be paused; the probe is a restore test.
 * `unknown`   never stamped (a workspace linked before keep-warm existed).
 * `unarmed`   inactive or no URL recorded: nothing to keep warm, by design.
 */
export function keepWarmStatus(workspace = {}) {
  const now = workspace.now instanceof Date ? workspace.now : new Date();
  const { keepWarmAt, isActive, supabaseUrl } = readWorkspaceFields(workspace);
  if (!isActive || !normalizeTenantUrl(supabaseUrl)) {
    return {
      state: 'unarmed',
      daysSince: null,
      hoursUntilPause: null,
      label: 'Not armed',
      detail:
        !isActive
          ? 'Inactive workspace — the pointer is withheld, so nothing is probed.'
          : 'No tenant URL recorded — complete the Connection step first.',
    };
  }

  const stamp = toTime(keepWarmAt);
  const nowMs = now.getTime();
  if (stamp === null) {
    return {
      state: 'unknown',
      daysSince: null,
      hoursUntilPause: KEEP_WARM_PAUSE_DAYS * 24,
      label: 'Never probed',
      detail: `No ${KEEP_WARM_STAMP_COLUMN} yet — probe once to start the clock.`,
    };
  }

  const elapsedMs = Math.max(0, nowMs - stamp);
  const daysSince = elapsedMs / MS_PER_DAY;
  const hoursUntilPause = Math.max(
    0,
    Math.round((KEEP_WARM_PAUSE_DAYS * MS_PER_DAY - elapsedMs) / MS_PER_HOUR),
  );
  const state =
    daysSince >= KEEP_WARM_PAUSE_DAYS
      ? 'overdue'
      : daysSince >= KEEP_WARM_TARGET_DAYS
        ? 'due'
        : 'fresh';
  const label =
    state === 'overdue'
      ? 'May be paused'
      : state === 'due'
        ? 'Probe due'
        : 'Warm';
  const detail =
    state === 'overdue'
      ? `Last probe ${Math.floor(daysSince)} day(s) ago — past the ${KEEP_WARM_PAUSE_DAYS}-day free-tier pause window. Restore the project in Supabase, then probe again.`
      : state === 'due'
        ? `Last probe ${Math.floor(daysSince)} day(s) ago — target is every ${KEEP_WARM_TARGET_DAYS} day(s), ${hoursUntilPause} h of pause margin left.`
        : `Probed ${daysSince < 1 ? 'today' : `${Math.floor(daysSince)} day(s) ago`} — next probe due in ${Math.max(0, Math.ceil(KEEP_WARM_TARGET_DAYS - daysSince))} day(s).`;

  return { state, daysSince, hoursUntilPause, label, detail };
}

export function isKeepWarmDue(workspace, now = new Date()) {
  const status = keepWarmStatus({ ...workspace, now });
  return status.state === 'due' || status.state === 'overdue' || status.state === 'unknown';
}

/**
 * The probe list for one cycle: active, armed, and idle past the target —
 * never-probed first, then oldest stamp first. `limit` bounds a cycle so a
 * fleet larger than the free-tier egress budget degrades gracefully instead of
 * firing hundreds of requests from one cron tick.
 */
export function pickKeepWarmTargets({ workspaces = [], now = new Date(), limit = 20 } = {}) {
  const rows = (Array.isArray(workspaces) ? workspaces : [])
    .map((workspace) => ({ workspace, status: keepWarmStatus({ ...workspace, now }) }))
    .filter(({ status }) =>
      ['due', 'overdue', 'unknown'].includes(status.state),
    )
    .sort((a, b) => {
      const aStamp = toTime(readWorkspaceFields(a.workspace).keepWarmAt);
      const bStamp = toTime(readWorkspaceFields(b.workspace).keepWarmAt);
      if (aStamp === null && bStamp === null) return 0;
      if (aStamp === null) return -1;
      if (bStamp === null) return 1;
      return aStamp - bStamp;
    });

  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 0;
  return rows.slice(0, cap).map(({ workspace, status }) => ({
    id: workspace.id ?? null,
    clinicName: workspace.clinic_name ?? workspace.clinicName ?? '',
    slug: workspace.slug ?? '',
    supabaseUrl: normalizeTenantUrl(readWorkspaceFields(workspace).supabaseUrl),
    supabaseAnonKey: workspace.supabaseAnonKey ?? workspace.supabase_anon_key ?? '',
    keepWarmAt: readWorkspaceFields(workspace).keepWarmAt,
    state: status.state,
    label: status.label,
    detail: status.detail,
  }));
}

/** One-line fleet summary for the console panel header. */
export function describeKeepWarmFleet({ workspaces = [], now = new Date() } = {}) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  const statuses = list.map((workspace) => keepWarmStatus({ ...workspace, now }));
  const count = (state) => statuses.filter((s) => s.state === state).length;
  const active = statuses.filter((s) => s.state !== 'unarmed').length;
  const due = count('due') + count('overdue') + count('unknown');
  const headline = !list.length
    ? 'No workspaces in the directory yet'
    : !active
      ? 'Nothing armed — every workspace is inactive or has no tenant URL'
      : due
        ? `${due} of ${active} tenant project${active === 1 ? '' : 's'} need${active === 1 ? 's' : ''} a keep-warm probe`
        : `All ${active} tenant project${active === 1 ? '' : 's'} ${active === 1 ? 'is' : 'are'} warm`;
  return {
    total: list.length,
    active,
    fresh: count('fresh'),
    due: count('due'),
    overdue: count('overdue'),
    unknown: count('unknown'),
    unarmed: count('unarmed'),
    needsProbe: due,
    headline,
  };
}

/**
 * Touch one tenant project. Any HTTP answer below 500 proves the project is
 * awake — a 401 still means PostgREST responded, which is all the idle clock
 * cares about. A 5xx or a network failure is what a paused project looks like
 * from the outside, so the wording points at the dashboard restore button.
 */
export async function probeTenantKeepWarm({
  supabaseUrl,
  supabaseAnonKey = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const base = normalizeTenantUrl(supabaseUrl);
  const startedAt = Date.now();
  if (!base) {
    return { ok: false, status: 0, ms: 0, probedAt: null, reason: 'No tenant URL recorded.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = supabaseAnonKey
      ? buildCentralPostgrestHeaders(supabaseAnonKey)
      : { Accept: 'application/json' };
    const res = await fetchImpl(`${base}${KEEP_WARM_PROBE_PATH}`, {
      headers,
      signal: controller.signal,
    });
    const ms = Math.max(0, Date.now() - startedAt);
    if (res.status >= 500) {
      return {
        ok: false,
        status: res.status,
        ms,
        probedAt: new Date().toISOString(),
        reason: `HTTP ${res.status} — the project may be paused. Restore it in Supabase → Project Settings, then probe again.`,
      };
    }
    return {
      ok: true,
      status: res.status,
      ms,
      probedAt: new Date().toISOString(),
      reason: '',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: 0,
      probedAt: new Date().toISOString(),
      reason: /abort/i.test(err?.message ?? '')
        ? `Timed out after ${Math.round(timeoutMs / 1000)} s — the project may be paused or unreachable.`
        : err?.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
