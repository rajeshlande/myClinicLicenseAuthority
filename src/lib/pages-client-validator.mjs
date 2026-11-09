import { verifyCapabilityJwt } from './crypto-rs256.mjs';
import { MYCLINIC_TIER_ENTITLEMENTS } from './entitlements.mjs';

export const DEFAULT_PAGES_CACHE_KEY = 'myclinic.authority.rs256.jwt';
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Builds the deterministic, Origin-scoped fingerprint for a browser / GitHub Pages
 * deployment (`web:<origin>` or `web:<origin>|<clinicId>`).
 *
 * The `verify-license` Edge Function cross-checks this value against the browser's
 * unforgeable HTTP `Origin` request header so another GitHub Pages domain cannot
 * reuse a scraped public `VITE_LICENSE_KEY`.
 */
export function buildPagesFingerprint({ origin, clinicId = '' } = {}) {
  const cleanOrigin = String(
    origin ?? globalThis.location?.origin ?? '',
  )
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  if (!cleanOrigin || !/^https?:\/\//.test(cleanOrigin)) {
    throw new Error(
      'A valid http(s) deployment origin is required to build a GitHub Pages license fingerprint.',
    );
  }

  const cleanClinic = String(clinicId ?? '').trim().toLowerCase();
  return cleanClinic ? `web:${cleanOrigin}|${cleanClinic}` : `web:${cleanOrigin}`;
}

function defaultStorage() {
  try {
    if (
      typeof window !== 'undefined' &&
      window.localStorage &&
      typeof window.localStorage.getItem === 'function'
    ) {
      return window.localStorage;
    }
  } catch {
    // Blocked storage in strict iframe
  }
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

/**
 * Verifies a cached RS256 capability token in a GitHub-Pages-hosted browser app
 * using WebCrypto (`window.crypto.subtle`) and maps it onto `myClinic`'s plan shape.
 */
export async function verifyCachedPagesLicense({
  publicKeyPem,
  licenseKey,
  origin = globalThis.location?.origin,
  clinicId = '',
  storage = defaultStorage(),
  cacheKey = DEFAULT_PAGES_CACHE_KEY,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const expectedOrigin = String(origin ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  const expectedFingerprint = buildPagesFingerprint({
    origin: expectedOrigin,
    clinicId,
  });

  const cachedJwt = storage.getItem(cacheKey);
  if (!cachedJwt) {
    return {
      valid: false,
      code: 'LICENSE_CACHE_MISSING',
      reason: 'No cached RS256 capability token in browser storage.',
      myClinicLicense: {
        status: 'expired',
        plan: 'solo',
        interval: 'yearly',
        current_period_end: null,
        collection_ref: 'LICENSE_CACHE_MISSING',
      },
    };
  }

  const check = await verifyCapabilityJwt(cachedJwt, publicKeyPem, {
    nowSeconds,
    expectedFingerprint,
    expectedLicenseKey: licenseKey,
    expectedOrigin,
  });

  if (!check.valid) {
    return {
      valid: false,
      code: check.code,
      reason: check.reason,
      myClinicLicense: {
        status: 'expired',
        plan: 'solo',
        interval: 'yearly',
        current_period_end: null,
        collection_ref: check.code,
      },
    };
  }

  const entitlements =
    MYCLINIC_TIER_ENTITLEMENTS[check.claims.tier] ??
    MYCLINIC_TIER_ENTITLEMENTS.standard;
  const ageSeconds = Math.max(0, nowSeconds - Number(check.claims.iat ?? 0));

  return {
    valid: true,
    needsRefresh: ageSeconds >= DEFAULT_REFRESH_INTERVAL_SECONDS,
    claims: check.claims,
    entitlements,
    myClinicLicense: {
      status: 'active',
      plan: entitlements.plan,
      interval: 'yearly',
      current_period_end:
        check.claims.subscription_expires_at ??
        new Date(check.claims.exp * 1000).toISOString(),
      collection_ref: `RS256 · ${expectedOrigin}`,
    },
  };
}

/**
 * Syncs a GitHub-Pages-hosted `myClinic` deployment against the Authority Edge Function,
 * verifies the returned RS256 token via WebCrypto BEFORE storing it, and falls back to
 * the cached 7-day offline token if the clinic is temporarily offline.
 */
export async function syncPagesLicense({
  verifyUrl,
  licenseKey,
  publicKeyPem,
  origin = globalThis.location?.origin,
  clinicId = '',
  supabaseAnonKey = '',
  storage = defaultStorage(),
  cacheKey = DEFAULT_PAGES_CACHE_KEY,
  fetchImpl = globalThis.fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const expectedOrigin = String(origin ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  const fingerprint = buildPagesFingerprint({
    origin: expectedOrigin,
    clinicId,
  });

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (supabaseAnonKey?.trim()) {
      headers.apikey = supabaseAnonKey.trim();
      headers.Authorization = `Bearer ${supabaseAnonKey.trim()}`;
    }

    const res = await fetchImpl(verifyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        license_key: String(licenseKey ?? '').trim().toUpperCase(),
        machine_fingerprint: fingerprint,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.token !== 'string') {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const verified = await verifyCapabilityJwt(body.token, publicKeyPem, {
      nowSeconds,
      expectedFingerprint: fingerprint,
      expectedLicenseKey: licenseKey,
      expectedOrigin,
    });

    if (!verified.valid) {
      throw new Error(`${verified.code}: ${verified.reason}`);
    }

    storage.setItem(cacheKey, body.token.trim());
    return verifyCachedPagesLicense({
      publicKeyPem,
      licenseKey,
      origin: expectedOrigin,
      clinicId,
      storage,
      cacheKey,
      nowSeconds,
    });
  } catch (syncError) {
    const fallback = await verifyCachedPagesLicense({
      publicKeyPem,
      licenseKey,
      origin: expectedOrigin,
      clinicId,
      storage,
      cacheKey,
      nowSeconds,
    });

    return {
      ...fallback,
      syncWarning:
        syncError instanceof Error ? syncError.message : 'Sync failed.',
    };
  }
}
