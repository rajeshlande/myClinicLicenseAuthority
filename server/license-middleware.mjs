import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import {
  EXPECTED_TOKEN_ISSUER,
  MYCLINIC_TIER_ENTITLEMENTS,
} from '../src/lib/entitlements.mjs';

export function normalizePublicKeyPem(rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    throw new Error('Missing required LICENSE_PUBLIC_KEY environment variable.');
  }
  const normalized = rawKey.replace(/\\n/g, '\n').trim();
  if (!normalized.includes('PUBLIC KEY')) {
    throw new Error(
      'LICENSE_PUBLIC_KEY must be a valid SPKI PEM public key.',
    );
  }
  return normalized;
}

export function computeMachineFingerprint() {
  if (process.env.MACHINE_FINGERPRINT?.trim()) {
    return process.env.MACHINE_FINGERPRINT.trim();
  }

  let osMachineId = '';
  for (const candidate of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8').trim();
        if (content) {
          osMachineId = content;
          break;
        }
      }
    } catch {
      // Unprivileged container fallback
    }
  }

  const interfaces = os.networkInterfaces();
  const macAddresses = Object.values(interfaces)
    .flat()
    .filter(
      (iface) =>
        iface &&
        !iface.internal &&
        iface.mac &&
        iface.mac !== '00:00:00:00:00:00',
    )
    .map((iface) => iface.mac.toLowerCase())
    .sort();

  const cpuModel = os.cpus()?.[0]?.model ?? 'unknown-cpu';
  const rawMaterial = [
    osMachineId || os.hostname(),
    os.platform(),
    os.arch(),
    cpuModel,
    macAddresses[0] ?? 'no-mac',
  ].join('|');

  return `node_${crypto.createHash('sha256').update(rawMaterial).digest('hex').slice(0, 32)}`;
}

