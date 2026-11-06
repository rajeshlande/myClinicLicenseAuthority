import { EXPECTED_TOKEN_ISSUER, TOKEN_TTL_SECONDS } from './entitlements.mjs';

const subtle = globalThis.crypto?.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function pemFence(boundary, label) {
  return [`-----${boundary}`, `${label}-----`].join(' ');
}

export function bytesToBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlToBytes(b64url) {
  const normalized = String(b64url)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(b64url).length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToPem(buffer, label) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [pemFence('BEGIN', label), ...lines, pemFence('END', label)].join('\n');
}

export function pemToDerBuffer(pemInput) {
  const normalized = String(pemInput ?? '').replace(/\\n/g, '\n').trim();
  const base64Body = normalized
    .replace(/-----(?:BEGIN|END) [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');

  if (!base64Body) {
    throw new Error('PEM key body is empty or malformed.');
  }

  const binary = atob(base64Body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generates a fresh 2048-bit RS256 asymmetric keypair (PKCS#8 Private + SPKI Public)
 * using standard WebCrypto (`crypto.subtle`).
 */
export async function generateRsaKeyPairPem() {
  if (!subtle) {
    throw new Error('WebCrypto API (crypto.subtle) is unavailable.');
  }

  const keyPair = await subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const [pkcs8Buffer, spkiBuffer] = await Promise.all([
    subtle.exportKey('pkcs8', keyPair.privateKey),
    subtle.exportKey('spki', keyPair.publicKey),
  ]);

  const privateKeyPem = arrayBufferToPem(pkcs8Buffer, 'PRIVATE KEY');
  const publicKeyPem = arrayBufferToPem(spkiBuffer, 'PUBLIC KEY');

  return {
    privateKeyPem,
    publicKeyPem,
    privateKeyEnv: privateKeyPem.replace(/\n/g, '\\n'),
    publicKeyEnv: publicKeyPem.replace(/\n/g, '\\n'),
  };
}

export async function importPkcs8SigningKey(privateKeyPem) {
  const normalized = String(privateKeyPem ?? '');
  if (normalized.includes('RSA PRIVATE')) {
    throw new Error('Expected PKCS#8 private key, not legacy PKCS#1.');
  }
  return subtle.importKey(
    'pkcs8',
    pemToDerBuffer(normalized),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function importSpkiVerifyKey(publicKeyPem) {
  return subtle.importKey(
    'spki',
    pemToDerBuffer(publicKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/**
 * Signs a short-lived RS256 JWT capability token via WebCrypto.
 */
export async function signCapabilityJwt(
  claims,
  privateKeyOrPem,
  { nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = TOKEN_TTL_SECONDS } = {},
) {
  const signingKey =
    typeof privateKeyOrPem === 'string'
      ? await importPkcs8SigningKey(privateKeyOrPem)
      : privateKeyOrPem;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: EXPECTED_TOKEN_ISSUER,
    ...claims,
    iat: claims.iat ?? nowSeconds,
    exp: claims.exp ?? nowSeconds + ttlSeconds,
  };

  const signingInput = `${bytesToBase64Url(textEncoder.encode(JSON.stringify(header)))}.${bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)))}`;
  const signature = await subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    textEncoder.encode(signingInput),
  );

  return {
    token: `${signingInput}.${bytesToBase64Url(signature)}`,
    payload,
  };
}

/**
 * Verifies an RS256 JWT capability token offline using ONLY the SPKI Public Key.
 * Strictly enforces `alg === 'RS256'` and `typ === 'JWT'` to defeat algorithm confusion.
 */
export async function verifyCapabilityJwt(
  tokenString,
  publicKeyOrPem,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    expectedFingerprint = null,
    expectedLicenseKey = null,
    expectedOrigin = null,
  } = {},
) {
  const raw = String(tokenString ?? '').trim();
  const segments = raw.split('.');
  if (segments.length !== 3) {
    return {
      valid: false,
      code: 'MALFORMED_JWT',
      reason: 'Token does not have three JWT segments.',
    };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(textDecoder.decode(base64UrlToBytes(segments[0])));
    payload = JSON.parse(textDecoder.decode(base64UrlToBytes(segments[1])));
  } catch {
    return {
      valid: false,
      code: 'MALFORMED_JWT',
      reason: 'Unable to decode JWT header or payload JSON.',
    };
  }

  if (header?.alg !== 'RS256') {
    return {
      valid: false,
      code: 'UNSUPPORTED_ALGORITHM',
      reason: `Rejected algorithm '${header?.alg ?? 'unknown'}'; strictly requires RS256.`,
    };
  }

  let verifyKey;
  try {
    verifyKey =
      typeof publicKeyOrPem === 'string'
        ? await importSpkiVerifyKey(publicKeyOrPem)
        : publicKeyOrPem;
  } catch (err) {
    return {
      valid: false,
      code: 'INVALID_PUBLIC_KEY',
      reason: err instanceof Error ? err.message : 'Invalid SPKI public key.',
    };
  }

  const signingInput = `${segments[0]}.${segments[1]}`;
  let signatureValid = false;
  try {
    signatureValid = await subtle.verify(
      'RSASSA-PKCS1-v1_5',
      verifyKey,
      base64UrlToBytes(segments[2]),
      textEncoder.encode(signingInput),
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return {
      valid: false,
      code: 'INVALID_TOKEN_SIGNATURE',
      reason: 'RS256 cryptographic signature verification failed.',
    };
  }

  if (payload?.iss !== EXPECTED_TOKEN_ISSUER) {
    return {
      valid: false,
      code: 'UNTRUSTED_ISSUER',
      reason: `Unexpected issuer '${payload?.iss ?? 'none'}'.`,
    };
  }

  if (typeof payload?.exp !== 'number' || nowSeconds >= payload.exp) {
    return {
      valid: false,
      code: 'CAPABILITY_TOKEN_EXPIRED',
      reason: 'Offline 7-day capability token has expired.',
    };
  }

  if (
    expectedFingerprint &&
    payload.machine_fingerprint !== expectedFingerprint
  ) {
    return {
      valid: false,
      code: 'HARDWARE_FINGERPRINT_MISMATCH',
      reason: 'Token hardware fingerprint does not match this host.',
    };
  }

  if (
    expectedLicenseKey &&
    payload.license_key !== String(expectedLicenseKey).trim().toUpperCase()
  ) {
    return {
      valid: false,
      code: 'LICENSE_KEY_MISMATCH',
      reason: 'Token license_key does not match configured LICENSE_KEY.',
    };
  }

  if (expectedOrigin) {
    const normalizedExpected = String(expectedOrigin).trim().toLowerCase();
    const tokenOrigin = payload.allowed_origin
      ? String(payload.allowed_origin).trim().toLowerCase()
      : '';
    if (!tokenOrigin || tokenOrigin !== normalizedExpected) {
      return {
        valid: false,
        code: 'ORIGIN_MISMATCH',
        reason: `Token allowed_origin '${tokenOrigin || 'none'}' does not match '${normalizedExpected}'.`,
      };
    }
  }

  return {
    valid: true,
    header,
    claims: payload,
  };
}
