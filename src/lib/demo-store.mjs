import { generateRsaKeyPairPem, signCapabilityJwt } from './crypto-rs256.mjs';

const STORAGE_KEY = 'myclinic_license_authority_demo_v1';

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function addDaysIso(days, base = new Date()) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function createSeedDatabase(now = new Date()) {
  return {
    subscriptions: [
      {
        id: 'sub-01',
        customer_email: 'ops@sahyadriclinics.in',
        status: 'active',
        tier: 'chain',
        max_machines: 5,
        expires_at: addDaysIso(312, now),
        notes:
          '**PO#:** `PO-2026-8841` · Annual Multi-Branch Enterprise Contract\n**UPI/UTR:** `UTR-429901883211` · **GSTIN:** `27AABCS1429B1Z5`',
        created_at: addDaysIso(-53, now),
        updated_at: addDaysIso(-2, now),
      },
      {
        id: 'sub-02',
        customer_email: 'dr.kulkarni@aarogyaopd.in',
        status: 'active',
        tier: 'growth',
        max_machines: 3,
        expires_at: addDaysIso(9, now),
        notes:
          '**UPI/UTR:** `UTR-631800492019` · Pune Kothrud OPD Docker Host (5 Doctors, 3 Front-desk)',
        created_at: addDaysIso(-21, now),
        updated_at: addDaysIso(-1, now),
      },
      {
        id: 'sub-03',
        customer_email: 'billing@deshmukhcare.com',
        status: 'active',
        tier: 'solo',
        max_machines: 1,
        expires_at: addDaysIso(178, now),
        notes:
          '**PO#:** `PO-2026-7710` · Single-Doctor On-Prem Clinic NUC Appliance',
        created_at: addDaysIso(-14, now),
        updated_at: addDaysIso(-4, now),
      },
      {
        id: 'sub-04',
        customer_email: 'accounts@metrohealthpune.org',
        status: 'active',
        tier: 'standard',
        max_machines: 2,
        expires_at: addDaysIso(95, now),
        notes:
          '**Hold:** Invoice `#INV-904` overdue; license key temporarily killed pending NEFT clearance.',
        created_at: addDaysIso(-80, now),
        updated_at: addDaysIso(-3, now),
      },
    ],
    licenses: [
      {
        id: 'lic-01',
        subscription_id: 'sub-01',
        license_key: '9F4A2C81E70B3D564A19C8E2710F5B3D',
        is_active: true,
        created_at: addDaysIso(-53, now),
      },
      {
        id: 'lic-02',
        subscription_id: 'sub-02',
        license_key: '3E7D1B904C62A8F5D2019E4B7C83A610',
        is_active: true,
        created_at: addDaysIso(-21, now),
      },
      {
        id: 'lic-03',
        subscription_id: 'sub-03',
        license_key: '7C15A90E3F824B6D19E05C3A8B742D1F',
        is_active: true,
        created_at: addDaysIso(-14, now),
      },
      {
        id: 'lic-04',
        subscription_id: 'sub-04',
        license_key: '5B80E2D49A17C63F0E482B9D71C5A30E',
        is_active: false,
        created_at: addDaysIso(-80, now),
      },
    ],
    activated_machines: [
      {
        id: 'mac-01',
        license_id: 'lic-01',
        machine_fingerprint: 'node_mumbai_dadar_branch_01',
        activated_at: addDaysIso(-50, now),
        last_heartbeat: addDaysIso(0, now),
      },
      {
        id: 'mac-02',
        license_id: 'lic-01',
        machine_fingerprint: 'node_mumbai_andheri_branch_02',
        activated_at: addDaysIso(-42, now),
        last_heartbeat: addDaysIso(0, now),
      },
      {
        id: 'mac-03',
        license_id: 'lic-02',
        machine_fingerprint: 'node_pune_kothrud_opd_main',
        activated_at: addDaysIso(-20, now),
        last_heartbeat: addDaysIso(-1, now),
      },
      {
        id: 'mac-04',
        license_id: 'lic-02',
        machine_fingerprint: 'node_pune_kothrud_pharmacy_02',
        activated_at: addDaysIso(-15, now),
        last_heartbeat: addDaysIso(0, now),
      },
      {
        id: 'mac-05',
        license_id: 'lic-03',
        machine_fingerprint: 'node_nashik_solo_nuc_01',
        activated_at: addDaysIso(-13, now),
        last_heartbeat: addDaysIso(0, now),
      },
    ],
  };
}

