import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPasswordRecoveryRedirectUrl,
  detectRecoveryFlowFromUrl,
  formatAuthErrorMessage,
  isAuthorizedAdminUser,
  validateAdminCredentials,
  validatePasswordUpdate,
  validateRecoveryEmail,
} from '../src/lib/auth.mjs';

test('isAuthorizedAdminUser requires app_metadata.role === admin and ignores user_metadata', () => {
  assert.equal(isAuthorizedAdminUser(null), false);
  assert.equal(isAuthorizedAdminUser(undefined), false);
  assert.equal(isAuthorizedAdminUser({}), false);

  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-1',
      email: 'attacker@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: { role: 'admin' },
    }),
    false,
  );

  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-2',
      email: 'staff@example.com',
      app_metadata: { role: 'viewer' },
    }),
    false,
  );

  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-3',
      email: 'ops@myclinic.io',
      app_metadata: { role: 'admin' },
    }),
    true,
  );
});

test('credential, password reset, error formatting, and recovery URL helpers validate strictly', () => {
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

  assert.match(
    formatAuthErrorMessage(new Error('Invalid login credentials')),
    /do not match an operator account/i,
  );
  assert.match(
    formatAuthErrorMessage(new Error('Failed to fetch')),
    /Cannot reach Cloud Supabase/i,
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
