// -----------------------------------------------------------------------------
// Shared hot reads (Enrolliq slice 9).
//
// The two widest reads in the console — the subscription identity map and the
// full admin license view — are needed by more than one surface per
// navigation. Both go through coalesce() so concurrent callers share a single
// PostgREST round trip. Query shapes are BYTE-identical to the ones the pages
// used before this module existed, so RLS policies and the sync contract see
// exactly the same requests as before, just fewer of them.
// -----------------------------------------------------------------------------

import { coalesce } from './coalesce.mjs';

/** id -> {label,email,origin} source rows; the identity map every page builds. */
export function readSubscriptionsLite(supabase) {
  return coalesce('subscriptions-lite', () =>
    supabase.from('subscriptions').select('id, customer_email, allowed_origin'),
  );
}

/** Full fleet registry rows, newest first (dashboard + guide + setup health). */
export function readAllLicenses(supabase) {
  return coalesce('admin-license-view-all', () =>
    supabase
      .from('admin_license_view')
      .select('*')
      .order('created_at', { ascending: false }),
  );
}
