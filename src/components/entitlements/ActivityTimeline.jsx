import React from 'react';
import { History } from 'lucide-react';
import { describeActivityEvent } from '../../lib/activity.mjs';

const TONE_BADGE = {
  ok: 'badge-success',
  warn: 'badge-warning',
  danger: 'badge-error',
  info: 'badge-info',
};

const formatAt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} · ${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const summarizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const parts = Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join(' · ');
};

/**
 * One clinic's operational timeline (schema v4 clinic_activity_log).
 * Append-only by design: the list never offers edit or delete affordances.
 *
 * @param {object} props
 * @param {Array<object>} props.rows activity rows, newest first
 * @param {boolean} [props.loading]
 * @param {(row: object) => string} [props.describeClinic] optional clinic label for fleet view
 */
export default function ActivityTimeline({
  rows,
  loading = false,
  describeClinic = null,
}) {
  if (loading) {
    return (
      <div
        style={{ color: 'var(--text-secondary)' }}
        className="py-10 text-center font-mono text-[11px]"
      >
        Loading timeline...
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="console-well rounded-2xl px-4 py-8 text-center">
        <History
          style={{ color: 'var(--text-secondary)' }}
          className="mx-auto h-5 w-5"
        />
        <p className="mt-2 text-xs font-semibold">No activity recorded yet</p>
        <p
          style={{ color: 'var(--text-secondary)' }}
          className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed"
        >
          Every operator action — onboarding, pause/resume, plan or routing
          changes, renewals, invoices — appends here automatically.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        const meta = describeActivityEvent(row.event_kind);
        const summary = summarizePayload(row.payload);
        return (
          <li
            key={row.id}
            className="console-panel flex items-start gap-3 rounded-2xl px-3.5 py-3"
          >
            <span
              style={{ backgroundColor: 'var(--border-subtle)' }}
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`${
                    TONE_BADGE[meta.tone] ?? 'badge-info'
                  } inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase`}
                >
                  {meta.label}
                </span>
                {describeClinic ? (
                  <span className="truncate text-xs font-bold">
                    {describeClinic(row)}
                  </span>
                ) : null}
                <span
                  style={{ color: 'var(--text-secondary)' }}
                  className="ml-auto shrink-0 font-mono text-[10px]"
                >
                  {formatAt(row.at)}
                </span>
              </div>
              <div
                style={{ color: 'var(--text-secondary)' }}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px]"
              >
                {row.actor ? <span>by {row.actor}</span> : null}
                {summary ? (
                  <span className="truncate">
                    {row.actor ? '· ' : ''}
                    {summary}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
