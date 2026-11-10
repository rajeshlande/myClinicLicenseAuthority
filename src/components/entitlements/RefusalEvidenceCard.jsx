import React from 'react';

/**
 * Schema v3 refused-attempt evidence: what the client actually sent, and the
 * one action that clears it.
 *
 * Two shapes, one component:
 *
 *  - `refused` — Central is turning this clinic away right now. Error surface
 *    carrying the masked claim the client sent (`email r***@… · URL …`), the
 *    values pinned here for comparison, and the hint that fixes the pair.
 *  - not refused but refusals were recorded in the last 24h — a neutral well:
 *    the client reached Central and did not get through, without implying a
 *    current fault (a paused or expired clinic must keep saying so).
 *
 * Pure view. `refusal` is exactly what `describeRefusal()` returns; nothing is
 * decided here. `ORIGIN_MISMATCH` arrives with no claim by design, so the
 * "Client sent …" line is conditional.
 *
 * @param {object} props
 * @param {boolean} props.refused  syncState.state === 'refused'
 * @param {ReturnType<import('../../lib/entitlements.mjs').describeRefusal>|null} props.refusal
 * @param {{primary: string, secondary: string}} props.pinned describeClinicIdentity()
 */
export default function RefusalEvidenceCard({ refused, refusal, pinned }) {
  if (refused && refusal) {
    return (
      <div className="badge-error space-y-1 rounded-xl px-4 py-3">
        <div className="font-mono text-[10px] font-bold tracking-wider uppercase">
          Refused {refusal.ago} · {refusal.code}
          {refusal.count24h > 1
            ? ` · ${refusal.count24h} attempts in 24h`
            : ''}
        </div>
        {refusal.claim ? (
          <p className="break-words font-mono text-[11px]">
            Client sent {refusal.claim}
          </p>
        ) : null}
        <p
          style={{ color: 'var(--danger-text)' }}
          className="break-words font-mono text-[11px] opacity-95"
        >
          Pinned here: {pinned.primary}
          {pinned.secondary ? ` · ${pinned.secondary}` : ''}
        </p>
        <p className="text-[11px] leading-relaxed">
          {refusal.hint}
        </p>
      </div>
    );
  }

  if (refusal && refusal.count24h > 0) {
    return (
      <div className="console-well rounded-xl px-4 py-2.5">
        <p
          style={{ color: 'var(--text-secondary)' }}
          className="break-words font-mono text-[10.5px]"
        >
          {refusal.count24h} refused attempt
          {refusal.count24h === 1 ? '' : 's'} in the last 24h ·
          latest {refusal.code} {refusal.ago}
        </p>
      </div>
    );
  }

  return null;
}
