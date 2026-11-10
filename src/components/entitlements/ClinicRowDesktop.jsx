import React from 'react';
import { Blocks, Globe, Power } from 'lucide-react';
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
 * One clinic row of the >=1024px registry table: identity & routing, the live
 * client sync receipt, plan limits, seats & term with the usage bar, and the
 * three verbs.
 *
 * Counterpart of ClinicCardMobile; both render at all widths (this one hidden
 * below lg), so tests must click the `:visible` copy. The seat-usage bar turns
 * amber at 100% — capacity reached is a warning, not a fault.
 *
 * @param {object} props
 * @param {object} props.row  one admin_license_view record
 * @param {boolean} [props.isToggling]  kill-switch request in flight
 * @param {(row: object) => void} props.onOpenInspector
 * @param {(row: object) => void} props.onOpenClientSdk
 * @param {(row: object) => void} props.onToggleKillSwitch
 */
export default function ClinicRowDesktop({
  row,
  isToggling = false,
  onOpenInspector,
  onOpenClientSdk,
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
    <tr
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
      className="console-row-hover align-top transition-colors"
    >
      {/* Col 1 */}
      <td className="min-w-[230px] px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            style={{
              backgroundColor: pill.bg,
              border: `1px solid ${pill.border}`,
              color: pill.text,
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase"
          >
            <span
              style={{ backgroundColor: pill.dotColor }}
              className="h-1.5 w-1.5 rounded-full"
            />
            {standing.stateCode === 'KEY_KILLED' ? 'PAUSED' : standing.label}
          </span>

          <button
            type="button"
            onClick={() => onOpenInspector(row)}
            className="truncate text-left font-bold hover:underline"
          >
            {identity.primary}
          </button>
        </div>

        {identity.secondary ? (
          <div
            style={{ color: 'var(--text-secondary)' }}
            className="mt-1 flex items-center gap-1 font-mono text-[11px]"
          >
            <Globe
              style={{ color: 'var(--brand-text)' }}
              className="h-3 w-3 shrink-0"
            />
            <span className="truncate">
              {identity.secondary}
            </span>
          </div>
        ) : null}

        {row.notes ? (
          <div className="mt-1 max-w-md">
            <RichNotesView notes={row.notes} compact />
          </div>
        ) : null}
      </td>

      {/* Col 2: Live Client Connection & Plan Sync Receipt */}
      <td className="px-3 py-3.5 whitespace-nowrap">
        <div className="flex flex-wrap items-center gap-1.5">
          <SyncStateBadge syncState={syncState} variant="row" />

          <span className="console-well inline-block rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold">
            {identity.modeLabel}
          </span>
        </div>
        <div
          style={{ color: syncPill.textColor }}
          className="mt-1 font-mono text-[10px] font-medium"
        >
          {syncState.detail}
        </div>
      </td>

      {/* Col 3 */}
      <td className="px-3 py-3.5 whitespace-nowrap">
        <span className="badge-accent inline-block rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase">
          {seatSpec.plan}
        </span>
        <div
          style={{ color: 'var(--text-secondary)' }}
          className="mt-1 font-mono text-[10px]"
        >
          {seatSpec.doctors === null
            ? 'Unlimited docs & branches'
            : `${seatSpec.doctors} doc · ${seatSpec.frontdesk} desk`}
        </div>
      </td>

      {/* Col 4 */}
      <td className="px-3 py-3.5 whitespace-nowrap">
        <button
          type="button"
          onClick={() => onOpenInspector(row)}
          className="block text-left"
        >
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="tabular-nums font-bold">
              {row.registered_machines}/{row.max_machines}{' '}
              seats
            </span>
            <div
              style={{ backgroundColor: 'var(--bg-well)' }}
              className="h-1.5 w-12 overflow-hidden rounded-full"
            >
              <div
                style={{
                  width: `${Math.min(100, standing.usagePct)}%`,
                  backgroundColor:
                    standing.usagePct >= 100
                      ? 'var(--warn-main)'
                      : 'var(--ok-main)',
                }}
                className="h-full rounded-full"
              />
            </div>
          </div>
          <div
            style={{
              color:
                standing.daysLeft !== null && standing.daysLeft <= 14
                  ? 'var(--warn-text)'
                  : 'var(--text-secondary)',
            }}
            className="mt-1 tabular-nums font-mono text-[10.5px] font-medium"
          >
            {formatDisplayDate(row.expires_at)}
            {standing.daysLeft !== null
              ? standing.daysLeft < 0
                ? ` · ${Math.abs(standing.daysLeft)}d overdue`
                : ` · ${standing.daysLeft}d left`
              : ''}
          </div>
        </button>
      </td>

      {/* Col 5 */}
      <td className="px-4 py-3.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onOpenInspector(row)}
            className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          >
            Manage
          </button>

          <button
            type="button"
            onClick={() => onOpenClientSdk(row)}
            title="Open myClinic Client SDK"
            className="console-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
          >
            <Blocks className="h-3.5 w-3.5" />
            SDK
          </button>

          <button
            type="button"
            disabled={isToggling}
            onClick={() => onToggleKillSwitch(row)}
            className={`${
              row.is_active ? 'console-btn-danger' : 'badge-success'
            } inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50`}
          >
            <Power className="h-3 w-3" />
            {row.is_active ? 'Pause' : 'Resume'}
          </button>
        </div>
      </td>
    </tr>
  );
}
