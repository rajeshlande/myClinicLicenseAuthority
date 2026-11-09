/**
 * Keyless Central-to-Client Subscription Auto-Sync Engine (`v1.6.0`).
 *
 * Security invariants enforced on the client <-> Central Supabase boundary:
 *  1. Hard-blocks Central `service_role` / `sb_secret_` keys in browser builds.
 *  2. Cross-Supabase token isolation: calls Central PostgREST via raw `fetch()`
 *     using ONLY Central's publishable `anon` key — NEVER forwards the clinic's
 *     own Supabase Auth user JWT across projects and never spawns a second
 *     GoTrueClient instance.
 *  3. Seals cached offline leases in `localStorage` with a WebCrypto SHA-256
 *     integrity digest bound to `(origin + email + deviceId)` so casual DevTools
 *     JSON edits (`tier: "enterprise"`) invalidate the cache immediately.
 *  4. Immediately wipes the cached lease when Central returns `allowed: false`
 *     (`SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_NOT_FOUND`,
 *     `SEAT_LIMIT_REACHED`, `ORIGIN_MISMATCH`), while preserving up to 7 days of
 *     offline grace (`grace_until <= expires_at`) during genuine network outages.
 */

export const DEFAULT_SYNC_STORAGE_KEY = 'myclinic.central.subscription.v2';
export const DEFAULT_DEVICE_ID_KEY = 'myclinic.central.device_id.v2';
export const DEFAULT_AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const SEAL_PEPPER = 'myclinic-central-lease-v2:7f4c9a2e';

function decodeJwtPayloadUnsafe(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const raw = atob(padded + '='.repeat(padLen));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Refuses privileged Supabase keys so Central DB can never be exposed in a client build.
 */
export function assertPublishableAnonKey(anonKey) {
  const clean = String(anonKey ?? '').trim();
  if (!clean) {
    const err = new Error('Central Supabase publishable/anon key is required.');
    err.code = 'CENTRAL_CONFIG_MISSING';
    throw err;
  }
  if (clean.startsWith('sb_secret_')) {
    const err = new Error(
      'SECURITY BLOCK: Refusing to use a privileged sb_secret_ key in a client app. Use the publishable/anon key.',
    );
    err.code = 'CENTRAL_SECRET_KEY_BLOCKED';
    throw err;
  }
  const payload = decodeJwtPayloadUnsafe(clean);
  if (payload?.role === 'service_role') {
    const err = new Error(
      'SECURITY BLOCK: Refusing to use a service_role key in a client app. Use the anon/publishable key.',
    );
    err.code = 'CENTRAL_SECRET_KEY_BLOCKED';
    throw err;
  }
  return clean;
}

/**
 * Normalizes any clinic URL or origin (`https://clinic.github.io/myClinic/` -> `https://clinic.github.io`).
 */
export function normalizeClinicOrigin(rawOrigin) {
  const trimmed = String(rawOrigin ?? '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeClinicEmail(rawEmail) {
  const clean = String(rawEmail ?? '').trim().toLowerCase();
  if (!clean) return '';
  if (clean.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return '';
  }
  return clean;
}

export function buildCentralPostgrestHeaders(anonKey, { bearerToken = '' } = {}) {
  const safeAnon = assertPublishableAnonKey(anonKey);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    apikey: safeAnon,
  };

  const explicitBearer = String(bearerToken ?? '').trim();
  if (explicitBearer) {
    headers.Authorization = `Bearer ${explicitBearer}`;
  } else if (!safeAnon.startsWith('sb_publishable_')) {
    // Legacy `eyJ...` anon keys also expect Authorization: Bearer <anon>
    headers.Authorization = `Bearer ${safeAnon}`;
  }

  return headers;
}

function defaultStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Sandboxed iframe fallback
  }
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

