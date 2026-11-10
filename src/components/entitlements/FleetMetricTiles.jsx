import React from 'react';
import { Clock, Globe, ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * One tile of the 4-metric zone strip. Three of them are filters (clicking
 * narrows the registry), the sync tile is a read-only gauge — so the element
 * itself is a prop, not a styling decision at each call site.
 */
function MetricTile({
  interactive = false,
  onClick,
  accent,
  icon,
  label,
  value,
  suffixText,
  suffixTone = 'var(--text-secondary)',
  suffixClass = 'font-mono text-xs',
  wrap = false,
}) {
  const className = `console-panel relative overflow-hidden rounded-xl p-4 text-left${
    interactive ? ' transition hover:opacity-95' : ''
  }`;
  const body = (
    <>
      <span
        style={{ backgroundColor: accent }}
        className="absolute inset-x-0 top-0 h-[3px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          style={{ color: 'var(--text-secondary)' }}
          className="font-mono text-[10px] font-bold tracking-wider uppercase"
        >
          {label}
        </span>
        {icon}
      </div>
      <div className={`mt-2 flex${wrap ? ' flex-wrap' : ''} items-baseline gap-1.5`}>
        <span className="tabular-nums text-2xl font-bold tracking-tight">
          {value}
        </span>
        <span style={{ color: suffixTone }} className={suffixClass}>
          {suffixText}
        </span>
      </div>
    </>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

/**
 * The 4-metric zone overview strip: active clinics, live client sync, expiring
 * terms, paused / lapsed keys.
 *
 * The sync tile is the fleet-level voice of the schema-v3 audit: a refusal
 * anywhere turns its suffix red ("synced · N refused"), else an amber pending
 * count, else the neutral connected denominator. A refusal is a fault to be
 * seen, never a neutral "not connected yet".
 *
 * Pure view over `computeFleetMetrics()` output; filtering stays with the page
 * through `onSelectFilter`.
 *
 * @param {object} props
 * @param {ReturnType<import('../../lib/entitlements.mjs').computeFleetMetrics>} props.metrics
 * @param {(filter: 'active'|'expiring'|'revoked') => void} props.onSelectFilter
 */
export default function FleetMetricTiles({ metrics, onSelectFilter }) {
  const syncTone =
    metrics.refusedClinicsCount > 0
      ? 'var(--danger-text)'
      : metrics.pendingSyncClinicsCount > 0
        ? 'var(--warn-text)'
        : 'var(--text-secondary)';
  const syncSuffix =
    metrics.refusedClinicsCount > 0
      ? `synced · ${metrics.refusedClinicsCount} refused`
      : metrics.pendingSyncClinicsCount > 0
        ? `synced · ${metrics.pendingSyncClinicsCount} pending`
        : `/ ${metrics.connectedClinicsCount} connected`;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricTile
        interactive
        onClick={() => onSelectFilter('active')}
        accent="var(--brand-primary)"
        icon={
          <ShieldCheck
            style={{ color: 'var(--ok-main)' }}
            className="h-4 w-4 shrink-0"
          />
        }
        label="Active Clinics"
        value={metrics.activeCount}
        suffixText={`/ ${metrics.total}`}
        suffixClass="tabular-nums font-mono text-xs"
      />

      <MetricTile
        accent="var(--accent-energy)"
        icon={
          <Globe
            style={{ color: 'var(--brand-text)' }}
            className="h-4 w-4 shrink-0"
          />
        }
        label="Client Sync Live"
        value={metrics.inSyncClinicsCount}
        suffixText={syncSuffix}
        suffixTone={syncTone}
        suffixClass="tabular-nums font-mono text-[11px] font-semibold"
        wrap
      />

      <MetricTile
        interactive
        onClick={() => onSelectFilter('expiring')}
        accent="var(--warn-main)"
        icon={
          <Clock
            style={{ color: 'var(--warn-main)' }}
            className="h-4 w-4 shrink-0"
          />
        }
        label="Expiring ≤ 14d"
        value={metrics.expiringSoonCount}
        suffixText="renew soon"
      />

      <MetricTile
        interactive
        onClick={() => onSelectFilter('revoked')}
        accent="var(--danger-main)"
        icon={
          <ShieldAlert
            style={{ color: 'var(--danger-main)' }}
            className="h-4 w-4 shrink-0"
          />
        }
        label="Paused / Lapsed"
        value={metrics.revokedOrExpiredCount}
        suffixText="read-only"
      />
    </div>
  );
}
