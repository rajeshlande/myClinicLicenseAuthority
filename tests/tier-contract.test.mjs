import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CONTRACT_CENTRAL_SCHEMA_VERSION,
  MYCLINIC_TIER_ENTITLEMENTS,
  SYNC_REFUSAL_HINTS,
  TIER_CATALOG,
  TIER_CONTRACT,
  TIER_CONTRACT_VERSION,
  TIER_FALLBACK_ENTITLEMENT,
  VALID_TIERS,
} from '../src/lib/tier-contract.mjs';
import { SCHEMA_VERSION } from '../src/lib/version.js';

const schemaSql = readFileSync('supabase/schema.sql', 'utf8');

/**
 * The v2.3.1 maps, typed out as mirrors. They are the pin: the contract may
 * re-shape how the vocabulary is stored, never what it says.
 */
const LEGACY_ENTITLEMENTS = {
  solo: { plan: 'solo', doctors: 1, frontdesk: 1, branches: 1 },
  standard: { plan: 'growth', doctors: 5, frontdesk: 3, branches: 1 },
  growth: { plan: 'growth', doctors: 5, frontdesk: 3, branches: 1 },
  chain: { plan: 'chain', doctors: null, frontdesk: null, branches: null },
  enterprise: { plan: 'chain', doctors: null, frontdesk: null, branches: null },
};

const LEGACY_CATALOG = [
  {
    value: 'standard',
    label: 'Standard · Default Node',
    hint: 'Baseline single-site self-hosted installation (5 doctors · 3 front-desk)',
  },
  {
    value: 'solo',
    label: 'myClinic Solo · 1 Doctor',
    hint: '1 doctor · 1 front-desk seat · 1 branch',
  },
  {
    value: 'growth',
    label: 'myClinic Growth · 5 Doctors',
    hint: '5 doctors · 3 front-desk seats · 1 branch',
  },
  {
    value: 'chain',
    label: 'myClinic Chain · Multi-Branch',
    hint: 'Unlimited doctors, front-desk seats & branches',
  },
  {
    value: 'enterprise',
    label: 'Enterprise · Dedicated SLA',
    hint: 'Unlimited seats, multi-cluster HA & priority SLA',
  },
];

const LEGACY_HINT_LABELS = {
  SUBSCRIPTION_NOT_FOUND: 'No match',
  ORIGIN_MISMATCH: 'Origin blocked',
  INVALID_ORIGIN: 'Bad Clinic URL',
  INVALID_EMAIL: 'Bad owner email',
  MISSING_IDENTITY: 'No identity sent',
  RATE_LIMITED: 'Rate limited',
  SEAT_LIMIT_REACHED: 'Seats full',
  SUBSCRIPTION_PAUSED: 'Paused',
  SUBSCRIPTION_EXPIRED: 'Expired',
  SUBSCRIPTION_INACTIVE: 'Not active',
};

test('the tier contract is internally consistent and versioned against the live schema', () => {
  assert.equal(TIER_CONTRACT.contract, 'myclinic.central.tier-contract');
  assert.equal(TIER_CONTRACT_VERSION, 1);
  // Contract v1 was published against Central schema 3 and is byte-pinned by
  // myClinic v1.43.0. Schema v4 is purely additive (activity log + invoices;
  // the tier case and the sync wire shape are untouched), so a published
  // contract stays valid: the live schema may only move FORWARD of it.
  assert.equal(CONTRACT_CENTRAL_SCHEMA_VERSION, 3);
  assert.ok(
    SCHEMA_VERSION >= CONTRACT_CENTRAL_SCHEMA_VERSION,
    'additive Central migrations must never invalidate a published contract',
  );

  const tierIds = Object.keys(TIER_CONTRACT.tiers);
  assert.ok(tierIds.length >= 5, `expected the five shipped tiers, got ${tierIds}`);
  for (const [tier, spec] of Object.entries(TIER_CONTRACT.tiers)) {
    assert.match(tier, /^[a-z]+$/);
    assert.ok(
      ['solo', 'growth', 'chain'].includes(spec.plan),
      `${tier} maps to unknown plan ${spec.plan}`,
    );
    for (const field of ['doctors', 'frontdesk', 'branches']) {
      const value = spec[field];
      assert.ok(
        value === null || (Number.isInteger(value) && value > 0),
        `${tier}.${field} must be null or a positive integer, got ${value}`,
      );
    }
    assert.ok(String(spec.label).trim().length > 0);
    assert.ok(String(spec.hint).trim().length > 0);
  }
  for (const field of ['plan', 'doctors', 'frontdesk', 'branches']) {
    assert.ok(field in TIER_CONTRACT.tier_fallback, `fallback missing ${field}`);
  }

  const codes = Object.keys(TIER_CONTRACT.refusal_codes);
  assert.ok(codes.length >= 10, `expected the ten shipped codes, got ${codes}`);
  for (const [code, spec] of Object.entries(TIER_CONTRACT.refusal_codes)) {
    assert.match(code, /^[A-Z][A-Z_]+$/);
    assert.ok(String(spec.label).trim().length > 0, `${code} has no label`);
    assert.ok(String(spec.hint).trim().length > 0, `${code} has no hint`);
  }

  // The published artifact is immutable in memory.
  assert.ok(Object.isFrozen(TIER_CONTRACT));
  assert.ok(Object.isFrozen(TIER_CONTRACT.tiers.standard));
  assert.throws(() => {
    TIER_CONTRACT.tiers.standard.plan = 'chain';
  }, TypeError);
});

