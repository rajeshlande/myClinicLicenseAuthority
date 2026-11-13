/**
 * Central console — prove a privileged write actually landed.
 *
 * Every table the console writes is protected by an admin-only row-level
 * security policy of the same shape:
 *
 *     create policy admin_all_licenses on public.licenses
 *       for all to authenticated
 *       using (public.is_license_admin())
 *       with check (public.is_license_admin());
 *
 * A USING clause is a row FILTER, not a permission check. When the signed-in
 * account is not a Central admin, PostgreSQL executes the UPDATE or DELETE
 * against an empty row set: the statement SUCCEEDS, raises no exception, and
 * changes nothing. supabase-js then hands back `{ data: null, error: null }`.
 *
 * So the usual idiom —
 *
 *     const { error } = await supabase.from(t).update(patch).eq('id', id);
 *     if (error) throw error;
 *     showToast('Saved.');
 *
 * — reports success for a write that never happened. For §14's operator
 * runbooks that is the worst possible failure mode: the operator reads "Paused",
 * "Key rotated" or "Member revoked" while the clinic is still live, still on its
 * old publishable key, or still staffed by the person they removed. The same trap
 * quietly empties the audit trail, because a refused activity-log INSERT also
 * returns no error.
 *
 * Proven against PostgreSQL 17 in supabase/schema-tests.sql §12f–§12i: the
 * admin's statement returns one row, the non-admin's returns zero rows with no
 * exception, and a re-read shows the table exactly as the admin left it.
 *
 * The remedy is to ask PostgREST for the rows it changed — a trailing
 * `.select('id')` sends `Prefer: return=representation` — and require at least
 * one. The admin passes the SELECT half of the same policy, so their read-back
 * returns the row; a refused write comes back as an empty array.
 *
 * This module is deliberately table-agnostic and side-effect free: it never
 * builds a client and never names a table, so it stays outside the
 * directory-authority allowlist enforced by scripts/check-admin-static.mjs.
 * The call sites themselves are ratcheted by scripts/check-write-verify.mjs.
 */

/**
 * PostgreSQL's `insufficient_privilege` SQLSTATE — what an RLS refusal would be
 * if it were reported as an error. errors.mjs already classifies this code and
 * the phrase "row-level security", so a SilentWriteRefusal renders through the
 * existing explainError()/errorLine() path with the right sign-in advice.
 */
export const SILENT_REFUSAL_CODE = '42501';

/**
 * The operator-facing explanation for a write the database silently ignored.
 * Kept as a function so tests can assert the wording without constructing one.
 */
export function refusalMessage({ action, table, rows = 0, expected = 1 } = {}) {
  const what = action ? `${action}: ` : '';
  const where = table ? ` on ${table}` : '';
  return (
    `${what}the database accepted the request but changed ${rows} of ${expected} row(s)${where}. ` +
    'Row-level security refused it silently, because this account is not a Central admin ' +
    "(app_metadata.role = 'admin'). Nothing was changed — re-check who is signed in."
  );
}

/**
 * Thrown (or returned) when a write reported no error but changed fewer rows
 * than expected. Shaped like the errors.mjs vocabulary — `code`, `fix` — so the
 * existing toast/diagnostics plumbing explains it correctly, plus `silent: true`
 * so callers can tell "refused" apart from "failed".
 */
export class SilentWriteRefusal extends Error {
  constructor(options = {}) {
    super(refusalMessage(options));
    this.name = 'SilentWriteRefusal';
    this.code = SILENT_REFUSAL_CODE;
    this.fix = 'auth';
    this.silent = true;
    this.action = options.action ?? 'Console write';
    this.table = options.table ?? null;
    this.rows = options.rows ?? 0;
    this.expected = options.expected ?? 1;
  }
}

/**
 * How many rows a PostgREST response says were written. An array is the
 * `.select()` read-back; a bare object is a `.single()`/`.maybeSingle()` shape;
 * `null`/`undefined` means the caller never asked for the rows back.
 */
export function rowsLanded(result) {
  const data = result?.data;
  if (Array.isArray(data)) return data.length;
  if (data !== null && typeof data === 'object') return 1;
  return 0;
}

/**
 * Non-throwing check for call sites that RETURN an error instead of throwing
 * (the activity log does, so one refused append cannot break the action that
 * triggered it). Returns a SilentWriteRefusal when the write landed on fewer
 * rows than `expected`, otherwise null. A real transport/permission error also
 * yields null: the caller already handles that, and this exists only for the
 * silent case.
 */
export function refusalOf(result, options = {}) {
  if (!result || result.error) return null;
  const expected = options.expected ?? 1;
  const rows = rowsLanded(result);
  if (rows >= expected) return null;
  return new SilentWriteRefusal({ ...options, rows, expected });
}

/**
 * Throwing check for `if (error) throw error;` call sites: returns the result
 * unchanged when the write landed, throws SilentWriteRefusal when it did not.
 * Call it immediately after handling `result.error` and BEFORE any optimistic
 * state update or success toast — that ordering is the whole point.
 */
export function verifyRowsLanded(result, options = {}) {
  const refusal = refusalOf(result, options);
  if (refusal) throw refusal;
  return result;
}
