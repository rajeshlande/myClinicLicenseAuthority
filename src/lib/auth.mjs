export const MIN_ADMIN_PASSWORD_LENGTH = 10;

/**
 * Zero-trust admin check mirroring `public.is_license_admin()` in `supabase/schema.sql`.
 * Strictly inspects immutable `app_metadata.role === 'admin'` and NEVER `user_metadata`
 * (which authenticated users can mutate themselves via `supabase.auth.updateUser`).
 */
export function isAuthorizedAdminUser(user) {
  if (!user || typeof user !== 'object' || !user.id) {
    return false;
  }
  return user.app_metadata?.role === 'admin';
}

export function describeAuthStanding(user) {
  if (!user || typeof user !== 'object' || !user.id) {
    return {
      status: 'signed_out',
      role: null,
      email: null,
    };
  }

  const appRole = user.app_metadata?.role ?? null;
  if (appRole === 'admin') {
    return {
      status: 'authorized_admin',
      role: 'admin',
      email: user.email ?? '',
    };
  }

  return {
    status: 'forbidden_role',
    role: appRole,
    email: user.email ?? '',
  };
}

export function validateSignInCredentials({ email, password } = {}) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (
    !cleanEmail ||
    cleanEmail.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)
  ) {
    return {
      ok: false,
      error: 'Enter a valid operator email address.',
    };
  }

  const rawPassword = String(password ?? '');
  if (!rawPassword) {
    return {
      ok: false,
      error: 'Enter your operator password.',
    };
  }

  return {
    ok: true,
    email: cleanEmail,
    password: rawPassword,
  };
}

export function validateEmailOnly(email) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (
    !cleanEmail ||
    cleanEmail.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)
  ) {
    return {
      ok: false,
      error: 'Enter a valid operator email address.',
    };
  }
  return { ok: true, email: cleanEmail };
}

export function validatePasswordUpdate({ password, confirmPassword } = {}) {
  const next = String(password ?? '');
  const confirm = String(confirmPassword ?? '');

  if (next.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `New password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`,
    };
  }

  if (next !== confirm) {
    return {
      ok: false,
      error: 'Password confirmation does not match.',
    };
  }

  return { ok: true, password: next };
}

/**
 * Builds a subpath-safe recovery redirect URL (`https://host/repo/#/reset-password`)
 * so Supabase password reset links work identically on localhost and GitHub Pages.
 */
export function buildPasswordRecoveryRedirectUrl(loc = globalThis.location) {
  const origin = String(loc?.origin ?? '').replace(/\/+$/, '');
  const pathname = String(loc?.pathname ?? '/');
  return `${origin}${pathname}#/reset-password`;
}

/**
 * Detects whether the current browser URL represents a Supabase password-recovery redirect.
 */
export function detectRecoveryFlowFromUrl(loc = globalThis.location) {
  const hash = String(loc?.hash ?? '');
  const search = String(loc?.search ?? '');
  return (
    hash.startsWith('#/reset-password') ||
    /(?:^|[#?&])type=recovery(?:&|$)/i.test(hash) ||
    /(?:^|[?&])type=recovery(?:&|$)/i.test(search)
  );
}
