// -----------------------------------------------------------------------------
// In-flight read coalescing (Enrolliq slice 9).
//
// Several console surfaces resolve the SAME read at the SAME moment — a page
// load and a dossier tab, or two components mounting inside one navigation —
// which used to put two or three byte-identical PostgREST GETs on the wire
// (visible in DevTools as repeated `subscriptions?select=id,...` lines).
// coalesce() shares ONE promise between concurrent callers of the same key and
// drops the key the instant the promise settles, so sequential navigations
// still refetch fresh data: no TTL, no stale reads, no cache invalidation
// contract to maintain. Rejections clear the key too, so a failed read is
// never memoised.
// -----------------------------------------------------------------------------

const inflight = new Map();

/**
 * Share one in-flight promise per key. `build` runs at most once while its
 * promise is unsettled; every concurrent caller receives the same result.
 *
 * @param {string} key stable identity of the read (table + shape + filters)
 * @param {() => Promise<any>} build thunk producing the promise to share
 * @returns {Promise<any>} the shared promise
 */
export function coalesce(key, build) {
  const shared = inflight.get(key);
  if (shared) return shared;
  const promise = Promise.resolve()
    .then(build)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** Test/debug introspection: how many reads are in flight right now. */
export function inflightReadCount() {
  return inflight.size;
}
