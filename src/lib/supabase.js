import { createClient } from '@supabase/supabase-js';
import { createDemoAuthority } from './demo-store.mjs';
import { inspectSupabaseConfig } from './health.mjs';

const SESSION_CONFIG_KEY = 'myclinic_authority_runtime_supabase';

function readRuntimeOverride() {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRuntimeSupabaseConfig({ url, anonKey }) {
  const check = inspectSupabaseConfig({ url, anonKey });
  if (!check.ok || check.mode !== 'cloud') {
    throw new Error(check.reason);
  }
  globalThis.sessionStorage?.setItem(
    SESSION_CONFIG_KEY,
    JSON.stringify({ url: check.url, anonKey: check.anonKey }),
  );
  return check;
}

export function clearRuntimeSupabaseConfig() {
  globalThis.sessionStorage?.removeItem(SESSION_CONFIG_KEY);
}

const demoAuthority = createDemoAuthority();

export function resolveAuthorityBackend() {
  const runtime = readRuntimeOverride();
  const url = runtime?.url ?? import.meta.env?.VITE_SUPABASE_URL ?? '';
  const anonKey =
    runtime?.anonKey ?? import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';

  const health = inspectSupabaseConfig({ url, anonKey });

  if (health.ok && health.mode === 'cloud') {
    return {
      mode: 'cloud',
      health,
      supabase: createClient(health.url, health.anonKey),
      verifyUrl: `${health.url}/functions/v1/verify-license`,
      demoAuthority,
    };
  }

  return {
    mode: 'demo',
    health,
    supabase: demoAuthority.client,
    verifyUrl: 'demo://functions/v1/verify-license',
    demoAuthority,
  };
}
