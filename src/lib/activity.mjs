// -----------------------------------------------------------------------------
// Per-clinic activity log client (Enrolliq slice 5).
//
// Mirrors public.clinic_activity_log (schema v4): the console writes one row
// per operator mutation so every clinic dossier carries its own operational
// timeline. The vocabulary below is the SAME closed set as the SQL CHECK
// constraint — tests/activity.test.mjs asserts the two stay in lockstep, and
// an unknown kind is refused CLIENT-side before it ever reaches PostgREST.
//
// Writes are best-effort BY UX, not by silence: a failed append (for example
// a Central project still on schema v3) never rolls back the mutation that
// already succeeded, but the caller receives the error so the page can toast
// "done, but the log is unavailable" instead of pretending history exists.
// -----------------------------------------------------------------------------

import { coalesce } from './coalesce.mjs';

export const ACTIVITY_EVENT_KINDS = Object.freeze([
  'onboarded',
  'activated',
  'paused',
  'resumed',
  'renewed',
  'tier_changed',
  'routing_changed',
  'payment_received',
  'invoice_issued',
  'invoice_paid',
  'invoice_void',
  'notes_changed',
]);

/** UI vocabulary: label + tone per event kind (tone maps to badge-* classes). */
export const ACTIVITY_EVENT_META = Object.freeze({
  onboarded: { label: 'Onboarded', tone: 'ok' },
  activated: { label: 'Seat Activated', tone: 'info' },
  paused: { label: 'Paused', tone: 'danger' },
  resumed: { label: 'Resumed', tone: 'ok' },
  renewed: { label: 'Term Renewed', tone: 'info' },
  tier_changed: { label: 'Plan Changed', tone: 'info' },
  routing_changed: { label: 'Routing Changed', tone: 'info' },
  payment_received: { label: 'Payment Received', tone: 'ok' },
  invoice_issued: { label: 'Invoice Issued', tone: 'warn' },
  invoice_paid: { label: 'Invoice Paid', tone: 'ok' },
  invoice_void: { label: 'Invoice Voided', tone: 'danger' },
  notes_changed: { label: 'Notes Edited', tone: 'info' },
});

export function describeActivityEvent(kind) {
  return (
    ACTIVITY_EVENT_META[kind] ?? { label: String(kind ?? 'unknown'), tone: 'info' }
  );
}

/**
 * Append one timeline event.
 *
 * @param {object} supabase authenticated Central client
 * @param {object} entry
 * @param {string} entry.subscriptionId
 * @param {string|null} [entry.licenseId]
 * @param {string} entry.eventKind one of ACTIVITY_EVENT_KINDS
 * @param {string} [entry.actor] operator email (or '' for system)
 * @param {object} [entry.payload] free-form jsonb evidence
 * @returns {Promise<{error: Error|null}>}
 */
export async function logClinicActivity(supabase, entry) {
  const {
    subscriptionId,
    licenseId = null,
    eventKind,
    actor = '',
    payload = {},
  } = entry ?? {};

  if (!subscriptionId) {
    return { error: new Error('activity log: subscriptionId is required') };
  }
  if (!ACTIVITY_EVENT_KINDS.includes(eventKind)) {
    return {
      error: new Error(`activity log: unknown event kind '${eventKind}'`),
    };
  }

  const { error } = await supabase.from('clinic_activity_log').insert({
    subscription_id: subscriptionId,
    license_id: licenseId,
    event_kind: eventKind,
    actor: String(actor).slice(0, 254),
    payload,
  });
  return { error: error ?? null };
}

/** One clinic's timeline, newest first. */
export function fetchClinicActivity(supabase, subscriptionId, limit = 50) {
  return coalesce(`clinic-activity-${subscriptionId}-${limit}`, async () => {
    const { data, error } = await supabase
      .from('clinic_activity_log')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .order('at', { ascending: false })
      .limit(limit);
    return { rows: data ?? [], error: error ?? null };
  });
}

/** Fleet-wide timeline, newest first (fleet activity page). */
export function fetchFleetActivity(supabase, limit = 100) {
  return coalesce(`fleet-activity-${limit}`, async () => {
    const { data, error } = await supabase
      .from('clinic_activity_log')
      .select('*')
      .order('at', { ascending: false })
      .limit(limit);
    return { rows: data ?? [], error: error ?? null };
  });
}
