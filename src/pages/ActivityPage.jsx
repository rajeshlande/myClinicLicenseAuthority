import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import ActivityTimeline from '../components/entitlements/ActivityTimeline.jsx';
import { fetchFleetActivity } from '../lib/activity.mjs';
import { readSubscriptionsLite } from '../lib/reads.mjs';
import { rememberError } from '../lib/errors.mjs';

/**
 * Fleet Activity (Enrolliq slice 5): the whole estate's operational timeline
 * in one floating panel, newest first. Read-only by design — the log is
 * append-only in the database (schema v4), and this page offers no verbs.
 */
export default function ActivityPage({ backend }) {
  const supabase = backend.supabase;
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setRefreshing(true);
      try {
        const [activity, subs] = await Promise.all([
          fetchFleetActivity(supabase, 100),
          readSubscriptionsLite(supabase),
        ]);
        if (activity.error) throw activity.error;
        const map = {};
        for (const sub of subs.data ?? []) {
          map[sub.id] =
            sub.customer_email || sub.allowed_origin || sub.id.slice(0, 8);
        }
        setClinics(map);
        setRows(activity.rows);
        setErrorBanner(null);
      } catch (err) {
        const explained = rememberError(err, 'Load fleet activity');
        setErrorBanner(explained);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {errorBanner ? (
        <div className="badge-error rounded-2xl px-4 py-3 text-xs font-semibold">
          {errorBanner.message}
          <span
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 block font-normal"
          >
            The activity log lives in schema v4 — re-apply supabase/schema.sql
            to Central if this project predates it.
          </span>
        </div>
      ) : null}

      <section className="console-panel overflow-hidden rounded-2xl">
        <div
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
          className="flex flex-wrap items-center justify-between gap-2.5 p-3.5 sm:p-4"
        >
          <div>
            <h2 className="text-sm font-bold tracking-tight">Fleet Timeline</h2>
            <p
              style={{ color: 'var(--text-secondary)' }}
              className="mt-0.5 font-mono text-[10.5px]"
            >
              Append-only operational history · newest 100 events
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => load({ silent: true })}
            className="console-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        <div className="p-3.5 sm:p-4">
          <ActivityTimeline
            rows={rows}
            loading={loading}
            describeClinic={(row) =>
              clinics[row.subscription_id] ?? row.subscription_id.slice(0, 8)
            }
          />
        </div>
      </section>
    </div>
  );
}
