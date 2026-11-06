import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
  generateRsaKeyPairPem,
  signCapabilityJwt,
} from '../src/lib/crypto-rs256.mjs';
import {
  createLicenseMiddleware,
  syncLicenseFromCloud,
} from '../server/license-middleware.mjs';

test('Express 5 local middleware enforces RS256 signature, hardware lock, and 402 gating', async () => {
  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPairPem();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myclinic-authority-'));
  const cacheFile = path.join(tmpDir, '.license_cache');
  const licenseKey = '9F4A2C81E70B3D564A19C8E2710F5B3D';
  const fingerprint = 'node_mumbai_opd_01';

  const edgeServer = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);

    const { token } = await signCapabilityJwt(
      {
        sub: 'sub-test-01',
        license_key: body.license_key,
        tier: 'growth',
        machine_fingerprint: body.machine_fingerprint,
        max_machines: 3,
      },
      privateKeyPem,
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token }));
  });

  await new Promise((resolve) => edgeServer.listen(0, '127.0.0.1', resolve));
  const edgePort = edgeServer.address().port;

  const app = express();
  app.use(
    createLicenseMiddleware({
      publicKeyPem,
      expectedLicenseKey: licenseKey,
      machineFingerprint: fingerprint,
      cacheFilePath: cacheFile,
      redirectUrl: '/subscription-locked',
    }),
  );
  app.get('/api/patients', (req, res) => {
    res.json({
      ok: true,
      tier: req.license.tier,
      plan: req.license.entitlements.plan,
    });
  });

  const appServer = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const appPort = appServer.address().port;

  try {
    // 1. Missing cache -> 402 Payment Required
    const missingRes = await fetch(`http://127.0.0.1:${appPort}/api/patients`);
    assert.equal(missingRes.status, 402);

    // 2. Sync from Edge -> writes .license_cache with 0600 mode
    await syncLicenseFromCloud({
      verifyUrl: `http://127.0.0.1:${edgePort}/functions/v1/verify-license`,
      licenseKey,
      publicKeyPem,
      machineFingerprint: fingerprint,
      cacheFilePath: cacheFile,
    });

    await new Promise((resolve) => edgeServer.close(resolve));

    // 3. Offline verification succeeds with cloud shut down
    const okRes = await fetch(`http://127.0.0.1:${appPort}/api/patients`);
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.plan, 'growth');

    // 4. Forged HS256 using SPKI public key as HMAC secret -> 402
    const forgedHs256 = jwt.sign(
      {
        iss: 'myclinic-license-authority',
        license_key: licenseKey,
        tier: 'chain',
        machine_fingerprint: fingerprint,
      },
      Buffer.from(publicKeyPem, 'utf8'),
      { algorithm: 'HS256', expiresIn: '7d' },
    );
    fs.writeFileSync(cacheFile, forgedHs256, 'utf8');

    const forgedRes = await fetch(`http://127.0.0.1:${appPort}/api/patients`);
    assert.equal(forgedRes.status, 402);
    const forgedBody = await forgedRes.json();
    assert.equal(forgedBody.code, 'INVALID_TOKEN_SIGNATURE');
  } finally {
    await new Promise((resolve) => appServer.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
