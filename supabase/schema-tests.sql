-- =============================================================================
-- myClinic License Authority — Scratch Database Security & Auto-Sync Suite (v2)
-- DEV / SCRATCH ONLY · NEVER RUN ON PRODUCTION
--
-- Everything runs inside a single transaction and rolls back at the end, leaving
-- zero trace on the database.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
-- =============================================================================

begin;

-- 1. Verify `anon` has ZERO table, view, rate-limit, or admin RPC privileges
set local role anon;
do $$
begin
  begin
    perform count(*) from public.subscriptions;
    raise exception 'FAIL: anon was able to read public.subscriptions';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.subscriptions';
  end;

  begin
    perform count(*) from public.admin_license_view;
    raise exception 'FAIL: anon was able to read public.admin_license_view';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.admin_license_view';
  end;

  begin
    perform count(*) from public.sync_rate_limits;
    raise exception 'FAIL: anon was able to read public.sync_rate_limits';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.sync_rate_limits';
  end;

  begin
    perform public.create_subscription_with_license('anon@evil.test', 'solo', 1, now() + interval '1 day', '', null, false);
    raise exception 'FAIL: anon invoked create_subscription_with_license';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied execute on create_subscription_with_license';
  end;
end $$;
reset role;

-- 2. Verify non-admin `authenticated` user sees 0 rows via FORCE RLS and cannot provision
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{},"user_metadata":{"role":"admin"}}', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.admin_license_view;
  if v_count <> 0 then
    raise exception 'FAIL: non-admin authenticated user saw % rows in admin_license_view', v_count;
  end if;
  raise notice 'PASS: non-admin authenticated user (even with spoofed user_metadata.role=admin) sees 0 rows';

  begin
    perform public.create_subscription_with_license('unauth@clinic.test', 'solo', 1, now() + interval '30 days', '');
    raise exception 'FAIL: non-admin user invoked create_subscription_with_license';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin blocked from create_subscription_with_license (42501)';
  end;
end $$;
reset role;

-- 3. Provision 3 clinics as `admin`: Dual (Email + URL), Email-only (with TOFU), and URL-only
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);

do $$
declare
  v_dual  public.admin_license_view;
  v_email public.admin_license_view;
  v_url   public.admin_license_view;
  v_res   jsonb;
begin
  -- A) Dual-pinned clinic (requires BOTH email AND URL)
  v_dual := public.create_subscription_with_license(
    'owner@dualclinic.in',
    'growth',
    1,
    now() + interval '365 days',
    'Dual pinned clinic',
    'https://dualclinic.github.io',
    false
  );

  -- B) Email-only clinic with TOFU first-URL lock enabled
  v_email := public.create_subscription_with_license(
    'doctor@emailclinic.in',
    'solo',
    2,
    now() + interval '365 days',
    'Email + TOFU clinic',
    null,
    true
  );

  -- C) URL-only clinic (matches dedicated domain without needing email)
  v_url := public.create_subscription_with_license(
    null,
    'chain',
    1,
    now() + interval '365 days',
    'URL only clinic',
    'https://urlclinic.github.io',
    false
  );

  if v_dual.allowed_origin <> 'https://dualclinic.github.io' or v_url.customer_email is not null then
    raise exception 'FAIL: unexpected routing columns on provisioned rows';
  end if;
  raise notice 'PASS: provisioned Dual, Email+TOFU, and URL-only clinics';
end $$;
reset role;

-- 4. Test `anon` calling `sync_clinic_subscription` across security & routing scenarios
set local role anon;
do $$
declare
  v_res jsonb;
