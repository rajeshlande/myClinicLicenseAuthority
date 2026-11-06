import { createClient } from '@supabase/supabase-js';
import { inspectSupabaseConfig } from './health.mjs';

const RUNTIME_CONFIG_KEY = 'myclinic_authority_supabase_config_v2';

let cachedCloudClient = null;
let cachedCloudSignature = '';

function readRuntimeConfig() {
  try {
    const raw = window.localStorage.getItem(RUNTIME_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRuntimeSupabaseConfig({ url, anonKey }) {
  const check = inspectSupabaseConfig({ url, anonKey });
  if (check.mode !== 'cloud') {
    throw new Error(check.reason);
  }
  window.localStorage.setItem(
    RUNTIME_CONFIG_KEY,
    JSON.stringify({ url: check.url, anonKey: check.anonKey }),
  );
  return check;
}

export function clearRuntimeSupabaseConfig() {
  try {
    window.localStorage.removeItem(RUNTIME_CONFIG_KEY);
  } catch {
    // Ignore storage removal errors in restricted frames.
  }
  cachedCloudClient = null;
  cachedCloudSignature = '';
}

function getOrCreateCloudClient(url, anonKey) {
  const signature = `${url}::${anonKey}`;
  if (cachedCloudClient && cachedCloudSignature === signature) {
    return cachedCloudClient;
  }
  cachedCloudSignature = signature;
  cachedCloudClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return cachedCloudClient;
}

/**
 * Auto-connects on boot using `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
 * (same build-time secret pattern as `rajeshlande/myClinic`), with optional
 * runtime endpoint override. Zero local accounts and zero demo fallback.
 */
export function resolveAuthorityBackend() {
  const envCheck = inspectSupabaseConfig(import.meta.env);
  const runtime = readRuntimeConfig();
  const activeCheck =
    runtime?.url && runtime?.anonKey
      ? inspectSupabaseConfig({ url: runtime.url, anonKey: runtime.anonKey })
      : envCheck;

  if (activeCheck.mode === 'cloud') {
    const client = getOrCreateCloudClient(
      activeCheck.url,
      activeCheck.anonKey,
    );
    return {
      configured: true,
      mode: 'cloud',
      health: activeCheck,
      supabase: client,
      verifyUrl: `${activeCheck.url}/functions/v1/verify-license`,
      isRuntimeConfigured: Boolean(runtime?.url && runtime?.anonKey),
      hasBuildEnv: envCheck.mode === 'cloud',
    };
  }

  return {
    configured: false,
    mode: 'unconfigured',
    health: activeCheck,
    supabase: null,
    verifyUrl: '',
    isRuntimeConfigured: false,
    hasBuildEnv: false,
  };
}
