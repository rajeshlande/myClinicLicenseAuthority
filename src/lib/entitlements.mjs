const DAY_MS = 86_400_000;

export const EXPECTED_TOKEN_ISSUER = 'myclinic-license-authority';
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7-day offline capability window

export const TIER_CATALOG = Object.freeze([
  {
    value: 'standard',
    label: 'Standard · Default Node',
    badgeClass: 'bg-slate-100 text-slate-800 ring-slate-300',
    hint: 'Baseline single-site self-hosted installation (5 doctors · 3 front-desk)',
  },
  {
    value: 'solo',
    label: 'myClinic Solo · 1 Doctor',
    badgeClass: 'bg-sky-50 text-sky-800 ring-sky-200',
    hint: '1 doctor · 1 front-desk seat · 1 branch',
  },
  {
    value: 'growth',
    label: 'myClinic Growth · 5 Doctors',
    badgeClass: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
    hint: '5 doctors · 3 front-desk seats · 1 branch',
  },
  {
    value: 'chain',
    label: 'myClinic Chain · Multi-Branch',
    badgeClass: 'bg-violet-50 text-violet-800 ring-violet-200',
    hint: 'Unlimited doctors, front-desk seats & branches',
  },
  {
    value: 'enterprise',
    label: 'Enterprise · Dedicated SLA',
    badgeClass: 'bg-amber-50 text-amber-900 ring-amber-300',
    hint: 'Unlimited seats, multi-cluster HA & priority SLA',
  },
]);

export const MYCLINIC_TIER_ENTITLEMENTS = Object.freeze({
  solo: { plan: 'solo', doctors: 1, frontdesk: 1, branches: 1 },
  standard: { plan: 'growth', doctors: 5, frontdesk: 3, branches: 1 },
  growth: { plan: 'growth', doctors: 5, frontdesk: 3, branches: 1 },
  chain: { plan: 'chain', doctors: null, frontdesk: null, branches: null },
  enterprise: { plan: 'chain', doctors: null, frontdesk: null, branches: null },
});

export const VALID_TIERS = new Set(TIER_CATALOG.map((t) => t.value));

export function getTierMeta(tierValue) {
  return (
    TIER_CATALOG.find((item) => item.value === tierValue) ?? {
      value: String(tierValue ?? 'standard'),
      label: String(tierValue ?? 'standard'),
      badgeClass: 'bg-slate-100 text-slate-800 ring-slate-300',
      hint: 'Custom tier',
    }
  );
}

export function getDaysRemaining(isoString, now = new Date()) {
  if (!isoString) return null;
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / DAY_MS);
}

export function defaultExpirationDate(daysFromNow = 365, now = new Date()) {
  const target = new Date(now.getTime());
  target.setDate(target.getDate() + daysFromNow);
  return target.toISOString().split('T')[0];
}

export function formatDisplayDate(isoString) {
  if (!isoString) return '—';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatSyncTimestamp(isoString, now = new Date()) {
  if (!isoString) return 'never';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return 'never';

  const diffSec = Math.max(
    0,
    Math.floor((now.getTime() - parsed.getTime()) / 1000),
  );
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function normalizeAllowedOriginInput(rawOrigin) {
  const trimmed = String(rawOrigin ?? '').trim();
  if (!trimmed) return { ok: true, origin: null };

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: 'Clinic URL must start with https:// or http:// (for example https://clinic.github.io).',
      };
    }
    const normalized = `${parsed.protocol}//${parsed.host}`.toLowerCase();
    if (normalized.length > 255 || !/^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(normalized)) {
      return {
        ok: false,
        error: 'Enter a valid Clinic URL domain (for example https://clinic.github.io).',
      };
    }
    return { ok: true, origin: normalized };
  } catch {
    return {
      ok: false,
      error: 'Clinic URL must include https:// (for example https://clinic.github.io).',
    };
  }
}

export function describeClinicIdentity(row = {}) {
  const email = String(row?.customer_email ?? '').trim();
  const origin = String(row?.allowed_origin ?? '').trim();
  const lockFirst = Boolean(row?.lock_first_origin);

  if (email && origin) {
    return {
      primary: email,
      secondary: origin,
      mode: 'email+url',
      modeLabel: 'Email + URL Pinned',
    };
  }
  if (email) {
    return {
      primary: email,
      secondary: lockFirst ? 'Auto-locks first cloud URL' : 'Any clinic URL',
      mode: lockFirst ? 'email+tofu' : 'email',
      modeLabel: lockFirst ? 'Email + Auto-URL Lock' : 'Email Match',
    };
  }
  if (origin) {
    return {
      primary: origin,
      secondary: 'All staff on this URL',
      mode: 'url',
      modeLabel: 'URL Match',
    };
  }
  return {
    primary: 'Unassigned clinic',
    secondary: '',
    mode: 'none',
    modeLabel: 'Unassigned',
  };
}