function createMemoryStorage() {
  let state = null;
  return {
    read() {
      if (!state) state = createSeedDatabase();
      return state;
    },
    write(next) {
      state = next;
    },
    reset() {
      state = createSeedDatabase();
      return state;
    },
  };
}

function createBrowserStorage() {
  return {
    read() {
      try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        // Ignore storage errors
      }
      const seeded = createSeedDatabase();
      this.write(seeded);
      return seeded;
    },
    write(next) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    },
    reset() {
      const seeded = createSeedDatabase();
      this.write(seeded);
      return seeded;
    },
  };
}

function computeAdminLicenseView(db) {
  return db.licenses.map((lic) => {
    const sub = db.subscriptions.find((s) => s.id === lic.subscription_id);
    const machines = db.activated_machines.filter(
      (m) => m.license_id === lic.id,
    );
    const heartbeats = machines
      .map((m) => m.last_heartbeat)
      .filter(Boolean)
      .sort();

    return {
      license_id: lic.id,
      subscription_id: sub?.id ?? null,
      customer_email: sub?.customer_email ?? 'unknown@clinic.local',
      license_key: lic.license_key,
      is_active: lic.is_active,
      status: sub?.status ?? 'expired',
      tier: sub?.tier ?? 'standard',
      max_machines: sub?.max_machines ?? 1,
      registered_machines: machines.length,
      last_heartbeat: heartbeats.at(-1) ?? null,
      expires_at: sub?.expires_at ?? new Date().toISOString(),
      notes: sub?.notes ?? '',
      created_at: sub?.created_at ?? lic.created_at,
      updated_at: sub?.updated_at ?? lic.created_at,
    };
  });
}

