import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  computeMachineFingerprint,
  createLicenseMiddleware,
  isAuthorizedRefreshRequest,
  startLicenseSyncScheduler,
  verifyCachedLicense,
} from './license-middleware.mjs';

const PORT = Number(process.env.PORT ?? 4000);
const CACHE_FILE =
  process.env.LICENSE_CACHE_PATH ??
  path.resolve(process.cwd(), '.license_cache');
const MYCLINIC_DIST_DIR = process.env.MYCLINIC_DIST_DIR
  ? path.resolve(process.env.MYCLINIC_DIST_DIR)
  : null;
const CORS_ORIGIN = process.env.CORS_ORIGIN?.trim() || '';

const machineFingerprint = computeMachineFingerprint();
const scheduler = startLicenseSyncScheduler({
  cacheFilePath: CACHE_FILE,
  machineFingerprint,
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    const allowed =
      CORS_ORIGIN === '*'
        ? '*'
        : CORS_ORIGIN.split(',')
            .map((o) => o.trim())
            .includes(req.headers.origin)
          ? req.headers.origin
          : '';
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', allowed);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, machine_fingerprint: machineFingerprint });
});

app.get('/api/license/status', (_req, res) => {
  const state = verifyCachedLicense({
    cacheFilePath: CACHE_FILE,
    machineFingerprint,
  });

  if (!state.valid) {
    return res.status(200).json({
      active: false,
      code: state.code,
      reason: state.reason,
      machine_fingerprint: machineFingerprint,
    });
  }

  return res.status(200).json({
    active: true,
    tier: state.claims.tier,
    plan: state.entitlements.plan,
    limits: {
      doctors: state.entitlements.doctors,
      frontdesk: state.entitlements.frontdesk,
      branches: state.entitlements.branches,
    },
    token_expires_at: new Date(state.claims.exp * 1000).toISOString(),
    subscription_expires_at: state.claims.subscription_expires_at ?? null,
    machine_fingerprint: state.claims.machine_fingerprint,
  });
});

app.post('/api/license/refresh', async (req, res) => {
  if (!isAuthorizedRefreshRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Manual license refresh requires loopback access or LICENSE_REFRESH_TOKEN.',
    });
  }
  const syncOutcome = await scheduler.triggerNow();
  if (!syncOutcome.ok) {
    return res.status(502).json({
      ok: false,
      error: syncOutcome.error?.message ?? 'Unable to reach license authority.',
    });
  }
  return res.status(200).json({
    ok: true,
    synced_at: syncOutcome.syncedAt,
    tier: syncOutcome.decoded.tier,
    token_expires_at: new Date(syncOutcome.decoded.exp * 1000).toISOString(),
  });
});

app.get('/subscription-locked', (_req, res) => {
  const state = verifyCachedLicense({
    cacheFilePath: CACHE_FILE,
    machineFingerprint,
  });
  res.status(402).json({
    status: 402,
    error: 'Payment Required',
    code: state.valid ? 'NONE' : state.code,
    message: state.valid ? 'Subscription is active.' : state.reason,
    machine_fingerprint: machineFingerprint,
  });
});

app.use(
  createLicenseMiddleware({
    cacheFilePath: CACHE_FILE,
    machineFingerprint,
    redirectUrl: '/subscription-locked',
  }),
);

app.get('/api/clinic/entitlements', (req, res) => {
  res.json({
    status: 'authorized',
    tier: req.license.tier,
    myclinic_plan: req.license.entitlements.plan,
    seat_limits: {
      doctors: req.license.entitlements.doctors,
      frontdesk: req.license.entitlements.frontdesk,
      branches: req.license.entitlements.branches,
    },
    capability_valid_until: new Date(req.license.exp * 1000).toISOString(),
  });
});

if (MYCLINIC_DIST_DIR && fs.existsSync(MYCLINIC_DIST_DIR)) {
  app.use(express.static(MYCLINIC_DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(MYCLINIC_DIST_DIR, 'index.html'));
  });
}

// Structured Express 5 error handler (catches malformed JSON & unexpected throws without leaking stacks)
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_JSON',
      error: 'Request body must be valid JSON.',
    });
  }
  const status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  console.error('[myclinic-node] Unhandled request error:', err?.message ?? err);
  return res.status(status).json({
    ok: false,
    code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
    error:
      status === 413
        ? 'Request payload exceeds the 64 KB limit.'
        : 'Internal validator gateway error.',
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.info(
    `[myclinic-node] Listening on 0.0.0.0:${PORT} | fingerprint=${machineFingerprint}${
      MYCLINIC_DIST_DIR ? ` | serving myClinic=${MYCLINIC_DIST_DIR}` : ''
    }`,
  );
});

process.on('SIGTERM', () => {
  scheduler.stop();
  server.close(() => process.exit(0));
});
