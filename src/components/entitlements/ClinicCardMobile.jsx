import React from 'react';
import { Cpu, Globe, Power } from 'lucide-react';
import RichNotesView from '../RichNotesView.jsx';
import {
  MYCLINIC_TIER_ENTITLEMENTS,
  computeStanding,
  describeClinicIdentity,
  describeClientSyncState,
  formatDisplayDate,
} from '../../lib/entitlements.mjs';
import {
  buildStandingPillStyle,
  buildSyncPillStyle,
} from '../../lib/status-palette.mjs';
import SyncStateBadge from './SyncStateBadge.jsx';

/**
 * One clinic in the <1024px card stack.
 *
 * Everything shown here is derived from the row through the pure lib layer
 * (standing, identity, sync verdict, seat spec) — the page keeps the record and
 * the three verbs (inspect, toggle kill-switch) and nothing else. Rendered
 * alongside ClinicRowDesktop at all widths (this one hidden from lg up), which
 * is why clicks must target `:visible` copies in tests.
 *
 * @param {object} props
 * @param {object} props.row  one admin_license_view record
 * @param {boolean} [props.isToggling]  kill-switch request in flight
 * @param {(row: object) => void} props.onOpenInspector
 * @param {(row: object) => void} props.onToggleKillSwitch
 */
export default function ClinicCardMobile({
  row,
  isToggling = false,
  onOpenInspector,
  onToggleKillSwitch,
}) {
  const standing = computeStanding(row);
  const pill = buildStandingPillStyle(standing);
  const identity = describeClinicIdentity(row);
  const syncState = describeClientSyncState(row);
  const syncPill = buildSyncPillStyle(syncState);
  const seatSpec =
    MYCLINIC_TIER_ENTITLEMENTS[row.tier] ?? MYCLINIC_TIER_ENTITLEMENTS.standard;

  return (
    <div className="space-y-3 p-4">
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

            <SyncStateBadge syncState={syncState} variant="card" />
          </div>

          <button
            type="button"
            onClick={() => onOpenInspector(row)}
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
                standing.daysLeft !== null && standing.daysLeft <= 14
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
          onClick={() => onOpenInspector(row)}
          className="console-btn-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"
        >
          <Cpu className="h-3.5 w-3.5" />
          Manage Clinic
        </button>

        <button
          type="button"
          disabled={isToggling}
          onClick={() => onToggleKillSwitch(row)}
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
}
