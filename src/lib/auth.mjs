/**
 * Pure zero-DOM Cloud Supabase authentication & privilege verification helpers
 * for the myClinic License Authority Control Plane.
 *
 * Security invariants:
 *  1. Zero local accounts and zero demo/offline bypass — every operator session
 *     authenticates over HTTPS against Cloud Supabase Auth.
 *  2. `isAuthorizedAdminUser()` checks ONLY immutable `app_metadata.role === 'admin'`
 *     and explicitly ignores mutable `user_metadata`.
 */

export const REQUIRED_ADMIN_ROLE = 'admin';
export const MIN_ADMIN_PASSWORD_LENGTH = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns true if and only if `user` is an authenticated Supabase operator
 * carrying `app_metadata.role === 'admin'`.
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
 * Friendly, zero-credential-leak copy for common Supabase Auth & network errors.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function formatAuthErrorMessage(error) {
  const msg = String(
    (error && typeof error === 'object' && 'message' in error
      ? error.message
      : error) ?? 'Authentication failed.',
  );
  if (/invalid login credentials/i.test(msg)) {
    return 'That email and password do not match an operator account.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Confirm this operator email in Supabase Authentication first, then sign in.';
  }
  if (/rate limit|too many/i.test(msg)) {
    return 'Too many authentication attempts. Wait a minute and try again.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Cannot reach Cloud Supabase over the internet. Check your connection and try again.';
  }
  return msg;
}

/**
 * Validates operator sign-in inputs before calling `supabase.auth.signInWithPassword`.
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