export function getOrCreateDeviceId(storage = defaultStorage(), key = DEFAULT_DEVICE_ID_KEY) {
  const existing = String(storage.getItem(key) ?? '').trim();
  if (/^[a-zA-Z0-9._:-]{8,96}$/.test(existing)) {
    return existing;
  }
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const generated =
    ' clinic-'
      .trim() +
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  storage.setItem(key, generated);
  return generated;
}

export async function computeLeaseSeal(lease, { origin = '', email = '', deviceId = '' } = {}) {
  const canonical = [
    SEAL_PEPPER,
    normalizeClinicOrigin(origin),
    normalizeClinicEmail(email),
    String(deviceId ?? '').trim(),
    Boolean(lease?.allowed),
    String(lease?.status ?? ''),
    String(lease?.tier ?? ''),
    String(lease?.plan ?? ''),
    String(lease?.doctors ?? ''),
    String(lease?.frontdesk ?? ''),
    String(lease?.branches ?? ''),
    String(lease?.expires_at ?? ''),
    String(lease?.grace_until ?? ''),
  ].join('|');

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Reads & validates the sealed offline subscription lease from `localStorage`.
 */
export async function readCachedCentralLease({
  origin = globalThis.location?.origin ?? '',
  email = '',
  deviceId = '',
  storage = defaultStorage(),
  cacheKey = DEFAULT_SYNC_STORAGE_KEY,
  now = new Date(),
} = {}) {
  const raw = storage.getItem(cacheKey);
  if (!raw) {
    return {
      allowed: false,
      source: 'cache_miss',
      status: 'unlicensed',
      code: 'CACHE_EMPTY',
      tier: 'solo',
      plan: 'solo',
      reason: 'Clinic has not synced subscription status yet.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(cacheKey);
    return {
      allowed: false,
      source: 'cache_corrupt',
      status: 'unlicensed',
      code: 'CACHE_TAMPERED',
      tier: 'solo',
      plan: 'solo',
      reason: 'Cached subscription state was corrupted.',
    };
  }

  const expectedSeal = await computeLeaseSeal(parsed.lease, {
    origin,
    email,
    deviceId,
  });

  if (!parsed?.seal || parsed.seal !== expectedSeal || !parsed?.lease?.allowed) {
    storage.removeItem(cacheKey);
    return {
      allowed: false,
      source: 'cache_tampered',
      status: 'unlicensed',
      code: 'CACHE_TAMPERED',
      tier: 'solo',
      plan: 'solo',
      reason: 'Cached subscription seal did not match this clinic identity.',
    };
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const expiresMs = Date.parse(String(parsed.lease.expires_at ?? ''));
  const graceMs = Date.parse(String(parsed.lease.grace_until ?? ''));

  if (!Number.isFinite(expiresMs) || nowMs >= expiresMs) {
    storage.removeItem(cacheKey);
    return {
      allowed: false,
      source: 'cache_expired',
      status: 'expired',
      code: 'SUBSCRIPTION_EXPIRED',
      tier: 'solo',
      plan: 'solo',
      expires_at: parsed.lease.expires_at ?? null,
      reason: 'Subscription expired. Connect to the internet after renewing.',
    };
  }

  if (!Number.isFinite(graceMs) || nowMs >= graceMs) {
    return {
      allowed: false,
      source: 'grace_expired',
      status: 'offline_expired',
      code: 'OFFLINE_GRACE_EXPIRED',
      tier: 'solo',
      plan: 'solo',
      expires_at: parsed.lease.expires_at ?? null,
      reason: '7-day offline grace window elapsed. Reconnect briefly to auto-sync.',
    };
  }

  return {
    ...parsed.lease,
    allowed: true,
    source: 'offline_cache',
  };
}

/**
 * Zero-side-effect readiness probe for Guide & Settings (`p_device_id = 'healthcheck'`).
 */
export async function probeCentralAutoSync(
  centralUrl,
  centralAnonKey,
  { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {},
) {
  const cleanUrl = String(centralUrl ?? '').trim().replace(/\/+$/, '');
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    const err = new Error('Enter a valid Central Supabase URL first.');
    err.code = 'CENTRAL_CONFIG_MISSING';
    throw err;
  }

  const headers = buildCentralPostgrestHeaders(centralAnonKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(
      `${cleanUrl}/rest/v1/rpc/sync_clinic_subscription`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_email: '',
          p_origin: '',
          p_device_id: 'healthcheck',
        }),
        signal: controller.signal,
      },
    );

    const payload = await res.json().catch(() => ({}));
    if (res.status === 404 || payload?.code === 'PGRST202') {
      const err = new Error(
        'sync_clinic_subscription RPC not found (Schema v2 not applied yet). Re-run supabase/schema.sql in Central Supabase SQL Editor.',
      );
      err.code = 'SCHEMA_V2_REQUIRED';
      throw err;
    }

    if (!res.ok || !payload?.sync_ready) {
      const err = new Error(
        payload?.message ||
          payload?.error ||
          `Central auto-sync RPC returned HTTP ${res.status}.`,
      );
      err.code = payload?.code || 'CENTRAL_RPC_ERROR';
      throw err;
    }

    return {
      ok: true,
      schemaVersion: Number(payload.schema_version ?? 2),
      serverTime: payload.server_time ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Syncs a clinic's subscription directly from Central Supabase RPC (`sync_clinic_subscription`)
 * using email, clinic URL, or both — with automatic 7-day offline fallback.
 */
export async function syncCentralSubscription({
  centralUrl,
  centralAnonKey,
  email = '',
  origin = globalThis.location?.origin ?? '',
  deviceId = '',
  bearerToken = '',
  storage = defaultStorage(),
  cacheKey = DEFAULT_SYNC_STORAGE_KEY,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const cleanUrl = String(centralUrl ?? '').trim().replace(/\/+$/, '');
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    const err = new Error('Central Supabase URL is missing or invalid.');
    err.code = 'CENTRAL_CONFIG_MISSING';
    throw err;
  }

  const cleanOrigin = normalizeClinicOrigin(origin);
  const cleanEmail = normalizeClinicEmail(email);
  const resolvedDevice =
    String(deviceId ?? '').trim() || getOrCreateDeviceId(storage);
  const headers = buildCentralPostgrestHeaders(centralAnonKey, { bearerToken });

  try {
    const res = await fetchImpl(
      `${cleanUrl}/rest/v1/rpc/sync_clinic_subscription`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_email: cleanEmail,
          p_origin: cleanOrigin,
          p_device_id: resolvedDevice,
        }),
      },
    );

    const body = await res.json().catch(() => ({}));
    if (res.status === 404 || body?.code === 'PGRST202') {
      const err = new Error(
        'Central Supabase is still on Schema v1. Paste & run supabase/schema.sql (v2) in Central SQL Editor.',
      );
      err.code = 'SCHEMA_V2_REQUIRED';
      throw err;
    }

    if (!res.ok) {
      throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    }

    // Authoritative central refusal -> immediately wipe offline lease!
    if (!body?.allowed) {
      if (resolvedDevice !== 'admin-preview') {
        storage.removeItem(cacheKey);
      }
      return {
        ...body,
        allowed: false,
        source: 'central_live',
      };
    }

    // Valid active subscription -> seal and cache for 7-day offline resilience
    if (resolvedDevice !== 'admin-preview') {
      const seal = await computeLeaseSeal(body, {
        origin: cleanOrigin,
        email: cleanEmail,
        deviceId: resolvedDevice,
      });
      storage.setItem(
        cacheKey,
        JSON.stringify({
          lease: body,
          seal,
          synced_at: (now instanceof Date ? now : new Date(now)).toISOString(),
        }),
      );
    }

    return {
      ...body,
      allowed: true,
      source: 'central_live',
    };
  } catch (networkErr) {
    if (
      networkErr?.code === 'CENTRAL_SECRET_KEY_BLOCKED' ||
      networkErr?.code === 'CENTRAL_CONFIG_MISSING' ||
      networkErr?.code === 'SCHEMA_V2_REQUIRED'
    ) {
      throw networkErr;
    }

    // Genuine network outage -> verify sealed 7-day offline grace cache
    const cached = await readCachedCentralLease({
      origin: cleanOrigin,
      email: cleanEmail,
      deviceId: resolvedDevice,
      storage,
      cacheKey,
      now,
    });
    return {
      ...cached,
      syncWarning: networkErr?.message ?? 'Central server temporarily unreachable.',
    };
  }
}