export async function syncLicenseFromCloud({
  verifyUrl = process.env.LICENSE_VERIFY_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
  licenseKey = process.env.LICENSE_KEY,
  publicKeyPem = process.env.LICENSE_PUBLIC_KEY,
  machineFingerprint = computeMachineFingerprint(),
  cacheFilePath = path.resolve(process.cwd(), '.license_cache'),
  timeoutMs = 12_000,
} = {}) {
  if (!verifyUrl) {
    throw new Error('Missing LICENSE_VERIFY_URL environment variable.');
  }
  if (!licenseKey?.trim()) {
    throw new Error('Missing LICENSE_KEY environment variable.');
  }

  const normalizedKey = licenseKey.trim().toUpperCase();
  const publicKey = normalizePublicKeyPem(publicKeyPem);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (supabaseAnonKey?.trim()) {
      headers.apikey = supabaseAnonKey.trim();
      headers.Authorization = `Bearer ${supabaseAnonKey.trim()}`;
    }

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        license_key: normalizedKey,
        machine_fingerprint: machineFingerprint,
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || typeof payload.token !== 'string') {
      const serverReason =
        typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`;
      throw new Error(`License authority rejected heartbeat: ${serverReason}`);
    }

    const decoded = jwt.verify(payload.token, publicKey, {
      algorithms: ['RS256'],
      issuer: EXPECTED_TOKEN_ISSUER,
    });

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      decoded.license_key !== normalizedKey ||
      decoded.machine_fingerprint !== machineFingerprint
    ) {
      throw new Error(
        'Received token claims do not match local license_key or machine_fingerprint.',
      );
    }

    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
    const tempPath = `${cacheFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, payload.token.trim(), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, cacheFilePath);

    return {
      ok: true,
      decoded,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function startLicenseSyncScheduler(options = {}) {
  const cronExpression =
    options.cronExpression ?? process.env.LICENSE_SYNC_CRON ?? '0 */6 * * *';

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid LICENSE_SYNC_CRON expression: ${cronExpression}`);
  }

  const runSync = async (trigger) => {
    try {
      const result = await syncLicenseFromCloud(options);
      console.info(
        `[license-sync] (${trigger}) Refreshed capability token for tier='${result.decoded.tier}'`,
      );
      return result;
    } catch (err) {
      console.warn(
        `[license-sync] (${trigger}) Cloud heartbeat failed; retaining local .license_cache. Reason: ${err.message}`,
      );
      return { ok: false, error: err };
    }
  };

  const initialSyncPromise = runSync('startup');
  const scheduledTask = cron.schedule(cronExpression, () => {
    void runSync('cron');
  });

  return {
    initialSyncPromise,
    stop: () => scheduledTask.stop(),
    triggerNow: () => runSync('manual'),
  };
}

export function verifyCachedLicense({
  publicKeyPem = process.env.LICENSE_PUBLIC_KEY,
  expectedLicenseKey = process.env.LICENSE_KEY,
  machineFingerprint = computeMachineFingerprint(),
  cacheFilePath = path.resolve(process.cwd(), '.license_cache'),
} = {}) {
  let publicKey;
  try {
    publicKey = normalizePublicKeyPem(publicKeyPem);
  } catch (err) {
    return {
      valid: false,
      code: 'PUBLIC_KEY_MISCONFIGURED',
      reason: err.message,
    };
  }

  let tokenString;
  try {
    tokenString = fs.readFileSync(cacheFilePath, 'utf8').trim();
  } catch (err) {
    return {
      valid: false,
      code: 'LICENSE_CACHE_MISSING',
      reason:
        err.code === 'ENOENT'
          ? 'No local capability token (.license_cache) found. Connect this host to complete initial activation.'
          : `Unable to read local license cache: ${err.message}`,
    };
  }

  if (!tokenString) {
    return {
      valid: false,
      code: 'LICENSE_CACHE_EMPTY',
      reason: 'Local .license_cache file is empty.',
    };
  }

  try {
    const decoded = jwt.verify(tokenString, publicKey, {
      algorithms: ['RS256'],
      issuer: EXPECTED_TOKEN_ISSUER,
    });

    if (typeof decoded !== 'object' || decoded === null) {
      return {
        valid: false,
        code: 'LICENSE_PAYLOAD_MALFORMED',
        reason: 'Decoded JWT capability payload is malformed.',
      };
    }

    if (decoded.machine_fingerprint !== machineFingerprint) {
      return {
        valid: false,
        code: 'HARDWARE_FINGERPRINT_MISMATCH',
        reason:
          'Capability token is bound to a different hardware fingerprint.',
      };
    }

    if (
      expectedLicenseKey?.trim() &&
      decoded.license_key !== expectedLicenseKey.trim().toUpperCase()
    ) {
      return {
        valid: false,
        code: 'LICENSE_KEY_MISMATCH',
        reason:
          'Cached capability token does not match the configured LICENSE_KEY.',
      };
    }

    const entitlements =
      MYCLINIC_TIER_ENTITLEMENTS[decoded.tier] ??
      MYCLINIC_TIER_ENTITLEMENTS.standard;

    return {
      valid: true,
      claims: decoded,
      entitlements,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return {
        valid: false,
        code: 'CAPABILITY_TOKEN_EXPIRED',
        reason: `Offline 7-day capability window expired at ${err.expiredAt.toISOString()}.`,
      };
    }

    return {
      valid: false,
      code: 'INVALID_TOKEN_SIGNATURE',
      reason: `Cryptographic RS256 verification failed: ${err.message}`,
    };
  }
}

export function createLicenseMiddleware(options = {}) {
  const redirectUrl = options.redirectUrl ?? '/subscription-locked';
  const exemptPaths = new Set([
    redirectUrl,
    '/healthz',
    '/api/license/status',
    '/api/license/refresh',
    ...(options.exemptPaths ?? []),
  ]);

  return function requireValidLicense(req, res, next) {
    if (exemptPaths.has(req.path)) {
      return next();
    }

    const result = verifyCachedLicense(options);

    if (!result.valid) {
      return res.status(402).json({
        status: 402,
        error: 'Payment Required',
        code: result.code,
        message: result.reason,
        redirect_url: redirectUrl,
      });
    }

    req.license = {
      ...result.claims,
      entitlements: result.entitlements,
    };

    return next();
  };
}
