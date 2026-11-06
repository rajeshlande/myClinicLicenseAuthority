/**
 * Zero-Trust Cloud Supabase Configuration Inspector (`src/lib/health.mjs`).
 *
 * Accepts either `{ url, anonKey }` or Vite environment objects
 * (`{ VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY }`), refuses placeholder hosts,
 * and strictly blocks `service_role` or `sb_secret_` credentials from ever
 * running inside a browser bundle.
 */

function decodeJwtRoleClaim(maybeJwt) {
  const parts = String(maybeJwt ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = JSON.parse(atob(b64));
    return typeof json?.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

export function inspectSupabaseConfig(input = {}) {
  const rawUrl = input?.url ?? input?.VITE_SUPABASE_URL ?? '';
  const rawKey = input?.anonKey ?? input?.VITE_SUPABASE_ANON_KEY ?? '';
  const cleanUrl = String(rawUrl).trim();
  const cleanKey = String(rawKey).trim();

  if (!cleanUrl && !cleanKey) {
    return {
      ok: false,
      mode: 'unconfigured',
      reason:
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local or GitHub Repository Secrets to auto-connect to Cloud Supabase.',
    };
  }

  if (!cleanUrl || !cleanKey) {
    return {
      ok: false,
      mode: 'invalid',
      reason:
        'Both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set together.',
    };
  }

  if (
    /YOUR-PROJECT|your-project|abc\.supabase\.co|example\.com/i.test(cleanUrl) ||
    !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(cleanUrl)
  ) {
    return {
      ok: false,
      mode: 'invalid',
      reason:
        'Supabase URL must be a real https://<project-ref>.supabase.co endpoint.',
    };
  }

  if (
    /^sb_secret_/i.test(cleanKey) ||
    /service_role/i.test(cleanKey) ||
    decodeJwtRoleClaim(cleanKey) === 'service_role'
  ) {
    return {
      ok: false,
      mode: 'forbidden-secret',
      reason:
        'Refusing to boot: a service_role or sb_secret_ key was supplied to the browser. Use ONLY the public anon / sb_publishable_ key.',
    };
  }

  return {
    ok: true,
    mode: 'cloud',
    url: cleanUrl.replace(/\/+$/, ''),
    anonKey: cleanKey,
    reason: 'Auto-connected to Cloud Supabase Authority.',
  };
}