test('the derived Central views are exactly the v2.3.1 maps (contract may re-shape, never re-say)', () => {
  assert.deepEqual(MYCLINIC_TIER_ENTITLEMENTS, LEGACY_ENTITLEMENTS);
  assert.deepEqual(
    TIER_CATALOG.map(({ value, label, hint }) => ({ value, label, hint })),
    LEGACY_CATALOG,
  );
  assert.deepEqual([...VALID_TIERS].sort(), Object.keys(LEGACY_ENTITLEMENTS).sort());
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(SYNC_REFUSAL_HINTS).map(([code, spec]) => [code, spec.label]),
    ),
    LEGACY_HINT_LABELS,
  );
  for (const [code, spec] of Object.entries(SYNC_REFUSAL_HINTS)) {
    assert.ok(
      String(spec.hint).trim().length > 20,
      `${code} hint lost its sentence`,
    );
  }
  assert.deepEqual(TIER_FALLBACK_ENTITLEMENT, {
    plan: 'chain',
    doctors: null,
    frontdesk: null,
    branches: null,
  });
});

test("supabase/schema.sql's tier case parses back to the contract, branch by branch", () => {
  const block = /case v_sub\.tier([\s\S]*?)end case;/.exec(schemaSql);
  assert.ok(block, 'the tier case statement moved or was renamed');
  const body = block[1];

  const parseAssignments = (text) => {
    const match =
      /v_plan := '([a-z]+)';\s*v_doctors := (\d+|null);\s*v_frontdesk := (\d+|null);\s*v_branches := (\d+|null);/.exec(
        text,
      );
    assert.ok(match, `unparseable branch: ${text.trim().slice(0, 80)}`);
    const num = (v) => (v === 'null' ? null : Number(v));
    return {
      plan: match[1],
      doctors: num(match[2]),
      frontdesk: num(match[3]),
      branches: num(match[4]),
    };
  };

  const branches = {};
  for (const part of body.split(/\bwhen\b/).slice(1)) {
    const tier = /^ '([a-z]+)' then/.exec(part);
    assert.ok(tier, `malformed when-branch: ${part.trim().slice(0, 60)}`);
    branches[tier[1]] = parseAssignments(part);
  }
  const elseBranch = parseAssignments(
    /else([\s\S]*)$/.exec(body)[1],
  );

  // The fallback the SQL falls through to IS the contract fallback.
  assert.deepEqual(elseBranch, TIER_FALLBACK_ENTITLEMENT);

  // Every contract tier, resolved the way the database resolves it, equals the
  // contract — an explicit branch that drifts, or a tier silently dropped into
  // the fallback, both fail here.
  for (const [tier, spec] of Object.entries(TIER_CONTRACT.tiers)) {
    const expected = {
      plan: spec.plan,
      doctors: spec.doctors,
      frontdesk: spec.frontdesk,
      branches: spec.branches,
    };
    const sql = branches[tier] ?? elseBranch;
    assert.deepEqual(sql, expected, `schema.sql disagrees with the contract for ${tier}`);
  }

  // No branch for a tier the contract does not define.
  for (const tier of Object.keys(branches)) {
    assert.ok(tier in TIER_CONTRACT.tiers, `schema.sql branches on unknown tier ${tier}`);
  }
});

test('tiers and refusal codes are defined exactly once: in the contract file', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const scanned = tracked.filter((file) =>
    /^(src|scripts|supabase|contract)\//.test(file) &&
    /\.(mjs|jsx|js|json|sql)$/.test(file),
  );
  assert.ok(scanned.length > 20, 'the scan found suspiciously few files');

  const seatLiteral = /(?:doctors|frontdesk|branches)\s*:\s*(?:\d+|null)/;
  const planLiteral = /plan\s*:\s*'(?:solo|growth|chain)'/;
  for (const file of scanned) {
    if (file === 'contract/tier-contract.json' || /^tests\//.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!seatLiteral.test(text), `${file} hardcodes seat limits again`);
    assert.ok(!planLiteral.test(text), `${file} hardcodes a tier→plan mapping again`);
  }

  for (const code of Object.keys(TIER_CONTRACT.refusal_codes)) {
    const definition = new RegExp(`["']?${code}["']?\\s*:\\s*\\{`);
    let definitions = 0;
    for (const file of scanned) {
      if (/^tests\//.test(file)) continue;
      if (definition.test(readFileSync(file, 'utf8'))) {
        definitions += 1;
        assert.equal(
          file,
          'contract/tier-contract.json',
          `${code} is defined outside the contract`,
        );
      }
    }
    assert.equal(definitions, 1, `${code} must be defined exactly once`);
  }
});
