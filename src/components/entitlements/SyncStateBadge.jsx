import React from 'react';
import { buildSyncPillStyle } from '../../lib/status-palette.mjs';

/**
 * Dot-gap per layout. The 375px card stack packs the sync pill next to the
 * standing and plan pills, so it uses the tighter gap; the desktop row has room
 * for the wider one. Both values are the ones the page shipped with in v2.3.0 —
 * spacing policy lives with the badge now instead of at each render site.
 */
const VARIANT_DOT_GAP = Object.freeze({
  card: 'gap-1',
  row: 'gap-1.5',
});

/**
 * The Client Sync pill: tone-coloured surface, status dot, verdict label.
 *
 * Pure view. It takes the already-computed `describeClientSyncState()` verdict
 * and the palette policy from `lib/status-palette.mjs`; it decides nothing about
 * what the state means. Rendered twice per clinic (mobile card + desktop row),
 * which is why the markup lives here rather than being typed out twice.
 *
 * @param {object} props
 * @param {ReturnType<import('../../lib/entitlements.mjs').describeClientSyncState>} props.syncState
 * @param {'row'|'card'} [props.variant] 'card' = <1024px stack, 'row' = desktop table
 */
export default function SyncStateBadge({ syncState, variant = 'row' }) {
  const pill = buildSyncPillStyle(syncState);
  const dotGap = VARIANT_DOT_GAP[variant] ?? VARIANT_DOT_GAP.row;

  return (
    <span
      className={`${pill.badgeClass} inline-flex items-center ${dotGap} rounded-full px-2 py-0.5 font-mono text-[10px] font-bold`}
    >
      <span
        style={{ backgroundColor: pill.dotColor }}
        className="h-1.5 w-1.5 rounded-full"
      />
      {syncState.badgeLabel}
    </span>
  );
}
