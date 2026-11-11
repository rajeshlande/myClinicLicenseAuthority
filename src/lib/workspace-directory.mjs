import raw from '../../contract/workspace-directory-contract.json' with { type: 'json' };

/**
 * The workspace-directory contract — one versioned file, three consumers.
 *
 * `contract/workspace-directory-contract.json` is the single source of truth
 * for the OPD multi-tenant directory vocabulary (decision record:
 * /home/user/OPD-DECISIONS.md, S8): workspace member roles, the immutable
 * Central Auth metadata roles (D6-A), tenant slug/URL/key shapes, the RS256
 * tenant-token claim set and TTLs (D1′), the anon-RPC allowlist (S3), the
 * browser storage keys (R1 §9.3) and the Pages/SW topology (D2′/S9).
 *
 * Like tier-contract.mjs, everything below is a *generated view*: no role,
 * TTL, claim or storage key is typed out in Central code. The companion test
 * pins the file's sha256 (the myClinic repo pins the SAME hash against its
 * vendored copy, so a one-sided edit fails tests in both repositories),
 * asserts the view equals the file, scans definition sites, and re-proves
 * that `sync_clinic_subscription` is still the only RPC granted to anon.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export const DIRECTORY_CONTRACT_VERSION = raw.version;

export const DIRECTORY_ROLES = deepFreeze([...raw.roles.workspace_member]);

export const CENTRAL_AUTH_ROLES = deepFreeze([
  ...raw.roles.central_auth_metadata,
]);

export const TENANT_SCHEMA_VERSION = raw.tenant.schema_version;

export const TENANT_TOKEN_TTL_SECONDS = raw.auth.tenant_token_ttl_seconds;

export const OFFLINE_LEASE_TTL_SECONDS = raw.auth.offline_lease_ttl_seconds;

export const TENANT_TOKEN_CLAIMS = deepFreeze([...raw.auth.claims]);

export const DIRECTORY_ANON_RPCS = deepFreeze([...raw.rpc.anon_only]);

export const DIRECTORY_DISCOVERY_RPC = raw.rpc.authenticated_discovery;

export const OPD_STORAGE_KEYS = deepFreeze({ ...raw.storage_keys });

export const WORKSPACE_SLUG_PATTERN = raw.tenant.slug_pattern;

export const TENANT_SUPABASE_URL_PATTERN = raw.tenant.url_pattern;

export const FORBIDDEN_TENANT_KEY_PATTERN = raw.tenant.forbidden_key_pattern;

export const OPD_PAGES = deepFreeze({ ...raw.pages });

export const OPD_CLINIC_ENV_VARS = deepFreeze([...raw.env.clinic_app]);
