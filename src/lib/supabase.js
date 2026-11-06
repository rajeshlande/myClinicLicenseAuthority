import { createClient } from '@supabase/supabase-js';
import { createDemoAuthority } from './demo-store.mjs';
import { inspectSupabaseConfig } from './health.mjs';

const RUNTIME_CONFIG_KEY = 'myclinic_authority_supabase_config_v1';

const localAuthority = createDemoAuthority();
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
  const check = inspectSupabaseConfig({
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anonKey,
  });
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
  window.localStorage.removeItem(RUNTIME_CONFIG_KEY);
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
    },
  });
  return cachedCloudClient;
}

/**
 * Resolves the Authority data backend.
 * Note: Both `'cloud'` and `'local'` modes remain strictly gated behind
 * operator authentication in `App.jsx` (`LoginPage.jsx`); `'local'` allows the
 * operator to sign in first and connect `Authority Supabase Project URL` +
 * `Public Publishable / Anon Key` after login under `#/setup`.
 */
export function resolveAuthorityBackend() {
  const runtime = readRuntimeConfig();
  const envCheck = inspectSupabaseConfig(
    runtime
      ? {
          VITE_SUPABASE_URL: runtime.url,
          VITE_SUPABASE_ANON_KEY: runtime.anonKey,
        }
      : import.meta.env,
  );

  if (envCheck.mode === 'cloud') {
    const client = getOrCreateCloudClient(envCheck.url, envCheck.anonKey);
    return {
      mode: 'cloud',
      health: envCheck,
      supabase: client,
      localAuthority,
      verifyUrl: `${envCheck.url}/functions/v1/verify-license`,
      isRuntimeConfigured: Boolean(runtime),
    };
  }

  return {
    mode: 'local',
    health: envCheck,
    supabase: localAuthority.client,
    localAuthority,
    verifyUrl: '',
    isRuntimeConfigured: false,
  };
}