export function validateRoutingUpdateInput({
  subscriptionId,
  customerEmail = '',
  allowedOrigin = '',
  lockFirstOrigin = false,
} = {}) {
  const subId = String(subscriptionId ?? '').trim();
  if (!subId) {
    return { ok: false, error: 'Missing subscription identifier.' };
  }

  const email = String(customerEmail ?? '').trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return {
      ok: false,
      error: 'Enter a valid clinic owner email address (or leave blank for URL-only matching).',
    };
  }

  const originCheck = normalizeAllowedOriginInput(allowedOrigin);
  if (!originCheck.ok) {
    return originCheck;
  }

  if (!email && !originCheck.origin) {
    return {
      ok: false,
      error: 'Provide at least a Clinic Owner Email, a Clinic URL (https://...), or both.',
    };
  }

  return {
    ok: true,
    payload: {
      p_subscription_id: subId,
      p_customer_email: email || null,
      p_allowed_origin: originCheck.origin,
      p_lock_first_origin: Boolean(lockFirstOrigin),
    },
  };
}

export function validateProvisionInput({
  customerEmail = '',
  allowedOrigin = '',
  lockFirstOrigin = false,
  tier = 'standard',
  maxMachines = 1,
  expiresDate,
  notes = '',
} = {}) {
  const email = String(customerEmail ?? '').trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return {
      ok: false,
      error: 'Enter a valid clinic owner email address (or leave blank for URL-only matching).',
    };
  }

  const originCheck = normalizeAllowedOriginInput(allowedOrigin);
  if (!originCheck.ok) {
    return originCheck;
  }

  if (!email && !originCheck.origin) {
    return {
      ok: false,
      error: 'Provide a Clinic Owner Email, a Clinic URL (https://...), or both.',
    };
  }

  const cleanTier = String(tier ?? 'standard').trim().toLowerCase();
  if (!VALID_TIERS.has(cleanTier)) {
    return {
      ok: false,
      error: `Unsupported service tier '${cleanTier}'.`,
    };
  }

  const parsedLimit = Math.floor(Number(maxMachines));
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
    return {
      ok: false,
      error: 'Device limit must be an integer between 1 and 10,000.',
    };
  }

  if (!expiresDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiresDate))) {
    return {
      ok: false,
      error: 'Select a valid YYYY-MM-DD contract expiration date.',
    };
  }

  const expirationIso = new Date(`${expiresDate}T23:59:59.999Z`).toISOString();
  if (Number.isNaN(new Date(expirationIso).getTime())) {
    return {
      ok: false,
      error: 'Invalid contract expiration date.',
    };
  }

  const cleanNotes = String(notes ?? '').trim().slice(0, 4000);

  return {
    ok: true,
    payload: {
      p_customer_email: email || null,
      p_tier: cleanTier,
      p_max_machines: parsedLimit,
      p_expires_at: expirationIso,
      p_notes: cleanNotes,
      p_allowed_origin: originCheck.origin,
      p_lock_first_origin: Boolean(lockFirstOrigin),
    },
  };
}

export function computeStanding(row, now = new Date()) {
  const usedNodes = Math.max(0, Number(row?.registered_machines ?? 0));
  const maxNodes = Math.max(1, Number(row?.max_machines ?? 1));
  const usagePct = Math.min(100, Math.round((usedNodes / maxNodes) * 100));
  const daysLeft = getDaysRemaining(row?.expires_at, now);
  const isDateExpired =
    row?.status === 'expired' || (daysLeft !== null && daysLeft <= 0);
  const isSuspended = row?.status === 'suspended';
  const isKilled = !row?.is_active;
  const isOperational =
    !isKilled && !isSuspended && row?.status === 'active' && !isDateExpired;

  let stateCode = 'ACTIVE';
  let label = 'Active';
  if (isKilled) {
    stateCode = 'KEY_KILLED';
    label = 'Killed';
  } else if (isSuspended) {
    stateCode = 'SUSPENDED';
    label = 'Suspended';
  } else if (isDateExpired) {
    stateCode = 'EXPIRED';
    label = 'Expired';
  }

  return {
    usedNodes,
    maxNodes,
    usagePct,
    daysLeft,
    isDateExpired,
    isSuspended,
    isKilled,
    isOperational,
    stateCode,
    label,
  };
}

