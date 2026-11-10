/**
 * Status → palette policy (UI Component Mapping Guide).
 *
 * Every coloured status surface in the console resolves its tokens here, so the
 * Mapping Guide is written down once instead of being re-typed at each render
 * site. Pure: no React, no DOM, no I/O — which is what makes it testable in the
 * node suite while the views that consume it are gated in the browser harness.
 *
 * Vocabulary is closed on purpose: a status may only ever paint itself with one
 * of `STATUS_BADGE_CLASSES`. Adding a fifth surface means editing this module
 * and its test, not sprinkling a new class name through a page.
 */

/** The only badge surfaces the Mapping Guide defines. */
export const STATUS_BADGE_CLASSES = Object.freeze([
  'badge-success',
  'badge-warning',
  'badge-error',
  'console-well',
]);

/**
 * Client Sync badge palette.
 *
 * `error` is the schema-v3 `Refused` state: the client IS calling Central and is
 * being turned away, which is a fault, not a neutral "not connected yet".
 *
 * @param {{tone?: 'ok'|'warn'|'error'|'neutral'}} syncState
 * @returns {{badgeClass: string, dotColor: string, textColor: string}}
 */
export function buildSyncPillStyle(syncState) {
  if (syncState.tone === 'ok') {
    return {
      badgeClass: 'badge-success',
      dotColor: 'var(--ok-main)',
      textColor: 'var(--ok-text)',
    };
  }
  if (syncState.tone === 'warn') {
    return {
      badgeClass: 'badge-warning',
      dotColor: 'var(--warn-main)',
      textColor: 'var(--warn-text)',
    };
  }
  if (syncState.tone === 'error') {
    return {
      badgeClass: 'badge-error',
      dotColor: 'var(--danger-main)',
      textColor: 'var(--danger-text)',
    };
  }
  return {
    badgeClass: 'console-well',
    dotColor: 'var(--text-muted)',
    textColor: 'var(--text-secondary)',
  };
}

/**
 * Subscription standing palette (Active / Expired / Suspended / Killed).
 *
 * @param {{isOperational?: boolean, stateCode?: string}} standing
 * @returns {{bg: string, border: string, text: string, dotColor: string}}
 */
export function buildStandingPillStyle(standing) {
  if (standing.isOperational) {
    return {
      bg: 'var(--ok-soft)',
      border: 'var(--ok-border)',
      text: 'var(--ok-text)',
      dotColor: 'var(--ok-main)',
    };
  }
  if (standing.stateCode === 'KEY_KILLED') {
    return {
      bg: 'var(--danger-soft)',
      border: 'var(--danger-border)',
      text: 'var(--danger-text)',
      dotColor: 'var(--danger-main)',
    };
  }
  return {
    bg: 'var(--warn-soft)',
    border: 'var(--warn-border)',
    text: 'var(--warn-text)',
    dotColor: 'var(--warn-main)',
  };
}
