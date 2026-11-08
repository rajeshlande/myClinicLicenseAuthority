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

export function validateProvisionInput({
  customerEmail,
  tier = 'standard',
  maxMachines = 1,
  expiresDate,
  notes = '',
} = {}) {
  const email = String(customerEmail ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      ok: false,
      error: 'Enter a valid customer billing email address.',
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
      p_customer_email: email,
      p_tier: cleanTier,
      p_max_machines: parsedLimit,
      p_expires_at: expirationIso,
      p_notes: cleanNotes,
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

export function computeFleetMetrics(records = [], now = new Date()) {
  let activeCount = 0;
  let totalRegisteredNodes = 0;
  let totalCapacityNodes = 0;
  let expiringSoonCount = 0;

  for (const row of records) {
    const standing = computeStanding(row, now);
    if (standing.isOperational) {
      activeCount += 1;
      if (standing.daysLeft !== null && standing.daysLeft <= 14) {
        expiringSoonCount += 1;
      }
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
