import { createClient } from '@supabase/supabase-js';
import { inspectSupabaseConfig } from './health.mjs';

const STORAGE_CONFIG_KEY = 'myclinic.authority.supabase.endpoint';

let cachedClientKey = '';
let cachedSupabaseClient = null;

function getOrCreateSupabaseClient(url, anonKey) {
  const key = `${url}|${anonKey}`;
  if (cachedSupabaseClient && cachedClientKey === key) {
    return cachedSupabaseClient;
  }
  cachedClientKey = key;
  cachedSupabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedSupabaseClient;
}

function readRuntimeOverride() {
  try {
    const raw =
      globalThis.localStorage?.getItem(STORAGE_CONFIG_KEY) ??
      globalThis.sessionStorage?.getItem(STORAGE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRuntimeSupabaseConfig({ url, anonKey }) {
  const check = inspectSupabaseConfig({ url, anonKey });
  if (!check.ok || check.mode !== 'cloud') {
    throw new Error(
      check.reason || 'Enter a valid https://<project>.supabase.co URL and public anon key.',
    );
  }
  const serialized = JSON.stringify({ url: check.url, anonKey: check.anonKey });
  try {
    globalThis.localStorage?.setItem(STORAGE_CONFIG_KEY, serialized);
  } catch {
    globalThis.sessionStorage?.setItem(STORAGE_CONFIG_KEY, serialized);
  }
  return check;
}

export function clearRuntimeSupabaseConfig() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_CONFIG_KEY);
    globalThis.sessionStorage?.removeItem(STORAGE_CONFIG_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export function hasBuildTimeSupabaseConfig() {
  return Boolean(
    import.meta.env?.VITE_SUPABASE_URL?.trim() &&
      import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim(),
  );
}

/**
 * Resolves the Cloud Supabase Authority backend.
 * Zero-trust rule: never falls back to an unauthenticated demo store in the UI;
 * unconfigured deployments remain locked at the authentication gate until connected.
 */
export function resolveAuthorityBackend() {
  const runtime = readRuntimeOverride();
  const url = runtime?.url ?? import.meta.env?.VITE_SUPABASE_URL ?? '';
  const anonKey =
    runtime?.anonKey ?? import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';

  const health = inspectSupabaseConfig({ url, anonKey });

  if (health.ok && health.mode === 'cloud') {
    return {
      mode: 'cloud',
      isRuntimeConfigured: Boolean(runtime?.url),
      health,
      supabase: getOrCreateSupabaseClient(health.url, health.anonKey),
      verifyUrl: `${health.url}/functions/v1/verify-license`,
    };
  }

  return {
    mode: 'unconfigured',
    isRuntimeConfigured: false,
    health,
    supabase: null,
    verifyUrl: '',
  };
}
