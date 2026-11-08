/**
 * Actionable error handling and sanitized diagnostics for myClinicLicenseAuthority.
 *
 * Operators should never see a cryptic PostgREST code, raw stack trace, or silent
 * failure without knowing what went wrong and the exact step to fix it.
 *
 * Every failure maps into an actionable bucket:
 *   schema        Database is missing a table, column, view, or RPC → apply supabase/schema.sql
 *   role          Account lacks app_metadata.role = "admin"        → run the admin SQL grant
 *   signin        Session expired or missing                        → sign in again
 *   credentials   Wrong email/password or unconfirmed account       → verify credentials
 *   seat_limit    Hardware/origin node limit reached (53400)        → release a node or raise max_machines
 *   license_state Kill-switched, expired, or origin/node mismatch   → enable, extend, or match node
 *   edge_config   verify-license Edge Function missing/misconfigured→ set secret & deploy function
 *   rate_limit    Too many requests (429)                           → wait briefly and retry
 *   network       Offline, DNS failure, CORS block, or timeout      → check URL/internet and retry
 *   input         Invalid field, duplicate record, or wrong PEM key → fix the highlighted field
 *   retry         Unexpected error                                  → retry or copy diagnostics
 */

import { SCHEMA_VERSION } from './version.js';

const FIX_BUCKETS = {
  schema: {
    label: 'Apply database schema',
    hint: (target = '') =>
      `Your Authority database is missing ${target || 'required schema objects'}. Open Supabase Dashboard → SQL Editor, paste the full supabase/schema.sql file, and click Run (safe and idempotent; lands on schema v${SCHEMA_VERSION}).`,
  },
  role: {
    label: 'Grant admin role',
    hint: () =>
      'This account does not have app_metadata.role = "admin". Run the 3-line Admin Role SQL snippet in Supabase Dashboard → SQL Editor, then click "Check again" or sign in again.',
  },
  signin: {
    label: 'Sign in again',
    hint: () =>
      'Your operator session expired or was invalidated. Sign in again to refresh your access token.',
  },
  credentials: {
    label: 'Check credentials',
    hint: () =>
      'Verify your operator email and password (or use "Forgot password?"). Ensure the user exists under Supabase Dashboard → Authentication → Users with Email confirmed.',
  },
  seat_limit: {
    label: 'Release or add seats',
    hint: () =>
      'All allowed hardware/web seats (max_machines) for this license are occupied. Open Licenses → Inspect on this license to release an old machine node or increase max_machines.',
  },
  license_state: {
    label: 'Check license standing',
    hint: () =>
      'Verify that the license key exists, its Kill-Switch is enabled (active), its subscription expiration date is in the future, and the machine fingerprint or web origin matches.',
  },
  edge_config: {
    label: 'Configure Edge Function',
    hint: () =>
      'In Authority Supabase → Edge Functions: 1) add secret LICENSE_PRIVATE_KEY under Secrets, 2) deploy verify-license via Editor, and 3) turn OFF "Verify JWT" in the function settings.',
  },
  edge_not_deployed: {
    label: 'Deploy verify-license',
    hint: () =>
      'Open Authority Supabase → Edge Functions → "Deploy a new function → Via Editor", set Function name to exact lowercase "verify-license", turn OFF "Verify JWT", paste "2. Function Script", and click Deploy.',
  },
  edge_jwt: {
    label: 'Turn OFF Verify JWT',
    hint: () =>
      'Open Authority Supabase → Edge Functions → verify-license → Details (or Settings), switch OFF "Enforce JWT Verification" / "Verify JWT with legacy secret", and click Save.',
  },
  edge_secret: {
    label: 'Add LICENSE_PRIVATE_KEY',
    hint: () =>
      'verify-license is deployed, but LICENSE_PRIVATE_KEY is missing or invalid. Open Authority Supabase → Edge Functions → Secrets, add LICENSE_PRIVATE_KEY with "1. Private Key" from Step 2, and Save.',
  },
  rate_limit: {
    label: 'Wait & retry',
    hint: () =>
      'Too many requests hit the endpoint in a short window. Wait 30–60 seconds and try again.',
  },
  network: {
    label: 'Check connection',
    hint: () =>
      'Could not reach the cloud endpoint. Check your internet connection, confirm VITE_SUPABASE_URL points to https://<project-ref>.supabase.co, and try again.',
  },
  input: {
    label: 'Fix input value',
    hint: () =>
      'One of the submitted values failed validation. Review the highlighted message above and submit again.',
  },
  retry: {
    label: 'Retry or copy diagnostics',
    hint: () =>
      'Try the action again. If it persists, open Settings → Diagnostics and copy the sanitized error log.',
  },
};

