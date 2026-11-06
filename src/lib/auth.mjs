/**
 * Pure zero-DOM authentication & privilege verification helpers for the
 * myClinic License Authority Control Plane.
 *
 * Security invariants:
 *  1. When Cloud Supabase is connected, `isAuthorizedAdminUser()` checks ONLY
 *     immutable `app_metadata.role === 'admin'` — NEVER `user_metadata` (which
 *     authenticated end-users can mutate via `supabase.auth.updateUser()`).
 *  2. Before Cloud Supabase is connected ("connect after login"), the console
 *     still enforces a strict login gate backed by a WebCrypto PBKDF2-SHA256
 *     (120,000 iterations, 128-bit random salt, constant-time verification)
 *     single-operator local vault — zero unauthenticated access and zero
 *     public self-service sign-up tab.
 */

export const REQUIRED_ADMIN_ROLE = 'admin';
export const MIN_ADMIN_PASSWORD_LENGTH = 10;
export const PBKDF2_ITERATIONS = 120_000;
export const LOCAL_OPERATOR_STORAGE_KEY = 'myclinic_local_operator_v1';
export const LOCAL_SESSION_STORAGE_KEY = 'myclinic_local_session_v1';
const LOCAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns true if and only if `user` is a verified operator carrying
 * `app_metadata.role === 'admin'`.
 *
 * @param {object | null | undefined} user
 * @returns {boolean}
 */
export function isAuthorizedAdminUser(user) {
  if (!user || typeof user !== 'object') return false;
  if (!user.id || typeof user.id !== 'string') return false;
  const appMeta = user.app_metadata;
  if (!appMeta || typeof appMeta !== 'object') return false;
  return appMeta.role === REQUIRED_ADMIN_ROLE;
}

/**
 * Validates operator sign-in inputs before dispatching authentication.
 *
 * @param {{ email?: string, password?: string }} input
 * @returns {{ ok: boolean, email: string, password: string, error?: string }}
 */
export function validateAdminCredentials(input = {}) {
  const email = String(input.email ?? '')
    .trim()
    .toLowerCase();
  const password = String(input.password ?? '');

  if (!email || !EMAIL_PATTERN.test(email)) {
    return {
      ok: false,
      email,
      password: '',
      error: 'Enter a valid operator email address.',
    };
  }
  if (!password || password.length < 6) {
    return {
      ok: false,
      email,
      password: '',
      error: 'Enter your operator password.',
    };
  }
  return { ok: true, email, password };
}

/**
 * Validates an email address for password-reset requests.
 *
 * @param {string} rawEmail
 * @returns {{ ok: boolean, email: string, error?: string }}
 */
export function validateRecoveryEmail(rawEmail) {
  const email = String(rawEmail ?? '')
    .trim()
    .toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return {
      ok: false,
      email,
      error: 'Enter the operator email registered in Supabase Auth.',
    };
  }
  return { ok: true, email };
}

/**
 * Enforces strong password rotation rules for admin operators.
 *
 * @param {{ password?: string, confirmPassword?: string }} input
 * @returns {{ ok: boolean, password: string, error?: string }}
 */
