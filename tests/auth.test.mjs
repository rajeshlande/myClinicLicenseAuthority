import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPasswordRecoveryRedirectUrl,
  describeAuthStanding,
  detectRecoveryFlowFromUrl,
  isAuthorizedAdminUser,
  validatePasswordUpdate,
  validateSignInCredentials,
} from '../src/lib/auth.mjs';

test('isAuthorizedAdminUser requires app_metadata.role === admin and ignores user_metadata', () => {
  assert.equal(isAuthorizedAdminUser(null), false);
  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-1',
      email: 'attacker@clinic.in',
      user_metadata: { role: 'admin' },
      app_metadata: {},
    }),
    false,
  );
  assert.equal(
    isAuthorizedAdminUser({
      id: 'user-2',
      email: 'ops@yourdomain.com',
      app_metadata: { role: 'admin' },
    }),
    true,
  );

  assert.equal(
    describeAuthStanding({
      id: 'user-3',
      email: 'staff@yourdomain.com',
      app_metadata: { role: 'viewer' },
    }).status,
    'forbidden_role',
  );
});

test('credential, password reset, and recovery URL helpers validate strictly', () => {
  const creds = validateSignInCredentials({
    email: ' Ops@YourDomain.com ',
    password: 'StrongPassword!123',
  });
  assert.equal(creds.ok, true);
  assert.equal(creds.email, 'ops@yourdomain.com');

  assert.equal(
    validateSignInCredentials({ email: 'invalid', password: 'abc' }).ok,
    false,
  );

  assert.equal(
    validatePasswordUpdate({ password: 'short', confirmPassword: 'short' }).ok,
    false,
  );
  assert.equal(
    validatePasswordUpdate({
      password: 'ValidLongPassword123',
      confirmPassword: 'MismatchPassword123',
    }).ok,
    false,
  );
  assert.equal(
    validatePasswordUpdate({
      password: 'ValidLongPassword123',
      confirmPassword: 'ValidLongPassword123',
    }).ok,
    true,
  );

  assert.equal(
    buildPasswordRecoveryRedirectUrl({
      origin: 'https://vendor.github.io',
      pathname: '/myclinic-license-authority/',
    }),
    'https://vendor.github.io/myclinic-license-authority/#/reset-password',
  );

  assert.equal(
    detectRecoveryFlowFromUrl({
      hash: '#/reset-password',
      search: '',
    }),
    true,
  );
  assert.equal(
    detectRecoveryFlowFromUrl({
      hash: '#access_token=tok&type=recovery',
      search: '',
    }),
    true,
  );
  assert.equal(
    detectRecoveryFlowFromUrl({
      hash: '#/dashboard',
      search: '',
    }),
    false,
  );
});