export function createDemoAuthority({ useMemory = false } = {}) {
  const store =
    useMemory || typeof globalThis.localStorage === 'undefined'
      ? createMemoryStorage()
      : createBrowserStorage();

  let keyPairPromise = null;
  const getKeyPair = () => {
    if (!keyPairPromise) {
      keyPairPromise = generateRsaKeyPairPem();
    }
    return keyPairPromise;
  };

  const client = {
    from(table) {
      if (table === 'admin_license_view') {
        return {
          select() {
            return {
              async order(column, { ascending = true } = {}) {
                const db = store.read();
                const rows = computeAdminLicenseView(db).sort((a, b) => {
                  const av = String(a[column] ?? '');
                  const bv = String(b[column] ?? '');
                  return ascending
                    ? av.localeCompare(bv)
                    : bv.localeCompare(av);
                });
                return { data: rows, error: null };
              },
            };
          },
        };
      }

      if (table === 'licenses') {
        return {
          update(patch) {
            return {
              async eq(col, val) {
                const db = store.read();
                const target = db.licenses.find((l) => l[col] === val);
                if (!target) {
                  return {
                    data: null,
                    error: new Error('License record not found'),
                  };
                }
                Object.assign(target, patch);
                store.write(db);
                return { data: target, error: null };
              },
            };
          },
        };
      }

      if (table === 'activated_machines') {
        return {
          select() {
            return {
              async eq(col, val) {
                const db = store.read();
                return {
                  data: db.activated_machines.filter((m) => m[col] === val),
                  error: null,
                };
              },
            };
          },
        };
      }

      return {
        select: async () => ({ data: [], error: null }),
      };
    },

    async rpc(fnName, params = {}) {
      if (fnName === 'create_subscription_with_license') {
        const db = store.read();
        const now = new Date().toISOString();
        const subId = `sub-${randomHex(6).toLowerCase()}`;
        const licId = `lic-${randomHex(6).toLowerCase()}`;

        db.subscriptions.unshift({
          id: subId,
          customer_email: String(params.p_customer_email ?? '')
            .trim()
            .toLowerCase(),
          status: 'active',
          tier: params.p_tier ?? 'standard',
          max_machines: Number(params.p_max_machines ?? 1),
          expires_at: params.p_expires_at,
          notes: params.p_notes ?? '',
          created_at: now,
          updated_at: now,
        });

        db.licenses.unshift({
          id: licId,
          subscription_id: subId,
          license_key: randomHex(16),
          is_active: true,
          created_at: now,
        });

        store.write(db);
        const created = computeAdminLicenseView(db).find(
          (r) => r.license_id === licId,
        );
        return { data: created, error: null };
      }

      if (fnName === 'revoke_machine_node') {
        const db = store.read();
        const before = db.activated_machines.length;
        db.activated_machines = db.activated_machines.filter(
          (m) => m.id !== params.p_machine_id,
        );
        store.write(db);
        return { data: db.activated_machines.length < before, error: null };
      }

      return { data: null, error: new Error(`Unknown RPC: ${fnName}`) };
    },
  };

  async function verifyLicenseSimulated({ license_key, machine_fingerprint }) {
    const key = String(license_key ?? '').trim().toUpperCase();
    const fp = String(machine_fingerprint ?? '').trim();

    if (!key || !fp) {
      return {
        status: 400,
        body: { error: 'Both license_key and machine_fingerprint are required.' },
      };
    }

    const db = store.read();
    const lic = db.licenses.find((l) => l.license_key === key);
    if (!lic) {
      return { status: 403, body: { error: 'Invalid license key.' } };
    }

    const sub = db.subscriptions.find((s) => s.id === lic.subscription_id);
    if (!sub) {
      return { status: 403, body: { error: 'Subscription missing.' } };
    }
    if (!lic.is_active) {
      return {
        status: 403,
        body: {
          error: 'License key has been deactivated by the administrator.',
        },
      };
    }
    if (sub.status !== 'active') {
      return {
        status: 403,
        body: { error: `Subscription is currently '${sub.status}'.` },
      };
    }
    if (Date.now() >= new Date(sub.expires_at).getTime()) {
      sub.status = 'expired';
      store.write(db);
      return {
        status: 403,
        body: { error: `Subscription expired on ${sub.expires_at}.` },
      };
    }

    const nowIso = new Date().toISOString();
    const existing = db.activated_machines.find(
      (m) => m.license_id === lic.id && m.machine_fingerprint === fp,
    );

    if (existing) {
      existing.last_heartbeat = nowIso;
    } else {
      const count = db.activated_machines.filter(
        (m) => m.license_id === lic.id,
      ).length;
      if (count >= sub.max_machines) {
        return {
          status: 403,
          body: {
            error: `Hardware seat limit reached (${count}/${sub.max_machines} machines registered).`,
          },
        };
      }
      db.activated_machines.push({
        id: `mac-${randomHex(4).toLowerCase()}`,
        license_id: lic.id,
        machine_fingerprint: fp,
        activated_at: nowIso,
        last_heartbeat: nowIso,
      });
    }

    store.write(db);

    const { privateKeyPem, publicKeyPem } = await getKeyPair();
    const { token, payload } = await signCapabilityJwt(
      {
        sub: sub.id,
        license_key: lic.license_key,
        tier: sub.tier,
        machine_fingerprint: fp,
        max_machines: sub.max_machines,
        subscription_expires_at: sub.expires_at,
      },
      privateKeyPem,
    );

    return {
      status: 200,
      body: { token },
      decodedPayload: payload,
      publicKeyPem,
    };
  }

  return {
    client,
    verifyLicenseSimulated,
    getDemoPublicKey: async () => (await getKeyPair()).publicKeyPem,
    resetDemoData: () => store.reset(),
  };
}