export function describeClientSyncState(row = {}, now = new Date()) {
  const standing = computeStanding(row, now);
  const usedNodes = standing.usedNodes;
  const hbRaw = row?.last_heartbeat ?? null;
  const hbMs = hbRaw ? Date.parse(hbRaw) : Number.NaN;

  if (usedNodes <= 0 || !Number.isFinite(hbMs)) {
    return {
      state: 'awaiting_connect',
      isConnected: false,
      isPlanSynced: false,
      tone: 'neutral',
      badgeLabel: 'Awaiting Connect',
      detail: 'Client app not opened yet',
      lastSyncedAgo: 'never',
    };
  }

  let expectedStatus = 'active';
  if (standing.isKilled) {
    expectedStatus = 'paused';
  } else if (standing.isDateExpired) {
    expectedStatus = 'expired';
  } else if (standing.isSuspended) {
    expectedStatus = 'suspended';
  }

  const expectedPlan = (
    MYCLINIC_TIER_ENTITLEMENTS[row?.tier] ?? MYCLINIC_TIER_ENTITLEMENTS.standard
  ).plan.toUpperCase();

  const updMs = row?.updated_at ? Date.parse(row.updated_at) : Number.NaN;
  const editedAfterLastHeartbeat =
    Number.isFinite(updMs) && hbMs + 1000 < updMs;

  const rawSyncedTier =
    row?.last_synced_tier != null
      ? String(row.last_synced_tier).trim().toLowerCase()
      : null;
  const rawSyncedStatus =
    row?.last_synced_status != null
      ? String(row.last_synced_status).trim().toLowerCase()
      : null;

  let receiptMismatch = false;
  if (expectedStatus === 'active') {
    const targetTier = String(row?.tier ?? 'standard').trim().toLowerCase();
    const tierDiff = Boolean(rawSyncedTier && rawSyncedTier !== targetTier);
    const statusDiff = Boolean(rawSyncedStatus && rawSyncedStatus !== 'active');
    const expDiff =
      row?.last_synced_expires_at != null &&
      row?.expires_at != null &&
      Math.abs(
        Date.parse(row.last_synced_expires_at) - Date.parse(row.expires_at),
      ) > 1000;
    receiptMismatch = tierDiff || statusDiff || expDiff;
  } else if (rawSyncedStatus) {
    receiptMismatch = rawSyncedStatus !== expectedStatus;
  }

  const ago = formatSyncTimestamp(hbRaw, now);
  const ackedPlan = rawSyncedTier
    ? (
        MYCLINIC_TIER_ENTITLEMENTS[rawSyncedTier]?.plan ?? rawSyncedTier
      ).toUpperCase()
    : null;

  if (editedAfterLastHeartbeat || receiptMismatch) {
    const clientCurrentLabel =
      rawSyncedStatus && rawSyncedStatus !== 'active'
        ? rawSyncedStatus.toUpperCase()
        : ackedPlan;

    return {
      state: 'update_pending',
      isConnected: true,
      isPlanSynced: false,
      tone: 'warn',
      badgeLabel:
        expectedStatus === 'paused' ? 'Pause Pending' : 'Update Pending',
      detail: clientCurrentLabel
        ? `Client on ${clientCurrentLabel} · last sync ${ago}`
        : `Edited after last sync (${ago})`,
      lastSyncedAgo: ago,
    };
  }

  return {
    state: 'in_sync',
    isConnected: true,
    isPlanSynced: true,
    tone: 'ok',
    badgeLabel:
      expectedStatus === 'paused'
        ? 'Pause Synced'
        : expectedStatus === 'expired'
          ? 'Expiry Synced'
          : 'Plan Synced',
    detail:
      expectedStatus === 'active'
        ? `${ackedPlan ?? expectedPlan} live · ${ago}`
        : `${expectedStatus.toUpperCase()} enforced · ${ago}`,
    lastSyncedAgo: ago,
  };
}