/**
 * Starts the automatic background sync loop on boot, `online`, `visibilitychange`,
 * and every 30 minutes. Returns a `stop()` cleanup function.
 */
export function startCentralAutoSync({
  centralUrl,
  centralAnonKey,
  getEmail = () => '',
  getOrigin = () => globalThis.location?.origin ?? '',
  onUpdate = () => {},
  intervalMs = DEFAULT_AUTO_SYNC_INTERVAL_MS,
  storage = defaultStorage(),
  fetchImpl = globalThis.fetch,
} = {}) {
  let stopped = false;
  let inflight = null;

  const triggerSync = () => {
    if (stopped) return Promise.resolve(null);
    if (inflight) return inflight;
    inflight = syncCentralSubscription({
      centralUrl,
      centralAnonKey,
      email: getEmail(),
      origin: getOrigin(),
      storage,
      fetchImpl,
    })
      .then((verdict) => {
        if (!stopped) onUpdate(verdict);
        return verdict;
      })
      .catch((err) => {
        if (!stopped) {
          onUpdate({
            allowed: false,
            status: 'config_error',
            code: err?.code ?? 'SYNC_ERROR',
            reason: err?.message ?? 'Subscription sync failed.',
          });
        }
        return null;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const handleOnline = () => {
    void triggerSync();
  };
  const handleVisibility = () => {
    if (globalThis.document?.visibilityState === 'visible') {
      void triggerSync();
    }
  };

  if (globalThis.window?.addEventListener) {
    globalThis.window.addEventListener('online', handleOnline);
  }
  if (globalThis.document?.addEventListener) {
    globalThis.document.addEventListener('visibilitychange', handleVisibility);
  }
  const timerId = setInterval(handleOnline, intervalMs);

  void triggerSync();

  return function stop() {
    stopped = true;
    clearInterval(timerId);
    if (globalThis.window?.removeEventListener) {
      globalThis.window.removeEventListener('online', handleOnline);
    }
    if (globalThis.document?.removeEventListener) {
      globalThis.document.removeEventListener('visibilitychange', handleVisibility);
    }
  };
}

/**
 * Generates ready-to-paste client configuration & obfuscated auto-sync files for `myClinic`.
 */
export function buildMyClinicAutoSyncKit({
  centralUrl = 'https://YOUR_CENTRAL_PROJECT_REF.supabase.co',
  centralAnonKey = 'sb_publishable_YOUR_CENTRAL_ANON_KEY',
} = {}) {
  const cleanUrl =
    String(centralUrl || 'https://YOUR_CENTRAL_PROJECT_REF.supabase.co')
      .trim()
      .replace(/\/+$/, '');
  const cleanAnon = String(
    centralAnonKey || 'sb_publishable_YOUR_CENTRAL_ANON_KEY',
  ).trim();

  const envVars = [
    `VITE_CENTRAL_SUPABASE_URL="${cleanUrl}"`,
    `VITE_CENTRAL_SUPABASE_ANON_KEY="${cleanAnon}"`,
  ].join('\n');

  const clientModule = `// myClinic -> src/lib/central-subscription.mjs
// Keyless Auto-Sync client: connects to Central Supabase RPC using ONLY the
// publishable anon key (never forwards myClinic user JWTs across projects).

const CENTRAL_URL = (import.meta.env.VITE_CENTRAL_SUPABASE_URL ?? '').trim().replace(/\\/+$/, '');
const CENTRAL_ANON = (import.meta.env.VITE_CENTRAL_SUPABASE_ANON_KEY ?? '').trim();
const CACHE_KEY = 'myclinic.central.subscription.v2';
const DEVICE_KEY = 'myclinic.central.device_id.v2';
const PEPPER = 'myclinic-central-lease-v2:7f4c9a2e';

function getDeviceId() {
  const cur = localStorage.getItem(DEVICE_KEY);
  if (cur && /^[a-zA-Z0-9._:-]{8,96}$/.test(cur)) return cur;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const next = 'clinic-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(DEVICE_KEY, next);
  return next;
}

async function sealOf(lease, origin, email, deviceId) {
  const raw = [
    PEPPER, origin, email, deviceId,
    Boolean(lease?.allowed), lease?.status ?? '', lease?.tier ?? '',
    lease?.plan ?? '', lease?.doctors ?? '', lease?.frontdesk ?? '',
    lease?.branches ?? '', lease?.expires_at ?? '', lease?.grace_until ?? '',
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function syncMyClinicSubscription(ownerEmail = '') {
  if (!CENTRAL_URL || !CENTRAL_ANON) {
    return { allowed: true, status: 'local_mode', plan: 'growth' };
  }
  if (CENTRAL_ANON.startsWith('sb_secret_')) {
    throw new Error('Never put sb_secret_ in VITE_CENTRAL_SUPABASE_ANON_KEY');
  }

  const origin = window.location.origin.toLowerCase();
  const email = String(ownerEmail ?? '').trim().toLowerCase();
  const deviceId = getDeviceId();

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    apikey: CENTRAL_ANON,
  };
  if (!CENTRAL_ANON.startsWith('sb_publishable_')) {
    headers.Authorization = \`Bearer \${CENTRAL_ANON}\`;
  }

  try {
    const res = await fetch(\`\${CENTRAL_URL}/rest/v1/rpc/sync_clinic_subscription\`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_email: email, p_origin: origin, p_device_id: deviceId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || \`HTTP \${res.status}\`);

    if (!body?.allowed) {
      localStorage.removeItem(CACHE_KEY);
      return { ...body, allowed: false };
    }

    const seal = await sealOf(body, origin, email, deviceId);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ lease: body, seal }));
    return { ...body, allowed: true };
  } catch {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { allowed: false, status: 'offline_unverified', reason: 'Connect to internet once to activate.' };
    try {
      const saved = JSON.parse(raw);
      const expected = await sealOf(saved.lease, origin, email, deviceId);
      const now = Date.now();
      if (saved.seal !== expected || now >= Date.parse(saved.lease.expires_at) || now >= Date.parse(saved.lease.grace_until)) {
        localStorage.removeItem(CACHE_KEY);
        return { allowed: false, status: 'expired', reason: 'Subscription expired — contact admin.' };
      }
      return { ...saved.lease, allowed: true, offline: true };
    } catch {
      localStorage.removeItem(CACHE_KEY);
      return { allowed: false, status: 'expired', reason: 'Subscription verification required.' };
    }
  }
}`;

  const viteObfuscatorSnippet = `// Add to myClinic/vite.config.js (devDependency: npm i -D javascript-obfuscator)
import JavaScriptObfuscator from 'javascript-obfuscator';

function obfuscateSubscriptionGuard() {
  const GUARD_FILES = /src\\/(lib\\/central-subscription|components\\/SubscriptionGate)\\.[cm]?[jt]sx?$/;
  return {
    name: 'obfuscate-subscription-guard',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      if (!GUARD_FILES.test(id.replace(/\\\\/g, '/'))) return null;
      return {
        code: JavaScriptObfuscator.obfuscate(code, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          stringArray: true,
          stringArrayEncoding: ['rc4'],
          splitStrings: true,
          numbersToExpressions: true,
        }).getObfuscatedCode(),
        map: null,
      };
    },
  };
}
// In defineConfig({ plugins: [react(), obfuscateSubscriptionGuard()], build: { sourcemap: false } })`;

  return {
    envVars,
    clientModule,
    viteObfuscatorSnippet,
  };
}
