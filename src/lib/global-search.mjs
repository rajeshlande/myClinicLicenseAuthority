// -----------------------------------------------------------------------------
// Global search store (Enrolliq shell, slice 2).
//
// The shell topbar carries a single global search pill (the reference UI's
// defining topbar element). The registry filter lives inside EntitlementsPage,
// so both inputs bind to this tiny pub/sub store instead of duplicating state:
// typing in either surface updates the other, and pressing Enter in the shell
// pill navigates to the registry with the query already applied.
//
// Deliberately dependency-free and framework-free so it is unit-testable under
// `node --test` without a DOM.
// -----------------------------------------------------------------------------

let query = '';
const listeners = new Set();

export function getGlobalSearchQuery() {
  return query;
}

export function setGlobalSearchQuery(next) {
  const value = typeof next === 'string' ? next : '';
  if (value === query) return;
  query = value;
  listeners.forEach((listener) => listener(query));
}

export function subscribeGlobalSearch(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribeGlobalSearch expects a function listener');
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
