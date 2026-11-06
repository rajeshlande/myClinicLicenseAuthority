import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoAuthority } from '../src/lib/demo-store.mjs';

test('Demo authority provisions atomically, enforces max_machines, and respects kill-switch', async () => {
  const demo = createDemoAuthority({ useMemory: true });

  const { data: created, error } = await demo.client.rpc(
    'create_subscription_with_license',
    {
      p_customer_email: 'clinic@mumbai.in',
      p_tier: 'solo',
      p_max_machines: 1,
      p_expires_at: new Date(Date.now() + 86400 * 30 * 1000).toISOString(),
      p_notes: '**PO#:** `PO-55`',
    },
  );
  assert.equal(error, null);
  assert.equal(created.license_key.length, 32);
  assert.equal(created.registered_machines, 0);

  // First node succeeds
  const firstPing = await demo.verifyLicenseSimulated({
    license_key: created.license_key,
    machine_fingerprint: 'node_01',
  });
  assert.equal(firstPing.status, 200);
  assert.ok(firstPing.body.token);

  // Second distinct node exceeds max_machines = 1
  const overflowPing = await demo.verifyLicenseSimulated({
    license_key: created.license_key,
    machine_fingerprint: 'node_02',
  });
  assert.equal(overflowPing.status, 403);

  // Kill-switch revokes token issuance immediately
  await demo.client
    .from('licenses')
    .update({ is_active: false })
    .eq('id', created.license_id);

  const killedPing = await demo.verifyLicenseSimulated({
    license_key: created.license_key,
    machine_fingerprint: 'node_01',
  });
  assert.equal(killedPing.status, 403);
});