export function computeFleetMetrics(records = [], now = new Date()) {
  let activeCount = 0;
  let totalRegisteredNodes = 0;
  let totalCapacityNodes = 0;
  let expiringSoonCount = 0;
  let connectedClinicsCount = 0;
  let inSyncClinicsCount = 0;
  let pendingSyncClinicsCount = 0;

  for (const row of records) {
    const standing = computeStanding(row, now);
    const syncState = describeClientSyncState(row, now);
    if (standing.isOperational) {
      activeCount += 1;
      if (standing.daysLeft !== null && standing.daysLeft <= 14) {
        expiringSoonCount += 1;
      }
    }
    if (syncState.isConnected) {
      connectedClinicsCount += 1;
    }
    if (syncState.state === 'in_sync') {
      inSyncClinicsCount += 1;
    } else if (syncState.state === 'update_pending') {
      pendingSyncClinicsCount += 1;
    }
    totalRegisteredNodes += standing.usedNodes;
    totalCapacityNodes += standing.maxNodes;
  }

  return {
    total: records.length,
    activeCount,
    revokedOrExpiredCount: Math.max(0, records.length - activeCount),
    totalRegisteredNodes,
    totalCapacityNodes,
    expiringSoonCount,
    connectedClinicsCount,
    inSyncClinicsCount,
    pendingSyncClinicsCount,
  };
}

export function buildDockerComposeConfig({
  licenseKey = 'REPLACE_WITH_32_CHAR_HEX_KEY',
  verifyUrl = 'https://YOUR-PROJECT.supabase.co/functions/v1/verify-license',
  publicKeyEscaped = 'REPLACE_WITH_SPKI_PUBLIC_KEY',
  hostPort = 8080,
} = {}) {
  return `services:
  myclinic-node:
    image: ghcr.io/rajeshlande/myclinic-onprem:latest
    restart: unless-stopped
    ports:
      - "${Number(hostPort) || 8080}:4000"
    volumes:
      - /etc/machine-id:/etc/machine-id:ro
      - myclinic_license_cache:/var/lib/myclinic
    environment:
      PORT: "4000"
      LICENSE_KEY: "${String(licenseKey).trim()}"
      LICENSE_VERIFY_URL: "${String(verifyUrl).trim()}"
      LICENSE_PUBLIC_KEY: "${String(publicKeyEscaped).trim()}"
      LICENSE_CACHE_PATH: "/var/lib/myclinic/.license_cache"
      LICENSE_SYNC_CRON: "0 */6 * * *"

volumes:
  myclinic_license_cache:`;
}

/**
 * Generates the exact two-step configuration expected by `rajeshlande/myClinic`
 * (v1.20.0+, schema 18 `supabase/functions/sync-clinic-license` + `src/lib/authority.mjs`).
 *
 * `LICENSE_KEY` stays exclusively inside the clinic's Edge Function secrets and
 * never enters the browser bundle (`VITE_LICENSE_PUBLIC_KEY` only).
 */
export function buildMyClinicCloudSetup({
  licenseKey = 'YOUR_32_CHAR_LICENSE_KEY',
  verifyUrl = 'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
  publicKeyEscaped = 'YOUR_SPKI_PUBLIC_KEY',
  clinicOrigin = 'https://clinic.github.io',
  clinicProjectRef = '<CLINIC_PROJECT_REF>',
} = {}) {
  const cleanKey = String(licenseKey || 'YOUR_32_CHAR_LICENSE_KEY').trim();
  const cleanUrl = String(
    verifyUrl ||
      'https://YOUR-AUTHORITY-REF.supabase.co/functions/v1/verify-license',
  ).trim();
  const cleanPub = String(publicKeyEscaped || 'YOUR_SPKI_PUBLIC_KEY').trim();
  const cleanOrigin = String(clinicOrigin || 'https://clinic.github.io')
    .trim()
    .replace(/\/+$/, '');
  const cleanRef = String(clinicProjectRef || '<CLINIC_PROJECT_REF>').trim();

  const appBuildVars = `VITE_LICENSE_PUBLIC_KEY="${cleanPub}"`;

  const edgeSecretsCmd = `npx supabase link --project-ref ${cleanRef}

npx supabase secrets set \\
  AUTHORITY_VERIFY_URL="${cleanUrl}" \\
  LICENSE_KEY="${cleanKey}" \\
  LICENSE_PUBLIC_KEY="${cleanPub}" \\
  MYCLINIC_ORIGINS="${cleanOrigin}"

npx supabase functions deploy sync-clinic-license --project-ref ${cleanRef}`;

  return { appBuildVars, edgeSecretsCmd };
}

/**
 * Escapes a value for RFC-4180 CSV export while neutralizing leading
 * spreadsheet formula triggers (=, +, -, @, tab, CR).
 */
export function sanitizeCsvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