export function validatePasswordUpdate(input = {}) {
  const password = String(input.password ?? '');
  const confirmPassword = String(input.confirmPassword ?? '');

  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      password: '',
      error: `Operator password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirmPassword) {
    return {
      ok: false,
      password: '',
      error: 'Password confirmation does not match.',
    };
  }
  return { ok: true, password };
}

/**
 * Builds a clean redirect URL for Supabase password recovery emails that works
 * seamlessly on both root domains and GitHub Pages subpaths.
 *
 * @param {string} currentHref
 * @returns {string}
 */
export function buildPasswordRecoveryRedirectUrl(currentHref) {
  try {
    const parsed = new URL(String(currentHref));
    parsed.search = '';
    parsed.hash = '#/reset-password';
    return parsed.toString();
  } catch {
    return '#/reset-password';
  }
}

/**
 * Detects whether the current URL hash/query indicates an incoming Supabase
 * password-recovery flow.
 *
 * @param {{ hash?: string, search?: string }} loc
 * @returns {boolean}
 */
export function detectRecoveryFlowFromUrl(loc = globalThis.location ?? {}) {
  const hash = String(loc.hash ?? '');
  const search = String(loc.search ?? '');
  return (
    hash.includes('type=recovery') ||
    hash.startsWith('#/reset-password') ||
    search.includes('type=recovery')
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex ?? '').trim();
  if (clean.length === 0 || clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqualHex(a, b) {
  const strA = String(a ?? '');
  const strB = String(b ?? '');
  if (strA.length === 0 || strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i += 1) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePbkdf2Hex(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations,
    },
    baseKey,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function buildLocalSessionEnvelope(email, nowMs = Date.now()) {
  return {
    expires_at_ms: nowMs + LOCAL_SESSION_TTL_MS,
    user: {
      id: 'local-operator-root',
      email,
      auth_source: 'local_vault',
      app_metadata: { role: REQUIRED_ADMIN_ROLE },
      user_metadata: {},
    },
  };
}

/**
 * Returns the registered local operator email (if initialized), or null.
 */
export function getLocalOperatorInfo(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(LOCAL_OPERATOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed?.email ||
      !parsed?.saltHex ||
      !parsed?.hashHex ||
      !parsed?.iterations
    ) {
      return null;
    }
    return { email: parsed.email, createdAt: parsed.createdAt ?? null };
  } catch {
    return null;
  }
}

export function hasLocalAdminOperator(storage) {
  return Boolean(getLocalOperatorInfo(storage));
}

/**
 * One-time local operator bootstrap before Cloud Supabase is connected.
 * Refuses if an operator is already registered (preventing self-service sign-up).
 */
export async function bootstrapLocalAdminOperator({
  email,
  password,
  confirmPassword,
  storage,
} = {}) {
  const store = resolveStorage(storage);
  if (!store) {
    throw new Error('Browser storage is unavailable for local operator setup.');
  }
  if (hasLocalAdminOperator(store)) {
    throw new Error(
      'Local operator is already initialized. Sign in with your operator password.',
    );
  }

  const emailCheck = validateRecoveryEmail(email);
  if (!emailCheck.ok) {
    throw new Error('Enter a valid operator email address.');
  }
  const passCheck = validatePasswordUpdate({ password, confirmPassword });
  if (!passCheck.ok) {
    throw new Error(passCheck.error);
  }

  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const saltHex = bytesToHex(salt);
  const hashHex = await derivePbkdf2Hex(
    passCheck.password,
    salt,
    PBKDF2_ITERATIONS,
  );

  store.setItem(
    LOCAL_OPERATOR_STORAGE_KEY,
    JSON.stringify({
      email: emailCheck.email,
      saltHex,
      hashHex,
      iterations: PBKDF2_ITERATIONS,
      createdAt: new Date().toISOString(),
    }),
  );

  const session = buildLocalSessionEnvelope(emailCheck.email);
  store.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

/**
 * Verifies operator credentials against the PBKDF2-SHA256 local vault and
 * mints an authenticated local admin session.
 */
export async function signInLocalAdminOperator({
  email,
  password,
  storage,
} = {}) {
  const store = resolveStorage(storage);
  if (!store) {
    throw new Error('Browser storage is unavailable.');
  }
  const check = validateAdminCredentials({ email, password });
  if (!check.ok) {
    throw new Error(check.error);
  }

  const raw = store.getItem(LOCAL_OPERATOR_STORAGE_KEY);
  if (!raw) {
    throw new Error('No local operator initialized yet.');
  }

  const record = JSON.parse(raw);
  const saltBytes = hexToBytes(record.saltHex);
  const candidateHash = await derivePbkdf2Hex(
    check.password,
    saltBytes,
    Number(record.iterations) || PBKDF2_ITERATIONS,
  );

  const emailMatches =
    String(record.email).toLowerCase() === check.email.toLowerCase();
  const hashMatches = constantTimeEqualHex(candidateHash, record.hashHex);

  if (!emailMatches || !hashMatches) {
    throw new Error('Invalid operator email or password.');
  }

  const session = buildLocalSessionEnvelope(record.email);
  store.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

/**
 * Rotates the PBKDF2-SHA256 password for an authenticated local operator.
 */
export async function rotateLocalAdminPassword({
  password,
  confirmPassword,
  storage,
} = {}) {
  const store = resolveStorage(storage);
  if (!store) {
    throw new Error('Browser storage is unavailable.');
  }
  const passCheck = validatePasswordUpdate({ password, confirmPassword });
  if (!passCheck.ok) {
    throw new Error(passCheck.error);
  }
  const raw = store.getItem(LOCAL_OPERATOR_STORAGE_KEY);
  if (!raw) {
    throw new Error('No local operator account found.');
  }
  const record = JSON.parse(raw);
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const saltHex = bytesToHex(salt);
  const hashHex = await derivePbkdf2Hex(
    passCheck.password,
    salt,
    PBKDF2_ITERATIONS,
  );

  store.setItem(
    LOCAL_OPERATOR_STORAGE_KEY,
    JSON.stringify({
      ...record,
      saltHex,
      hashHex,
      iterations: PBKDF2_ITERATIONS,
      updatedAt: new Date().toISOString(),
    }),
  );
}

/**
 * Reads and validates the active local admin session (if not expired).
 */
export function readLocalAdminSession(storage, nowMs = Date.now()) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(LOCAL_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expires_at_ms || nowMs >= parsed.expires_at_ms) {
      store.removeItem(LOCAL_SESSION_STORAGE_KEY);
      return null;
    }
    if (!isAuthorizedAdminUser(parsed.user)) {
      store.removeItem(LOCAL_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signOutLocalAdminSession(storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(LOCAL_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage removal failures in locked browsers.
  }
}
