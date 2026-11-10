import raw from '../../contract/tier-contract.json' with { type: 'json' };

/**
 * The tier & refusal contract — one versioned file, two repositories.
 *
 * `contract/tier-contract.json` is the single source of truth for the wire
 * vocabulary between `rajeshlande/myClinic` and this console: which tier ids
 * exist, which myClinic plan each entitles, the seat limits, the fallback the
 * SQL `case` falls through to, and every refusal code
 * `sync_clinic_subscription()` can answer with.
 *
 * Everything below is a *generated view*: no tier, seat limit, label or refusal
 * code is typed out in Central code any more. `tests/tier-contract.test.mjs`
 * enforces that in three directions — the derived maps equal the shipped
 * v2.3.1 values, `supabase/schema.sql`'s `case` branches parse back to the same
 * entitlements, and a definition-site scan fails if a tier or code literal
 * reappears anywhere except the contract and the test mirrors.
 *
 * The client consumes the same file out of band (published with each release
 * plus its sha256), and its compat suite mirrors `CENTRAL_TIER_TO_PLAN` and its
 * diagnostic vocabulary against it — so a tier or code added on either side
 * fails a test on both.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/** The contract, verbatim and frozen. */
export const TIER_CONTRACT = deepFreeze(raw);

/** Contract file version; bump with any semantic change to the vocabulary. */
export const TIER_CONTRACT_VERSION = raw.contract_version;

/** The schema version this vocabulary was published against. */
export const CONTRACT_CENTRAL_SCHEMA_VERSION = raw.central_schema_version;

/**
 * Tier id → myClinic plan + seat limits. Shape is the v2.3.1 map exactly, so
 * every existing consumer keeps working unchanged.
 */
export const MYCLINIC_TIER_ENTITLEMENTS = Object.freeze(
  Object.fromEntries(
    Object.entries(raw.tiers).map(([tier, spec]) => [
      tier,
      Object.freeze({
        plan: spec.plan,
        doctors: spec.doctors,
        frontdesk: spec.frontdesk,
        branches: spec.branches,
      }),
    ]),
  ),
);

/**
 * What the SQL `case` falls through to for any tier without an explicit
 * branch (today: `chain`, `enterprise`, and anything unknown). Parsed back and
 * compared against this by the drift test.
 */
export const TIER_FALLBACK_ENTITLEMENT = Object.freeze({
  plan: raw.tier_fallback.plan,
  doctors: raw.tier_fallback.doctors,
  frontdesk: raw.tier_fallback.frontdesk,
  branches: raw.tier_fallback.branches,
});

/** Picker catalog: value / label / hint, contract order. */
export const TIER_CATALOG = Object.freeze(
  Object.entries(raw.tiers).map(([value, spec]) =>
    Object.freeze({ value, label: spec.label, hint: spec.hint }),
  ),
);

export const VALID_TIERS = new Set(Object.keys(raw.tiers));

/**
 * What the client-side validator answers with when there is no lease at all
 * (cache miss / corrupt / tampered / never synced) and when Central is not
 * configured (local mode). Wire vocabulary like the rest: typed once, here.
 */
export const VALIDATOR_DEFAULTS = Object.freeze({
  no_lease: Object.freeze({
    tier: raw.validator_defaults.no_lease.tier,
    plan: raw.validator_defaults.no_lease.plan,
  }),
  local_mode: Object.freeze({
    plan: raw.validator_defaults.local_mode.plan,
  }),
});

/** Refusal code → operator-facing label + the one action that clears it. */
export const SYNC_REFUSAL_HINTS = Object.freeze(
  Object.fromEntries(
    Object.entries(raw.refusal_codes).map(([code, spec]) => [
      code,
      Object.freeze({ label: spec.label, hint: spec.hint }),
    ]),
  ),
);
