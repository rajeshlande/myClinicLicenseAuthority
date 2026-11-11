-- =============================================================================
-- myClinic License Authority — Scratch Database Security & Auto-Sync Suite (v4)
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
end $$;
reset role;

-- 7. Verify the v3 refused-attempt audit: refusals leave evidence, the allowed path
--    and the healthcheck leave none, and nothing raw (IP / mailbox) is ever stored.
--    Every refusal asserted below was produced by sections 4-6 in THIS transaction.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare
  v_dual    record;
  v_email   record;
  v_url     record;
  v_spoof   record;
  v_rows    integer;
  v_cols    text;
begin
  -- 7a. Near-miss attribution: section 4c sent the RIGHT owner email from the WRONG
  --     domain, so no subscription matched — yet the refusal is pinned to the
  --     dual clinic's own license, which is the whole point of schema v3.
  select last_refusal_code, last_refusal_email_hint, last_refusal_origin, refusals_24h
    into v_dual
    from public.admin_license_view
   where allowed_origin = 'https://dualclinic.github.io'
   limit 1;

  if v_dual.last_refusal_code <> 'SUBSCRIPTION_NOT_FOUND' then
    raise exception 'FAIL: expected near-miss SUBSCRIPTION_NOT_FOUND on the dual clinic, got %', v_dual;
  end if;
  if v_dual.last_refusal_email_hint <> 'o***@dualclinic.in' then
    raise exception 'FAIL: expected masked email hint o***@dualclinic.in, got %', v_dual.last_refusal_email_hint;
  end if;
  if v_dual.last_refusal_origin <> 'https://evil.github.io' then
    raise exception 'FAIL: expected the claimed origin to be preserved verbatim, got %', v_dual.last_refusal_origin;
  end if;
  if coalesce(v_dual.refusals_24h, 0) < 1 then
    raise exception 'FAIL: refusals_24h should count the near-miss attempt, got %', v_dual.refusals_24h;
  end if;
  raise notice 'PASS: unmatched dual-pinned client call is attributed to its subscription with masked email + verbatim origin';

  -- 7b. The TOFU clinic refused a second domain (4e) and the killed URL clinic
  --     refused with SUBSCRIPTION_PAUSED (5) — both attributed, both readable.
  select last_refusal_code, last_refusal_origin
    into v_email
    from public.admin_license_view
   where customer_email = 'doctor@emailclinic.in'
   limit 1;
  if v_email.last_refusal_code <> 'SUBSCRIPTION_NOT_FOUND'
     or v_email.last_refusal_origin <> 'https://secondclinic.github.io' then
    raise exception 'FAIL: expected the TOFU second-domain refusal on the email clinic, got %', v_email;
  end if;

  select last_refusal_code, last_refusal_origin, last_refusal_at
    into v_url
    from public.admin_license_view
   where allowed_origin = 'https://urlclinic.github.io'
   limit 1;
  if v_url.last_refusal_code <> 'SUBSCRIPTION_PAUSED' then
    raise exception 'FAIL: expected SUBSCRIPTION_PAUSED on the killed clinic, got %', v_url;
  end if;
  if v_url.last_refusal_at is null then
    raise exception 'FAIL: last_refusal_at must be set for an attributed refusal';
  end if;
  raise notice 'PASS: TOFU refusal and central kill-switch refusal are both attributed and timestamped';

  -- 7c. The ORIGIN_MISMATCH defence (4b) keeps the unforgeable browser header next to
  --     the claim, and flags the contradiction.
  select code, claimed_origin, browser_origin, origin_header_ok, ip_hash
    into v_spoof
    from public.sync_attempts
   where code = 'ORIGIN_MISMATCH'
   order by attempted_at desc, id desc
   limit 1;
  if v_spoof.claimed_origin <> 'https://dualclinic.github.io'
     or v_spoof.browser_origin <> 'https://evil.github.io'
     or v_spoof.origin_header_ok then
    raise exception 'FAIL: ORIGIN_MISMATCH evidence is wrong: %', v_spoof;
  end if;
  raise notice 'PASS: ORIGIN_MISMATCH records the claim, the real browser Origin, and the contradiction';

  -- 7d. Privacy: the caller IP exists only as the rate limiter's own digest, and the
  --     mailbox only as digest + mask.
  if v_spoof.ip_hash <> encode(digest('myclinic-sync-v2:203.0.113.10', 'sha256'), 'hex') then
    raise exception 'FAIL: ip_hash is not the peppered SHA-256 of the caller IP: %', v_spoof.ip_hash;
  end if;
  if position('203.0.113' in v_spoof.ip_hash) > 0 then
    raise exception 'FAIL: raw IP leaked into ip_hash';
  end if;

  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sync_attempts';
  if v_cols ~ '(^|,)(ip|raw_ip|ip_address|email|customer_email|email_address|device_id)(,|$)' then
    raise exception 'FAIL: sync_attempts exposes a raw identifier column: %', v_cols;
  end if;
  if v_cols not like '%ip_hash%' or v_cols not like '%claimed_email_hash%' then
    raise exception 'FAIL: sync_attempts is missing its hashed identifier columns: %', v_cols;
  end if;
  raise notice 'PASS: audit stores hashed IP + hashed/masked email only (% )', v_cols;

  -- 7e. The allowed path (4d, 4e first URL, 4f) and the healthcheck write NOTHING:
  --     a healthy fleet must not grow this table, and the probe stays zero-side-effect.
  select count(*) into v_rows from public.sync_attempts where code in ('ACTIVE', 'GRANTED', 'OK');
  if v_rows <> 0 then
    raise exception 'FAIL: allowed syncs must not be audited, found % rows', v_rows;
  end if;
  raise notice 'PASS: allowed verdicts are never audited (table holds only refusals)';