function buildExplained({
  code = '',
  title,
  fix = 'retry',
  target = '',
  raw = '',
  hint = '',
}) {
  const bucket = FIX_BUCKETS[fix] ?? FIX_BUCKETS.retry;
  const sanitizedRaw = sanitizeDiagnosticText(raw);
  return {
    code,
    title,
    message: title,
    hint: hint || bucket.hint(target),
    fix,
    fixLabel: bucket.label,
    detail: sanitizedRaw,
  };
}

/** Extract missing column/table from PostgREST or PostgreSQL error text. */
export function missingColumn(message = '') {
  const text = String(message);
  const m =
    text.match(/could not find the '([^']+)' column of '([^']+)'/i) ??
    text.match(/column "([^"]+)" of relation "([^"]+)" does not exist/i);
  return m ? { column: m[1], table: m[2] } : null;
}

/** Extract missing relation/view/function from PostgREST or PostgreSQL error text. */
export function missingSchemaObject(message = '') {
  const text = String(message);
  const rel =
    text.match(/could not find the table '([^']+)'/i) ??
    text.match(/relation "([^"]+)" does not exist/i);
  if (rel) return { kind: 'relation', name: rel[1] };

  const fn =
    text.match(/could not find the function ([^\s(]+)/i) ??
    text.match(/function ([a-z0-9_."]+)\([^)]*\) does not exist/i);
  if (fn) return { kind: 'function', name: fn[1] };
  return null;
}

/**
 * Redact tokens, secret keys, PEM blocks, passwords, and 32-hex license keys
 * so diagnostic logs can be safely shared in support tickets or GitHub issues.
 */
export function sanitizeDiagnosticText(input = '') {
  return String(input ?? '')
    .replace(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      '[REDACTED_PEM_KEY]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\bsb_secret_[A-Za-z0-9_-]+/g, '[REDACTED_SUPABASE_SECRET]')
    .replace(/\b[A-Fa-f0-9]{32}\b/g, '[REDACTED_LICENSE_KEY]')
    .replace(/(password\s*[:=]\s*)([^\s,&]+)/gi, '$1[REDACTED]');
}

/**
 * Build the exact Supabase SQL snippet to promote an operator account to admin.
 */
export function buildAdminGrantSql(email = 'ops@yourdomain.com') {
  const safeEmail = String(email || 'ops@yourdomain.com')
    .trim()
    .toLowerCase()
    .replace(/'/g, "''");
  return [
    'update auth.users',
    `set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb`,
    `where email = '${safeEmail || 'ops@yourdomain.com'}';`,
  ].join('\n');
}

/**
 * Validate a public key PEM/escaped input so operators never paste a PRIVATE KEY
 * into client-facing configuration by mistake.
 */
export function validatePublicKeyPemInput(value = '') {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return { ok: true, empty: true, normalized: '' };
  }
  if (/PRIVATE KEY/i.test(trimmed)) {
    return {
      ok: false,
      error:
        'Stop — you pasted a PRIVATE KEY into a PUBLIC KEY field. Keep LICENSE_PRIVATE_KEY strictly inside Authority Edge Function secrets and paste only LICENSE_PUBLIC_KEY (`BEGIN PUBLIC KEY`) here.',
    };
  }
  const unescaped = trimmed.replace(/\\n/g, '\n');
  if (
    !/-----BEGIN PUBLIC KEY-----/.test(unescaped) ||
    !/-----END PUBLIC KEY-----/.test(unescaped)
  ) {
    return {
      ok: false,
      error:
        'Public key must be a valid SPKI PEM block starting with `-----BEGIN PUBLIC KEY-----` and ending with `-----END PUBLIC KEY-----`.',
    };
  }
  return {
    ok: true,
    empty: false,
    normalized: unescaped.trim(),
    escaped: unescaped.trim().replace(/\r?\n/g, '\\n'),
  };
}

/**
 * Validate an HTTPS/HTTP origin or endpoint URL entered by an operator.
 */
export function validateEndpointUrlInput(value = '', { label = 'URL', allowHttpLocalhost = true } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { ok: true, empty: true, normalized: '' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: `${label} must be a valid URL starting with https:// (for example, https://your-ref.supabase.co).`,
    };
  }

  const isLocal =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(allowHttpLocalhost && parsed.protocol === 'http:' && isLocal)) {
    return {
      ok: false,
      error: `${label} must use https:// in production (http:// is only permitted for localhost testing).`,
    };
  }

  return {
    ok: true,
    empty: false,
    normalized: trimmed.replace(/\/+$/, ''),
    origin: parsed.origin,
  };
}

/**
 * Fetch wrapper with AbortController timeout so hung connections fail cleanly.
 */
export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 12000,
  fetchImpl = globalThis.fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s while contacting ${url}`,
      );
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn any thrown error, PostgrestError, AuthError, or Edge Function error payload
 * into a structured, human-readable explanation with a step-by-step fix hint.
 */
export function explainError(error, { context = 'Operation failed' } = {}) {
  const raw = String(
    error?.message ?? error?.error_description ?? error?.error ?? error ?? '',
  ).trim();
  const code = String(error?.code ?? error?.error_code ?? '');
  const status = Number(error?.status ?? error?.statusCode ?? 0);

  const missingCol = missingColumn(raw);
  const missingObj = missingSchemaObject(raw);

  // 1. Missing schema column / table / view / RPC
  if (
    missingCol ||
    missingObj ||
    code === 'PGRST204' ||
    code === 'PGRST202' ||
    code === '42703' ||
    code === '42P01' ||
    code === '42883' ||
    /schema cache/i.test(raw)
  ) {
    const target = missingCol
      ? `column "${missingCol.column}" on ${missingCol.table}`
      : missingObj
        ? `${missingObj.kind} "${missingObj.name}"`
        : 'the latest database schema';
    return buildExplained({
      code: code || 'SCHEMA_MISMATCH',
      title: `${context}: ${target} was not found in Supabase.`,
      fix: 'schema',
      target,
      raw,
    });
  }

  // 2. Hardware / web seat cap exceeded (PostgreSQL 53400 or Edge 403)
  if (
    code === '53400' ||
    /MAX_MACHINES_EXCEEDED|maximum.*machines|seat limit|hardware lock limit/i.test(raw)
  ) {
    return buildExplained({
      code: code || '53400',
      title: `${context}: maximum hardware/origin seats reached for this license.`,
      fix: 'seat_limit',
      raw,
    });
  }

  // 3. License standing / kill-switch / origin or fingerprint mismatch
  if (
    /KEY_KILLED|kill.?switch|license.*revoked|license.*suspended/i.test(raw)
  ) {
    return buildExplained({
      code: code || 'KEY_KILLED',
      title: `${context}: this license key is currently suspended (Kill-Switch active).`,
      fix: 'license_state',
      raw,
      hint: 'Go to Licenses (#/dashboard), locate this clinic, and click "Enable" to restore token renewals.',
    });
  }

  if (
    /SUBSCRIPTION_INACTIVE|subscription.*expired|LICENSE_EXPIRED/i.test(raw) ||
    status === 402
  ) {
    return buildExplained({
      code: code || 'SUBSCRIPTION_INACTIVE',
      title: `${context}: the clinic subscription is expired or inactive.`,
      fix: 'license_state',
      raw,
      hint: 'Open Licenses → Inspect on this clinic, choose a future Expiration Date (+1 year), and click Save Term.',
    });
  }

  if (/LICENSE_NOT_FOUND|invalid license_key|unknown license/i.test(raw)) {
    return buildExplained({
      code: code || 'LICENSE_NOT_FOUND',
      title: `${context}: license key was not found in the Authority database.`,
      fix: 'license_state',
      raw,
      hint: 'Copy the exact 32-character hex key from Licenses (#/dashboard) or issue a new license.',
    });
  }

  if (/ORIGIN_MISMATCH|FINGERPRINT_MISMATCH/i.test(raw)) {
    return buildExplained({
      code: code || 'NODE_MISMATCH',
      title: `${context}: token is bound to a different machine fingerprint or web origin.`,
      fix: 'license_state',
      raw,
      hint: 'Ensure machine_fingerprint (or web:<origin>) matches the clinic host, or release the old node under Licenses → Inspect.',
    });
  }

  // 4. Edge Function secret / JWT toggle / deployment issues
  if (code === 'EDGE_JWT_ENABLED') {
    return buildExplained({
      code,
      title: `${context}: verify-license is deployed, but "Verify JWT" is still turned ON.`,
      fix: 'edge_jwt',
      raw,
    });
  }

  if (code === 'EDGE_NOT_DEPLOYED') {
    return buildExplained({
      code,
      title: `${context}: verify-license is not deployed yet on your Authority Supabase project.`,
      fix: 'edge_not_deployed',
      raw,
    });
  }

  if (code === 'SIGNER_SECRET_MISSING') {
    return buildExplained({
      code,
      title: `${context}: LICENSE_PRIVATE_KEY secret is not saved in Supabase yet.`,
      fix: 'edge_secret',
      raw,
    });
  }

  if (
    /LICENSE_PRIVATE_KEY|FunctionsFetchError|edge function|signing key/i.test(raw) ||
    status === 502 ||
    status === 503
  ) {
    return buildExplained({
      code: code || String(status || 'EDGE_CONFIG'),
      title: `${context}: the verify-license Edge Function needs configuration in Supabase.`,
      fix: 'edge_config',
      raw,
    });
  }

  // 5. RLS / Non-admin role refusal
  if (
    code === '42501' ||
    /row-level security|permission denied|insufficient privilege|app_metadata\.role/i.test(
      raw,
    )
  ) {
    return buildExplained({
      code: code || '42501',
      title: `${context}: administrator privileges (app_metadata.role = "admin") are required.`,
      fix: 'role',
      raw,
    });
  }

  // 6. Auth credentials vs expired session
  if (/invalid login credentials|invalid email or password/i.test(raw)) {
    return buildExplained({
      code: code || 'INVALID_CREDENTIALS',
      title: `${context}: incorrect email or password.`,
      fix: 'credentials',
      raw,
    });
  }

  if (/email not confirmed/i.test(raw)) {
    return buildExplained({
      code: code || 'EMAIL_NOT_CONFIRMED',
      title: `${context}: operator email address is not confirmed yet.`,
      fix: 'credentials',
      raw,
      hint: 'Open Supabase Dashboard → Authentication → Users, select this user, and confirm the email address.',
    });
  }

  if (
    status === 401 ||
    /JWT expired|invalid JWT|not authenticated|AuthSessionMissingError|session.*expired|refresh_token/i.test(
      raw,
    )
  ) {
    return buildExplained({
      code: code || '401',
      title: `${context}: your operator session has expired.`,
      fix: 'signin',
      raw,
    });
  }

  // 7. Rate limit
  if (
    status === 429 ||
    /rate limit|too many requests|over_email_send_rate_limit/i.test(raw)
  ) {
    return buildExplained({
      code: code || '429',
      title: `${context}: rate limit reached — too many requests right now.`,
      fix: 'rate_limit',
      raw,
    });
  }

  // 8. Input / constraint errors
  if (code === '23505' || /duplicate key|already exists/i.test(raw)) {
    return buildExplained({
      code: code || '23505',
      title: `${context}: a record with that unique value already exists.`,
      fix: 'input',
      raw,
    });
  }

  if (code === '23514' || /violates check constraint/i.test(raw)) {
    const constraint = String(raw).match(/constraint "([^"]+)"/i)?.[1] ?? '';
    return buildExplained({
      code: code || '23514',
      title: `${context}: value out of allowed range${constraint ? ` (${constraint.replace(/_/g, ' ')})` : ''}.`,
      fix: 'input',
      raw,
    });
  }

  if (
    code === '22P02' ||
    /invalid input syntax|service_role|sb_secret_|PRIVATE KEY/i.test(raw)
  ) {
    return buildExplained({
      code: code || 'INVALID_INPUT',
      title: `${context}: ${raw || 'invalid input format.'}`,
      fix: 'input',
      raw,
    });
  }

  // 9. Network / offline / timeout (with special detection for Edge Function CORS 404/401)
  if (
    code === 'ETIMEDOUT' ||
    /failed to fetch|networkerror|load failed|timed out|offline|ERR_NETWORK|fetch failed/i.test(
      raw,
    )
  ) {
    if (/verify-license|edge function/i.test(context)) {
      return buildExplained({
        code: 'EDGE_CORS_OR_UNDEPLOYED',
        title: `${context}: Supabase blocked the browser request (verify-license is not deployed yet, or "Verify JWT" is still ON).`,
        fix: 'edge_config',
        raw,
      });
    }
    return buildExplained({
      code: code || 'NETWORK_ERROR',
      title: `${context}: could not reach the server.`,
      fix: 'network',
      raw,
    });
  }

  // 10. Fallback
  return buildExplained({
    code: code || (status ? String(status) : ''),
    title: `${context}${raw ? ` — ${sanitizeDiagnosticText(raw)}` : '.'}`,
    fix: 'retry',
    raw,
  });
}

/** Single-line summary suitable for compact toast notifications. */
export function errorLine(error, options) {
  const explained = explainError(error, options);
  return explained.fix === 'retry' && !explained.detail
    ? explained.message
    : `${explained.message} ${explained.hint}`;
}

const RECENT_ERRORS = [];
const MAX_RECENT_ERRORS = 8;

/** Record a sanitized error entry for Settings → Diagnostics. */
export function rememberError(error, context = 'Console action') {
  const explained =
    typeof error === 'object' && error !== null && error.fix && error.message
      ? error
      : explainError(error, { context });
  const entry = {
    ...explained,
    context,
    at: new Date().toISOString(),
  };
  RECENT_ERRORS.unshift(entry);
  if (RECENT_ERRORS.length > MAX_RECENT_ERRORS) {
    RECENT_ERRORS.length = MAX_RECENT_ERRORS;
  }
  return explained;
}

export function recentErrors() {
  return [...RECENT_ERRORS];
}

export function clearRecentErrors() {
  RECENT_ERRORS.length = 0;
}

/** Copy-safe diagnostics report with secrets and tokens redacted. */
export function diagnosticsText({
  app = '',
  schema = SCHEMA_VERSION,
  route = '',
} = {}) {
  const rows = recentErrors().map(
    (entry) =>
      `- ${entry.at} · ${entry.context || 'app'} · [${entry.code || entry.fix}] ${sanitizeDiagnosticText(entry.detail || entry.message)}`,
  );
  return [
    `myClinicLicenseAuthority v${app || 'unknown'} · schema v${schema}${route ? ` · route #/${route}` : ''}`,
    `online: ${typeof navigator !== 'undefined' ? String(navigator.onLine) : 'unknown'}`,
    `userAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'node'}`,
    rows.length > 0 ? rows.join('\n') : '- no recent errors recorded',
  ].join('\n');
}

/**
 * Two-stage diagnostic probe for /functions/v1/verify-license:
 *  1. Sends POST `{"healthcheck":true}` WITHOUT an Authorization header (matching how
 *     myClinic's sync-clinic-license calls verify-license).
 *  2. If the browser throws `Failed to fetch` (which happens when Supabase's API gateway
 *     returns a non-CORS 401 or 404 before Edge code runs), retries WITH `Bearer <anonKey>`
 *     to distinguish "Verify JWT left ON" from "Function not deployed yet".
 */
export async function probeVerifyLicenseEndpoint(
  verifyEndpoint,
  { anonKey = '', timeoutMs = 10000, fetchImpl = globalThis.fetch } = {},
) {
  const makeError = (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
  };

  let res;
  try {
    res = await fetchWithTimeout(
      verifyEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthcheck: true }),
      },
      timeoutMs,
      fetchImpl,
    );
  } catch (firstErr) {
    if (firstErr?.code === 'ETIMEDOUT') {
      throw firstErr;
    }

    // Browser CORS blocked a gateway 401 ("Verify JWT" ON) or 404 (not deployed).
    // Retry with Bearer anonKey to tell the user which exact button to click!
    if (anonKey) {
      try {
        const authedRes = await fetchWithTimeout(
          verifyEndpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
            },
            body: JSON.stringify({ healthcheck: true }),
          },
          timeoutMs,
          fetchImpl,
        );
        if (authedRes.status !== 404) {
          throw makeError(
            'EDGE_JWT_ENABLED',
            'verify-license responded only with a JWT header — "Verify JWT" is still turned ON.',
          );
        }
      } catch (secondErr) {
        if (secondErr?.code === 'EDGE_JWT_ENABLED') {
          throw secondErr;
        }
      }
    }

    throw makeError(
      'EDGE_NOT_DEPLOYED',
      `Could not reach ${verifyEndpoint} — verify-license is not deployed yet (or "Verify JWT" is ON).`,
    );
  }

  const payload = await res.json().catch(() => ({}));

  if (res.status === 200 && payload?.signer_ready) {
    return {
      ok: true,
      signerVerified: true,
      message:
        'Step 2 verified — verify-license is online & LICENSE_PRIVATE_KEY is valid.',
    };
  }

  // Older deployed verify-license versions without healthcheck return 400 on missing license_key
  if (
    res.status === 400 &&
    /license_key/i.test(String(payload?.error ?? ''))
  ) {
    return {
      ok: true,
      signerVerified: false,
      message: 'verify-license is deployed and reachable.',
    };
  }

  if (res.status === 401) {
    throw makeError(
      'EDGE_JWT_ENABLED',
      'Supabase returned 401 Unauthorized — turn OFF "Verify JWT" on verify-license.',
    );
  }

  if (res.status === 404) {
    throw makeError(
      'EDGE_NOT_DEPLOYED',
      'Supabase returned 404 Not Found — deploy verify-license first.',
    );
  }

  if (
    res.status === 503 ||
    payload?.code === 'SIGNER_SECRET_MISSING' ||
    /LICENSE_PRIVATE_KEY/i.test(String(payload?.error ?? ''))
  ) {
    throw makeError(
      'SIGNER_SECRET_MISSING',
      payload?.error ||
        'LICENSE_PRIVATE_KEY secret is missing or invalid in Edge Functions -> Secrets.',
    );
  }

  throw makeError(
    'EDGE_CONFIG',
    payload?.error || `verify-license returned HTTP ${res.status}.`,
  );
}