begin
  -- 4a. Healthcheck readiness probe returns ok without touching rows
  v_res := public.sync_clinic_subscription('', '', 'healthcheck');
  if coalesce((v_res ->> 'sync_ready')::boolean, false) <> true then
    raise exception 'FAIL: healthcheck probe failed: %', v_res;
  end if;
  raise notice 'PASS: healthcheck probe succeeded';

  -- 4b. Browser Origin header mismatch is blocked (cross-origin spoofing defense)
  perform set_config('request.headers', '{"origin":"https://evil.github.io","x-forwarded-for":"203.0.113.10"}', true);
  v_res := public.sync_clinic_subscription('owner@dualclinic.in', 'https://dualclinic.github.io', 'dev-1');
  if (v_res ->> 'code') <> 'ORIGIN_MISMATCH' then
    raise exception 'FAIL: expected ORIGIN_MISMATCH, got %', v_res;
  end if;
  raise notice 'PASS: cross-origin browser spoofing blocked with ORIGIN_MISMATCH';

  -- 4c. Dual-pinned clinic: knowing email alone from wrong domain is rejected
  perform set_config('request.headers', '{"origin":"https://evil.github.io","x-forwarded-for":"203.0.113.10"}', true);
  v_res := public.sync_clinic_subscription('owner@dualclinic.in', 'https://evil.github.io', 'dev-1');
  if coalesce((v_res ->> 'allowed')::boolean, true) <> false then
    raise exception 'FAIL: dual-pinned clinic unlocked from wrong domain: %', v_res;
  end if;
  raise notice 'PASS: dual-pinned clinic refused wrong domain even with valid email';

  -- 4d. Dual-pinned clinic: matching BOTH email + verified browser Origin unlocks
  perform set_config('request.headers', '{"origin":"https://dualclinic.github.io","x-forwarded-for":"203.0.113.11"}', true);
  v_res := public.sync_clinic_subscription('owner@dualclinic.in', 'https://dualclinic.github.io', 'dev-1');
  if coalesce((v_res ->> 'allowed')::boolean, false) <> true or (v_res ->> 'tier') <> 'growth' then
    raise exception 'FAIL: dual-pinned clinic failed to unlock: %', v_res;
  end if;
  raise notice 'PASS: dual-pinned clinic unlocked with tier=growth';

  -- 4e. TOFU lock: Email-only clinic pins first cloud URL automatically, then blocks second URL
  perform set_config('request.headers', '{"origin":"https://firstclinic.github.io","x-forwarded-for":"203.0.113.12"}', true);
  v_res := public.sync_clinic_subscription('doctor@emailclinic.in', 'https://firstclinic.github.io', 'dev-1');
  if coalesce((v_res ->> 'allowed')::boolean, false) <> true then
    raise exception 'FAIL: email TOFU clinic failed first sync: %', v_res;
  end if;

  perform set_config('request.headers', '{"origin":"https://secondclinic.github.io","x-forwarded-for":"203.0.113.12"}', true);
  v_res := public.sync_clinic_subscription('doctor@emailclinic.in', 'https://secondclinic.github.io', 'dev-2');
  if coalesce((v_res ->> 'allowed')::boolean, true) <> false then
    raise exception 'FAIL: TOFU lock failed to block second domain: %', v_res;
  end if;
  raise notice 'PASS: TOFU auto-locked first cloud URL and blocked second URL';

  -- 4f. URL-only clinic unlocks any staff member on that verified domain
  perform set_config('request.headers', '{"origin":"https://urlclinic.github.io","x-forwarded-for":"203.0.113.13"}', true);
  v_res := public.sync_clinic_subscription('', 'https://urlclinic.github.io', 'dev-1');
  if coalesce((v_res ->> 'allowed')::boolean, false) <> true or (v_res ->> 'plan') <> 'chain' then
    raise exception 'FAIL: URL-only clinic failed to unlock: %', v_res;
  end if;
  raise notice 'PASS: URL-only clinic unlocked with plan=chain';
end $$;
reset role;

-- 5. Verify central kill-switch immediately revokes auto-sync
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
update public.licenses
   set is_active = false
 where subscription_id in (select id from public.subscriptions where allowed_origin = 'https://urlclinic.github.io');
reset role;

set local role anon;
do $$
declare
  v_res jsonb;
begin
  perform set_config('request.headers', '{"origin":"https://urlclinic.github.io","x-forwarded-for":"203.0.113.13"}', true);
  v_res := public.sync_clinic_subscription('', 'https://urlclinic.github.io', 'dev-1');
  if (v_res ->> 'code') <> 'SUBSCRIPTION_PAUSED' then
    raise exception 'FAIL: expected SUBSCRIPTION_PAUSED after kill-switch, got %', v_res;
  end if;
  raise notice 'PASS: central kill-switch immediately paused clinic auto-sync';
end $$;
reset role;

-- 6. Verify admin_license_view surfaces exact client sync delivery receipts (`last_synced_tier` + `last_synced_status`)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare
  v_growth_ack record;
  v_paused_ack record;
begin
  select last_synced_tier, last_synced_status
    into v_growth_ack
    from public.admin_license_view
   where allowed_origin = 'https://dualclinic.github.io'
   limit 1;

  if v_growth_ack.last_synced_tier <> 'growth' or v_growth_ack.last_synced_status <> 'active' then
    raise exception 'FAIL: expected last_synced_tier=growth & active, got %', v_growth_ack;
  end if;

  select last_synced_tier, last_synced_status
    into v_paused_ack
    from public.admin_license_view
   where allowed_origin = 'https://urlclinic.github.io'
   limit 1;

  if v_paused_ack.last_synced_status <> 'paused' then
    raise exception 'FAIL: expected last_synced_status=paused after client synced pause, got %', v_paused_ack;
  end if;

  raise notice 'PASS: admin_license_view tracks exact client-acknowledged tier & pause status';
  raise notice 'ALL CENTRAL DATABASE SECURITY & KEYLESS AUTO-SYNC CHECKS COMPLETED';
end $$;
reset role;

rollback;