end $$;
reset role;

-- 7f. `anon` has no read access to the audit, and an admin token cannot write to it:
--     the evidence is read-only for everyone except the SECURITY DEFINER RPC.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.sync_attempts;
    raise exception 'FAIL: anon was able to read public.sync_attempts';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.sync_attempts';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
begin
  begin
    insert into public.sync_attempts (code, status, ip_hash)
    values ('FORGED', 'test', repeat('a', 64));
    raise exception 'FAIL: an admin token was able to forge audit evidence';
  exception when insufficient_privilege then
    raise notice 'PASS: admin token cannot insert into sync_attempts (RPC is the only writer)';
  end;
end $$;
reset role;

-- 8. Schema v4 — clinic_activity_log + invoices: admin-only, append-only history.
-- 8a. `anon` has zero read access to either v4 table.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.clinic_activity_log;
    raise exception 'FAIL: anon was able to read public.clinic_activity_log';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.clinic_activity_log';
  end;

  begin
    perform count(*) from public.invoices;
    raise exception 'FAIL: anon was able to read public.invoices';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.invoices';
  end;
end $$;
reset role;

-- 8b. Admin: append timeline events, issue + pay an invoice, read the new
--     admin_license_view billing columns — and STILL cannot rewrite history.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare
  v_sub    public.admin_license_view;
  v_act_id uuid;
  v_inv_id uuid;
  v_view   public.admin_license_view;
begin
  v_sub := public.create_subscription_with_license(
    'activity@v4clinic.in', 'growth', 2, now() + interval '365 days',
    'v4 activity probe', null, false
  );

  insert into public.clinic_activity_log (subscription_id, license_id, event_kind, actor, payload)
  values (v_sub.subscription_id, v_sub.license_id, 'onboarded', 'ops@v4.test', '{"tier":"growth"}'::jsonb)
  returning id into v_act_id;

  insert into public.clinic_activity_log (subscription_id, license_id, event_kind, actor, payload)
  values (v_sub.subscription_id, v_sub.license_id, 'invoice_issued', 'ops@v4.test', '{"number":"INV-2026-0001"}'::jsonb)
  returning id into v_act_id;

  insert into public.invoices (
    invoice_number, subscription_id, license_id, status, currency,
    line_items, tax_rate, subtotal, tax_amount, total, issued_at, due_at
  ) values (
    'INV-2026-0001', v_sub.subscription_id, v_sub.license_id, 'issued', 'INR',
    '[{"description":"Growth plan - annual","qty":1,"unit":12000.00}]'::jsonb,
    0.18, 12000.00, 2160.00, 14160.00, now(), now() + interval '30 days'
  )
  returning id into v_inv_id;

  select * into v_view
    from public.admin_license_view
   where license_id = v_sub.license_id;

  if v_view.latest_invoice_number <> 'INV-2026-0001'
     or v_view.latest_invoice_status <> 'issued'
     or v_view.latest_invoice_total <> 14160.00
     or v_view.open_invoice_count <> 1 then
    raise exception 'FAIL: admin_license_view invoice columns wrong: % / % / % / %',
      v_view.latest_invoice_number, v_view.latest_invoice_status,
      v_view.latest_invoice_total, v_view.open_invoice_count;
  end if;
  raise notice 'PASS: admin appended activity + invoice; admin_license_view exposes invoice standing';

  update public.invoices
     set status = 'paid', paid_at = now()
   where id = v_inv_id;

  perform 1 from public.invoices where id = v_inv_id and status = 'paid';
  if not found then
    raise exception 'FAIL: admin could not move the invoice to paid';
  end if;
  raise notice 'PASS: admin moved invoice issued -> paid (lifecycle update granted)';

  -- Append-only: corrections are NEW events, never edits — not even for admins.
  begin
    update public.clinic_activity_log
       set actor = 'tampered'
     where id = v_act_id;
    raise exception 'FAIL: admin was able to UPDATE the activity log';
  exception when insufficient_privilege then
    raise notice 'PASS: activity log is append-only (admin UPDATE denied)';
  end;

  begin
    delete from public.clinic_activity_log where id = v_act_id;
    raise exception 'FAIL: admin was able to DELETE activity history';
  exception when insufficient_privilege then
    raise notice 'PASS: activity log is append-only (admin DELETE denied)';
  end;
