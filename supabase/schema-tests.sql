-- =============================================================================
-- myClinic License Authority — Scratch Database Verification Suite
-- DEV / SCRATCH ONLY · NEVER RUN ON PRODUCTION
--
-- Everything runs inside a single transaction and rolls back at the end, leaving
-- zero trace on the database.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema-tests.sql
-- =============================================================================

begin;

-- 1. Verify `anon` has zero table, view, or provisioning RPC privileges
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
end $$;
reset role;

-- 2. Verify non-admin `authenticated` user sees 0 rows via RLS and cannot provision
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.admin_license_view;
  if v_count <> 0 then
    raise exception 'FAIL: non-admin authenticated user saw % rows in admin_license_view', v_count;
  end if;
  raise notice 'PASS: non-admin authenticated user sees 0 rows';

  begin
    perform public.create_subscription_with_license('unauth@clinic.test', 'solo', 1, now() + interval '30 days', '');
    raise exception 'FAIL: non-admin user invoked create_subscription_with_license';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin blocked from create_subscription_with_license (42501)';
  end;
end $$;
reset role;

-- 3. Verify `admin` (`app_metadata.role = 'admin'`) atomic provisioning, view count, and hardware limit trigger
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);

do $$
declare
  v_row public.admin_license_view;
  v_view_machines integer;
begin
  v_row := public.create_subscription_with_license(
    'ops@testclinic.in',
    'growth',
    2,
    now() + interval '365 days',
    '**PO#:** `PO-991`'
  );

  if v_row.license_id is null or char_length(v_row.license_key) <> 32 then
    raise exception 'FAIL: expected 32-char hex license key, got %', v_row.license_key;
  end if;
  raise notice 'PASS: atomic create_subscription_with_license minted 32-char hex key';

  insert into public.activated_machines (license_id, machine_fingerprint)
  values
    (v_row.license_id, 'node_test_01'),
    (v_row.license_id, 'node_test_02');

  select registered_machines into v_view_machines
    from public.admin_license_view
   where license_id = v_row.license_id;

  if v_view_machines <> 2 then
    raise exception 'FAIL: expected registered_machines = 2, got %', v_view_machines;
  end if;
  raise notice 'PASS: admin_license_view accurately counts registered_machines = 2';

  begin
    insert into public.activated_machines (license_id, machine_fingerprint)
    values (v_row.license_id, 'node_test_03_overflow');
    raise exception 'FAIL: enforce_max_machines_limit allowed 3rd machine on max_machines=2';
  exception when sqlstate '53400' then
    raise notice 'PASS: enforce_max_machines_limit rejected overflow node with 53400';
  end;

  update public.licenses set is_active = false where id = v_row.license_id;
  select * into v_row from public.admin_license_view where license_id = v_row.license_id;
  if v_row.is_active <> false then
    raise exception 'FAIL: kill-switch update did not persist';
  end if;
  raise notice 'PASS: instant kill-switch toggled is_active = false';
  raise notice 'ALL LICENSE AUTHORITY RLS & HARDWARE LOCK CHECKS COMPLETED';
end $$;
reset role;

rollback;
