import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapLocalAdminOperator,
  buildPasswordRecoveryRedirectUrl,
  detectRecoveryFlowFromUrl,
  hasLocalAdminOperator,
  isAuthorizedAdminUser,
  readLocalAdminSession,
  rotateLocalAdminPassword,
  signInLocalAdminOperator,
  signOutLocalAdminSession,
  validateAdminCredentials,
  validatePasswordUpdate,
  validateRecoveryEmail,
} from '../src/lib/auth.mjs';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('isAuthorizedAdminUser requires app_metadata.role === admin and ignores user_metadata', () => {
  assert.equal(isAuthorizedAdminUser(null), false);
  assert.equal(isAuthorizedAdminUser(undefined), false);
  assert.equal(isAuthorizedAdminUser({}), false);

  // Privilege escalation attempt via user_metadata must be rejected
  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-1',
      email: 'attacker@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: { role: 'admin' },
    }),
    false,
  );

  // Authenticated non-admin operator must be rejected
  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-2',
      email: 'staff@example.com',
      app_metadata: { role: 'viewer' },
    }),
    false,
  );

  // Immutable app_metadata.role === 'admin' must be accepted
  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-3',
      email: 'ops@myclinic.io',
      app_metadata: { role: 'admin' },
    }),
    true,
  );
});

test('credential, password reset, and recovery URL helpers validate strictly', () => {
  assert.equal(
    validateAdminCredentials({ email: 'not-an-email', password: 'secretPassword1' }).ok,
    false,
  );
  assert.equal(
    validateAdminCredentials({ email: 'ops@myclinic.io', password: '123' }).ok,
    false,
  );
  const validLogin = validateAdminCredentials({
    email: '  OPS@MyClinic.io ',
    password: 'StrongPassword#2026',
  });
  assert.equal(validLogin.ok, true);
  assert.equal(validLogin.email, 'ops@myclinic.io');

  assert.equal(validateRecoveryEmail('bad').ok, false);
  assert.equal(validateRecoveryEmail('Admin@Domain.com').email, 'admin@domain.com');

  assert.equal(
    validatePasswordUpdate({ password: 'short', confirmPassword: 'short' }).ok,
    false,
  );
  assert.equal(
    validatePasswordUpdate({
      password: 'ValidLongPassword1!',
      confirmPassword: 'MismatchPassword1!',
    }).ok,
    false,
  );
  assert.equal(
    validatePasswordUpdate({
      password: 'ValidLongPassword1!',
      confirmPassword: 'ValidLongPassword1!',
    }).ok,
    true,
  );

  assert.equal(
    buildPasswordRecoveryRedirectUrl(
      'https://org.github.io/myclinic-license-authority/?foo=1#/dashboard',
    ),
    'https://org.github.io/myclinic-license-authority/#/reset-password',
  );

  assert.equal(
    detectRecoveryFlowFromUrl({
      hash: '#access_token=abc&type=recovery',
      search: '',
    }),
    true,
  );
  assert.equal(
    detectRecoveryFlowFromUrl({ hash: '#/dashboard', search: '' }),
    false,
  );
});

test('PBKDF2 local operator vault bootstraps once, authenticates, rotates password, and blocks re-signup', async () => {
  const storage = createMemoryStorage();
  assert.equal(hasLocalAdminOperator(storage), false);
  assert.equal(readLocalAdminSession(storage), null);

  const initialSession = await bootstrapLocalAdminOperator({
    email: 'OPS@MyClinic.io',
    password: 'InitialMasterPassword#2026',
    confirmPassword: 'InitialMasterPassword#2026',
    storage,
  });
  assert.equal(hasLocalAdminOperator(storage), true);
  assert.equal(isAuthorizedAdminUser(initialSession.user), true);
  assert.equal(initialSession.user.email, 'ops@myclinic.io');

  // Second bootstrap attempt must fail (no self-service sign-up tab)
  await assert.rejects(() =>
    bootstrapLocalAdminOperator({
      email: 'intruder@example.com',
      password: 'AnotherPassword#2026',
      confirmPassword: 'AnotherPassword#2026',
      storage,
    }),
  );

  // Sign out clears active session
  signOutLocalAdminSession(storage);
  assert.equal(readLocalAdminSession(storage), null);

  // Wrong password fails
  await assert.rejects(() =>
    signInLocalAdminOperator({
      email: 'ops@myclinic.io',
      password: 'WrongPassword#2026',
      storage,
    }),
  );

  // Correct password succeeds
  const signedIn = await signInLocalAdminOperator({
    email: 'ops@myclinic.io',
    password: 'InitialMasterPassword#2026',
    storage,
  });
  assert.equal(isAuthorizedAdminUser(signedIn.user), true);

  // Rotate password and verify old password no longer works
  await rotateLocalAdminPassword({
    password: 'RotatedMasterPassword#2027',
    confirmPassword: 'RotatedMasterPassword#2027',
    storage,
  });
  signOutLocalAdminSession(storage);

  await assert.rejects(() =>
    signInLocalAdminOperator({
      email: 'ops@myclinic.io',
      password: 'InitialMasterPassword#2026',
      storage,
    }),
  );

  const afterRotate = await signInLocalAdminOperator({
    email: 'ops@myclinic.io',
    password: 'RotatedMasterPassword#2027',
    storage,
  });
  assert.equal(isAuthorizedAdminUser(afterRotate.user), true);
});