end $$;
reset role;

-- 8c. A non-admin `authenticated` token (user_metadata role=admin is ignored):
--     the rows 8b just wrote are INVISIBLE to it (FORCE RLS + admin policies
--     filter SELECT silently), and its own writes are refused by WITH CHECK.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{},"user_metadata":{"role":"admin"}}', true);
do $$
declare
  v_activity integer;
  v_invoices integer;
begin
  select count(*) into v_activity from public.clinic_activity_log;
  select count(*) into v_invoices from public.invoices;
  if v_activity <> 0 or v_invoices <> 0 then
    raise exception 'FAIL: non-admin authenticated saw % activity / % invoice rows', v_activity, v_invoices;
  end if;
  raise notice 'PASS: non-admin authenticated sees zero activity + invoice rows (FORCE RLS)';

  begin
    insert into public.invoices (invoice_number, subscription_id)
    values ('INV-ROGUE-0001', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL: non-admin authenticated inserted an invoice';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin authenticated denied insert on invoices (WITH CHECK)';
  end;

  begin
    insert into public.clinic_activity_log (subscription_id, event_kind)
    values ('00000000-0000-0000-0000-000000000000', 'onboarded');
    raise exception 'FAIL: non-admin authenticated appended to the activity log';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin authenticated denied insert on clinic_activity_log (WITH CHECK)';
  end;
end $$;
reset role;

-- 7g. 30-day retention: an aged row disappears on the next refusal, once per 24h.
do $$
declare
  v_aged_id uuid;
  v_left    integer;
begin
  insert into public.sync_attempts (attempted_at, code, status, ip_hash)
  values (clock_timestamp() - interval '40 days', 'AGED_OUT', 'test', repeat('b', 64))
  returning id into v_aged_id;

  -- The prune is throttled through the rate-limit bucket table; free it so this
  -- assertion is deterministic instead of depending on earlier calls.
  delete from public.sync_rate_limits
   where bucket_key like 'prune:%' or bucket_key like 'audit:%' or bucket_key like 'miss:%';
end $$;

set local role anon;
select set_config('request.headers', '{"origin":"https://unmatched.test","x-forwarded-for":"203.0.113.99"}', true);
do $$
declare
  v_res jsonb;
begin
  v_res := public.sync_clinic_subscription('nobody@unmatched.test', 'https://unmatched.test', 'dev-retention');
  if (v_res ->> 'code') <> 'SUBSCRIPTION_NOT_FOUND' then
    raise exception 'FAIL: expected SUBSCRIPTION_NOT_FOUND for the retention probe, got %', v_res;
  end if;
end $$;
reset role;

do $$
declare
  v_aged  integer;
  v_fresh integer;
  v_mode  text;
begin
  select count(*) into v_aged  from public.sync_attempts where code = 'AGED_OUT';
  select count(*) into v_fresh from public.sync_attempts where code = 'SUBSCRIPTION_NOT_FOUND' and claimed_origin = 'https://unmatched.test';
  if v_aged <> 0 then
    raise exception 'FAIL: 40-day-old audit row survived the 30-day retention prune';
  end if;
  if v_fresh < 1 then
    raise exception 'FAIL: the fresh refusal was pruned along with the aged row';
  end if;

  select match_mode into v_mode
    from public.sync_attempts
   where claimed_origin = 'https://unmatched.test'
   order by attempted_at desc, id desc
   limit 1;
  if v_mode <> 'no-candidate' then
    raise exception 'FAIL: an unmatched identity must be recorded as no-candidate, got %', v_mode;
  end if;
  raise notice 'PASS: 30-day retention pruned the aged row and kept the fresh refusal';

  raise notice 'PASS: refused-attempt audit is admin-only, privacy-preserving and self-pruning';

  if public.app_schema_version() <> 4 then
    raise exception 'FAIL: app_schema_version() must be 4 after the v4 migration, got %', public.app_schema_version();
  end if;
  raise notice 'PASS: app_schema_version() = 4 (activity log + invoices applied)';
  raise notice 'ALL CENTRAL DATABASE SECURITY & KEYLESS AUTO-SYNC CHECKS COMPLETED';
end $$;

rollback;
