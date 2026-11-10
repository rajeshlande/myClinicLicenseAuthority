/**
 * SCRATCH harness — NOT SHIPPED. Deleted before every commit.
 *
 * Mounts the real EntitlementsPage against a mock Supabase client so the
 * Level-2 refactor slices can be gated on rendered output (375x812 and
 * 1440x900) without touching a live project.
 *
 * Every relative timestamp is a FIXED OFFSET from load time, so badge labels
 * ("4m ago"), fleet tiles and drawer text are byte-identical across runs —
 * which is what makes a before/after DOM fingerprint diff meaningful.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import EntitlementsPage from './src/pages/EntitlementsPage.jsx';

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

const ROWS = [
  {
    // 1. Refused — the schema-v3 attribution case (masked email + verbatim URL).
    subscription_id: 'sub_00000000-0000-4000-8000-000000000001',
    license_id: 'lic_00000000-0000-4000-8000-000000000001',
    license_key: 'MYCLINIC-DEMO-REFUSED-ONE',
    customer_email: 'owner@dualclinic.in',
    allowed_origin: 'https://rajeshlande.github.io',
    lock_first_origin: true,
    match_mode: 'email+url',
    tier: 'growth',
    status: 'active',
    is_active: true,
    registered_machines: 0,
    max_machines: 2,
    expires_at: '2027-06-30T00:00:00Z',
    last_heartbeat: null,
    last_synced_tier: null,
    last_synced_status: null,
    last_synced_expires_at: null,
    last_refusal_code: 'SUBSCRIPTION_NOT_FOUND',
    last_refusal_at: minutesAgo(4),
    refusals_24h: 7,
    last_refusal_email_hint: 'r***@yahoo.com',
    last_refusal_origin: 'https://rajeshlande.github.io',
    last_refusal_browser_origin: 'https://rajeshlande.github.io',
    notes: null,
    created_at: '2026-01-11T09:00:00Z',
    updated_at: '2026-01-11T09:00:00Z',
  },
  {
    // 2. Refused — ORIGIN_MISMATCH is deliberately unattributed (no claim shown).
    subscription_id: 'sub_00000000-0000-4000-8000-000000000002',
    license_id: 'lic_00000000-0000-4000-8000-000000000002',
    license_key: 'MYCLINIC-DEMO-REFUSED-TWO',
    customer_email: 'billing@northside.clinic',
    allowed_origin: 'https://northside.clinic',
    lock_first_origin: true,
    match_mode: 'email+url',
    tier: 'standard',
    status: 'active',
    is_active: true,
    registered_machines: 0,
    max_machines: 2,
    expires_at: '2027-03-01T00:00:00Z',
    last_heartbeat: null,
    last_refusal_code: 'ORIGIN_MISMATCH',
    last_refusal_at: minutesAgo(22),
    refusals_24h: 3,
    last_refusal_email_hint: null,
    last_refusal_origin: null,
    last_refusal_browser_origin: null,
    notes: 'Waiting on the clinic to confirm which URL their staff use.',
    created_at: '2026-02-02T09:00:00Z',
    updated_at: '2026-02-02T09:00:00Z',
  },
  {
    // 3. Plan Synced — receipt matches the pinned plan exactly.
    subscription_id: 'sub_00000000-0000-4000-8000-000000000003',
    license_id: 'lic_00000000-0000-4000-8000-000000000003',
    license_key: 'MYCLINIC-DEMO-SYNCED',
    customer_email: 'admin@lakeview.health',
    allowed_origin: 'https://app.lakeview.health',
    lock_first_origin: true,
    match_mode: 'email+url',
    tier: 'growth',
    status: 'active',
    is_active: true,
    registered_machines: 1,
    max_machines: 2,
    expires_at: '2027-09-15T00:00:00Z',
    last_heartbeat: minutesAgo(2),
    last_synced_tier: 'growth',
    last_synced_status: 'active',
    last_synced_expires_at: '2027-09-15T00:00:00Z',
    last_refusal_code: null,
    last_refusal_at: null,
    refusals_24h: 0,
    notes: null,
    created_at: '2026-03-03T09:00:00Z',
    updated_at: minutesAgo(3),
  },
  {
    // 4. Update Pending — client is behind the pinned tier (warning, not fault).
    subscription_id: 'sub_00000000-0000-4000-8000-000000000004',
    license_id: 'lic_00000000-0000-4000-8000-000000000004',
    license_key: 'MYCLINIC-DEMO-PENDING',
    customer_email: 'frontdesk@riverbend.care',
    allowed_origin: '',
    lock_first_origin: false,
    match_mode: 'email',
    tier: 'growth',
    status: 'active',
    is_active: true,
    registered_machines: 2,
    max_machines: 3,
    expires_at: '2027-01-20T00:00:00Z',
    last_heartbeat: minutesAgo(6),
    last_synced_tier: 'standard',
    last_synced_status: 'active',
    last_synced_expires_at: '2027-01-20T00:00:00Z',
    last_refusal_code: null,
    last_refusal_at: null,
    refusals_24h: 0,
    notes: null,
    created_at: '2026-04-04T09:00:00Z',
    updated_at: minutesAgo(1),
  },
  {
    // 5. Awaiting Connect — no seat, no refusal: nobody has opened the app yet.
    subscription_id: 'sub_00000000-0000-4000-8000-000000000005',
    license_id: 'lic_00000000-0000-4000-8000-000000000005',
    license_key: 'MYCLINIC-DEMO-AWAITING',
    customer_email: 'reception@hilltop.clinic',
    allowed_origin: 'https://hilltop.clinic',
    lock_first_origin: true,
    match_mode: 'email+url',
    tier: 'standard',
    status: 'active',
    is_active: true,
    registered_machines: 0,
    max_machines: 2,
    expires_at: '2027-12-01T00:00:00Z',
    last_heartbeat: null,
    last_refusal_code: null,
    last_refusal_at: null,
    refusals_24h: 0,
    notes: null,
    created_at: '2026-05-05T09:00:00Z',
    updated_at: '2026-05-05T09:00:00Z',
  },
];

const MACHINES = [
  {
    license_id: 'lic_00000000-0000-4000-8000-000000000003',
    machine_id: 'mch_lakeview_desk_01',
    label: 'Front desk — Chrome 141',
    first_seen_at: minutesAgo(180),
    last_seen_at: minutesAgo(2),
  },
];

function makeTable(table) {
  const source = table === 'admin_license_view' ? ROWS : MACHINES;
  const state = { filters: [] };
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => chain,
    maybeSingle: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    delete: () => chain,
    eq: (column, value) => {
      state.filters.push([column, value]);
      return chain;
    },
    then: (resolve) => {
      const data = source.filter((row) =>
        state.filters.every(([column, value]) => String(row[column]) === String(value)),
      );
      resolve({ data, error: null, count: data.length, status: 200 });
    },
  };
  return chain;
}

const backend = {
  supabase: {
    from: (table) => makeTable(table),
    rpc: (name) => ({
      then: (resolve) => resolve({ data: { ok: true, rpc: name }, error: null }),
    }),
    auth: {
      getUser: () => ({ then: (r) => r({ data: { user: null }, error: null }) }),
    },
  },
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <EntitlementsPage
      backend={backend}
      issueDrawerSignal={0}
      onSelectLicenseForKit={() => {}}
      onOpenGuide={() => {}}
    />
  </React.StrictMode>,
);
