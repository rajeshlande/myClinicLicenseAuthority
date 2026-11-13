-- =============================================================================
-- myClinic License Authority — Scratch Database Security & Auto-Sync Suite (v6)
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

  if public.app_schema_version() <> 8 then
    raise exception 'FAIL: app_schema_version() must be 8 after the v4+v5+v6+v7+v8 migrations, got %', public.app_schema_version();
  end if;
  raise notice 'PASS: app_schema_version() = 8 (activity log + invoices + workspace directory + tenant connection/keep-warm + anonymous booking directory applied + workspace audit log)';
  raise notice 'ALL CENTRAL DATABASE SECURITY & KEYLESS AUTO-SYNC CHECKS COMPLETED';
end $$;

-- =============================================================================
-- 9. SCHEMA v5 — OPD WORKSPACE DIRECTORY (anon-dark, member-read, admin-write)
-- =============================================================================

-- 9a. anon is denied reads AND discovery on both directory tables
set local role anon;
do $$
begin
  begin
    perform count(*) from public.workspaces;
    raise exception 'FAIL: anon was able to read public.workspaces';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.workspaces';
  end;
  begin
    perform count(*) from public.workspace_members;
    raise exception 'FAIL: anon was able to read public.workspace_members';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied read on public.workspace_members';
  end;
  begin
    perform public.my_workspaces();
    raise exception 'FAIL: anon executed public.my_workspaces()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied my_workspaces()';
  end;
end $$;

-- 9b. admin seeds a workspace + member; inactive rows stay out of discovery
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare
  v_ws uuid;
  v_n  integer;
begin
  insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active)
  values ('Sunrise OPD', 'sunrise-opd', 'https://sunriseopd.supabase.co', 'sb_publishable_test_123', false)
  returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, '00000000-0000-0000-0000-000000000003', 'doctor');
  select count(*) into v_n from public.my_workspaces() where slug = 'sunrise-opd';
  if v_n <> 0 then
    raise exception 'FAIL: inactive workspace visible in my_workspaces(): %', v_n;
  end if;
  raise notice 'PASS: admin wrote directory; inactive workspace hidden from discovery';
end $$;

-- 9c. the member sees exactly one ACTIVE workspace, with its connection row
update public.workspaces
   set is_active = true, tenant_schema_version = 21
 where slug = 'sunrise-opd';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{}}', true);
do $$
declare
  v_n   integer;
  v_key text;
begin
  select count(*) into v_n from public.my_workspaces();
  if v_n <> 1 then
    raise exception 'FAIL: member discovery returned % rows', v_n;
  end if;
  select supabase_anon_key into v_key from public.my_workspaces() where slug = 'sunrise-opd';
  if v_key is null then
    raise exception 'FAIL: member did not receive the connection key';
  end if;
  raise notice 'PASS: member discovery returns exactly one active workspace with connection';
end $$;

-- 9d. a non-member authenticated user: zero rows and no write path
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","app_metadata":{}}', true);
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.workspaces;
  if v_n <> 0 then
    raise exception 'FAIL: non-member read % workspace rows', v_n;
  end if;
  select count(*) into v_n from public.my_workspaces();
  if v_n <> 0 then
    raise exception 'FAIL: non-member discovery returned % rows', v_n;
  end if;
  begin
    insert into public.workspaces (clinic_name, slug) values ('Evil Clinic', 'evil-clinic');
    raise exception 'FAIL: non-member inserted a workspace';
  exception when insufficient_privilege then
    raise notice 'PASS: non-member denied read and write on the directory';
  end;
end $$;

-- 9e. privileged keys are rejected by the CHECK, not by politeness
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
begin
  begin
    insert into public.workspaces (clinic_name, slug, supabase_anon_key)
    values ('Bad Key Clinic', 'bad-key-clinic', 'sb_secret_leaked_value');
    raise exception 'FAIL: an sb_secret key was accepted';
  exception when check_violation then
    raise notice 'PASS: CHECK rejects sb_secret/service_role keys';
  end;
end $$;
reset role;

-- 9f. D4-a: anon resolves an ACTIVE workspace by slug for the no-session booking page.
--     sunrise-opd was made active in 9c; the public page has only the slug, so this is
--     the one anon-readable path from a slug to that clinic's own project connection.
set local role anon;
do $$
declare
  v_n   integer;
  v_url text;
  v_key text;
begin
  select count(*), min(supabase_url), min(supabase_anon_key) into v_n, v_url, v_key
  from public.public_workspace_by_slug('sunrise-opd');
  if v_n <> 1 then
    raise exception 'FAIL: anon booking directory returned % rows for an active slug', v_n;
  end if;
  if v_url is null or v_key is null then
    raise exception 'FAIL: booking directory omitted the connection fields';
  end if;
  select count(*) into v_n from public.public_workspace_by_slug('no-such-clinic');
  if v_n <> 0 then
    raise exception 'FAIL: an unknown slug resolved to % rows', v_n;
  end if;
  raise notice 'PASS: anon resolves an active workspace by slug; unknown slug returns no rows';
end $$;

-- 9g. D4-a fail-closed: a DEACTIVATED clinic goes dark for booking (C6 — is_active=false
--     stops both my_workspaces() and this), and anon still cannot read the directory
--     table itself — the fail-closed RPC is the only anon surface.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active)
values ('Gone Clinic', 'gone-clinic', 'https://goneclinic.supabase.co', 'sb_publishable_test_gone', false);
reset role;
set local role anon;
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.public_workspace_by_slug('gone-clinic');
  if v_n <> 0 then
    raise exception 'FAIL: a deactivated workspace still resolved for booking: % rows', v_n;
  end if;
  begin
    perform count(*) from public.workspaces;
    raise exception 'FAIL: anon read the directory table directly';
  exception when insufficient_privilege then
    raise notice 'PASS: inactive workspace dark for booking; anon still denied the table';
  end;
end $$;
reset role;

-- =============================================================================
-- 10. SCHEMA v5 — the workspace pointer rides the single anon RPC (D4'/F1/S3)
-- =============================================================================

-- 10a. link the §9 workspace to a real subscription (admin provision + link)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_row public.admin_license_view;
begin
  select * into v_row from public.create_subscription_with_license(
    p_customer_email => 'ops@sunriseopd.example',
    p_allowed_origin => 'https://sunriseopd.github.io',
    p_tier           => 'growth',
    p_max_machines   => 2,
    p_expires_at     => now() + interval '365 days');
  update public.subscriptions
     set workspace_id = (select id from public.workspaces where slug = 'sunrise-opd')
   where id = v_row.subscription_id;
  raise notice 'PASS: subscription linked to workspace sunrise-opd';
end $$;

-- 10b. anon sync on a matched clinic returns the active workspace pointer
set local role anon;
select set_config('request.headers', '{"origin":"https://sunriseopd.github.io"}', true);
do $$
declare v_res jsonb;
begin
  v_res := public.sync_clinic_subscription('ops@sunriseopd.example', 'https://sunriseopd.github.io', 'p1b-device');
  if coalesce((v_res ->> 'allowed')::boolean, false) <> true then
    raise exception 'FAIL: matched sync refused: %', v_res;
  end if;
  if v_res -> 'workspace' ->> 'slug' is distinct from 'sunrise-opd' then
    raise exception 'FAIL: workspace pointer missing: %', v_res -> 'workspace';
  end if;
  if nullif(v_res -> 'workspace' ->> 'supabase_anon_key', '') is null then
    raise exception 'FAIL: workspace pointer lacks connection key';
  end if;
  raise notice 'PASS: anon sync carries the active workspace pointer (slug + connection)';
end $$;

-- 10c. deactivating the workspace withdraws the pointer without touching the licence
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
update public.workspaces set is_active = false where slug = 'sunrise-opd';
set local role anon;
do $$
declare v_res jsonb;
begin
  v_res := public.sync_clinic_subscription('ops@sunriseopd.example', 'https://sunriseopd.github.io', 'p1b-device');
  if coalesce((v_res ->> 'allowed')::boolean, false) <> true then
    raise exception 'FAIL: licence verdict changed when workspace deactivated: %', v_res;
  end if;
  -- jsonb null is NOT sql NULL: a withdrawn pointer arrives as the json
  -- literal null, so assert on the payload, not on the key's presence.
  if v_res -> 'workspace' ->> 'slug' is not null then
    raise exception 'FAIL: inactive workspace still advertised: %', v_res -> 'workspace';
  end if;
  raise notice 'PASS: inactive workspace withdraws the pointer; licence verdict unchanged';
end $$;

-- 10d. the healthcheck branch stays side-effect free and pointer-free
do $$
declare v_res jsonb;
begin
  v_res := public.sync_clinic_subscription('', '', 'healthcheck');
  if v_res ? 'workspace' then
    raise exception 'FAIL: healthcheck response gained a workspace key';
  end if;
  raise notice 'PASS: healthcheck probe stays pointer-free';
end $$;
reset role;

-- =============================================================================
-- 11. SCHEMA v6 — free-tier keep-warm: who may probe, who may stamp, and what
--     the console is allowed to see (owner FYI 2026-11-11: a free project
--     PAUSES after 7 idle days, so the cadence below is an availability control,
--     not a nicety. tests/keep-warm.test.mjs pins the same numbers to
--     contract/workspace-directory-contract.json.)
-- =============================================================================

-- 11a. four workspaces, four keep-warm situations
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
update public.workspaces
   set is_active = true,
       keep_warm_at = now() - interval '9 days'
 where slug = 'sunrise-opd';
insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active, keep_warm_at)
values ('Fresh Clinic', 'fresh-clinic', 'https://freshclinic.supabase.co', 'sb_publishable_fresh_1', true, now()),
       ('Never Clinic', 'never-clinic', 'https://neverclinic.supabase.co', 'sb_publishable_never_1', true, null),
       ('Dark Clinic', 'dark-clinic', 'https://darkclinic.supabase.co', 'sb_publishable_dark_1', false, null);

do $$
declare
  v_slugs  text;
  v_states text;
begin
  select string_agg(slug, ',' order by keep_warm_at nulls first, clinic_name),
         string_agg(keep_warm_state, ',' order by keep_warm_at nulls first, clinic_name)
    into v_slugs, v_states
  from public.due_keep_warm_workspaces(20);

  -- warm (fresh-clinic) is not due; inactive (dark-clinic) is not armed;
  -- never-probed sorts ahead of the idle-but-stamped one.
  if v_slugs is distinct from 'never-clinic,sunrise-opd' then
    raise exception 'FAIL: due list = %', coalesce(v_slugs, '<null>');
  end if;
  if v_states is distinct from 'unknown,overdue' then
    raise exception 'FAIL: due states = %', coalesce(v_states, '<null>');
  end if;
  raise notice 'PASS: only armed, active, idle-past-target workspaces are due (never-probed first)';
end $$;

-- 11b. the due window is the contract's 5 days, not the 7-day pause itself
do $$
declare v_n integer;
begin
  update public.workspaces set keep_warm_at = now() - interval '4 days' where slug = 'never-clinic';
  select count(*) into v_n from public.due_keep_warm_workspaces(20) where slug = 'never-clinic';
  if v_n <> 0 then
    raise exception 'FAIL: a workspace idle 4 days was listed as due';
  end if;
  update public.workspaces set keep_warm_at = now() - interval '6 days' where slug = 'never-clinic';
  select count(*) into v_n from public.due_keep_warm_workspaces(20) where slug = 'never-clinic';
  if v_n <> 1 then
    raise exception 'FAIL: a workspace idle 6 days was not listed as due';
  end if;
  raise notice 'PASS: the SQL due window is 5 days — two days of margin before the pause';
end $$;

-- 11c. a non-admin authenticated operator gets neither the queue nor the stamp
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","app_metadata":{}}', true);
do $$
begin
  begin
    perform public.due_keep_warm_workspaces(5);
    raise exception 'FAIL: non-admin listed the keep-warm queue';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin denied the keep-warm queue';
  end;

  begin
    perform public.stamp_keep_warm(gen_random_uuid(), true);
    raise exception 'FAIL: non-admin stamped keep-warm';
  exception when insufficient_privilege then
    raise notice 'PASS: non-admin denied the keep-warm stamp';
  end;
end $$;

-- 11d. anon gets nothing, and NO API role may trigger the fleet-wide cycle
set local role anon;
select set_config('request.jwt.claims', '{}', true);
do $$
begin
  begin
    perform public.due_keep_warm_workspaces(5);
    raise exception 'FAIL: anon listed the keep-warm queue';
  exception when insufficient_privilege then
    raise notice 'PASS: anon denied the keep-warm queue';
  end;

  begin
    perform public.run_keep_warm_cycle(5);
    raise exception 'FAIL: an API role ran the keep-warm cycle';
  exception when insufficient_privilege then
    raise notice 'PASS: run_keep_warm_cycle belongs to the database (pg_cron), not to any API role';
  end;
end $$;

-- 11e. a failed probe never fakes warmth; a successful one clears the queue
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare
  v_ws     uuid;
  v_before timestamptz;
  v_after  timestamptz;
  v_n      integer;
begin
  select id, keep_warm_at into v_ws, v_before
  from public.workspaces where slug = 'sunrise-opd';

  perform public.stamp_keep_warm(v_ws, false);
  select keep_warm_at into v_after from public.workspaces where id = v_ws;
  if v_after is distinct from v_before then
    raise exception 'FAIL: a failed probe stamped the workspace warm';
  end if;

  perform public.stamp_keep_warm(v_ws, true);
  select keep_warm_at into v_after from public.workspaces where id = v_ws;
  if v_after is null or v_after <= v_before then
    raise exception 'FAIL: stamp_keep_warm did not advance keep_warm_at';
  end if;

  select count(*) into v_n from public.due_keep_warm_workspaces(20) where slug = 'sunrise-opd';
  if v_n <> 0 then
    raise exception 'FAIL: a freshly warmed workspace is still listed as due';
  end if;
  raise notice 'PASS: p_ok=false leaves the stamp alone; p_ok=true warms it and clears the queue';
end $$;

-- 11f. the flattened view carries the workspace link for the console
do $$
declare
  v_slug   text;
  v_active boolean;
  v_stamp  timestamptz;
begin
  select workspace_slug, workspace_active, workspace_keep_warm_at
    into v_slug, v_active, v_stamp
  from public.admin_license_view
  where customer_email = 'ops@sunriseopd.example';

  if v_slug is distinct from 'sunrise-opd' then
    raise exception 'FAIL: admin_license_view lost the workspace link: %', coalesce(v_slug, '<null>');
  end if;
  if v_active is not true then
    raise exception 'FAIL: admin_license_view does not surface is_active';
  end if;
  if v_stamp is null then
    raise exception 'FAIL: admin_license_view does not surface keep_warm_at';
  end if;
  raise notice 'PASS: admin_license_view exposes the workspace link + keep-warm stamp';
end $$;

-- 11g. an unlinked subscription keeps a NULL pointer (the join is a LEFT one)
do $$
declare v_row public.admin_license_view;
begin
  select * into v_row from public.create_subscription_with_license(
    p_customer_email => 'no-workspace@example.com',
    p_tier           => 'solo',
    p_max_machines   => 1,
    p_expires_at     => now() + interval '90 days');

  if v_row.workspace_id is not null or v_row.workspace_slug is not null then
    raise exception 'FAIL: a fresh subscription arrived pre-linked to a workspace';
  end if;
  raise notice 'PASS: unlinked subscriptions keep a NULL workspace pointer';
end $$;

-- =============================================================================
-- 12. §14 OPERATOR RUNBOOKS — deactivate a clinic, rotate its publishable key,
--     revoke a user. None of these needed new SQL: workspaces_admin_write and
--     workspace_members_admin_write already grant them to a caller whose
--     app_metadata.role is 'admin', and both directory RPCs already filter on
--     is_active. What was missing is the OPERATOR SURFACE, so these checks pin the
--     behaviour that surface has to rely on — above all that RLS refuses a
--     non-admin SILENTLY: the statement succeeds and touches 0 rows, so "no
--     exception" is not proof the write landed.
-- =============================================================================

-- 12a. seed an active clinic with a publishable key, an admin and a staff member
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active, tenant_schema_version)
values ('Ops Clinic', 'ops-clinic', 'https://opsclinic.supabase.co', 'sb_publishable_ops_before', true, 22);
insert into public.workspace_members (workspace_id, user_id, role)
values ((select id from public.workspaces where slug = 'ops-clinic'), '00000000-0000-0000-0000-000000000002', 'admin'),
       ((select id from public.workspaces where slug = 'ops-clinic'), '00000000-0000-0000-0000-000000000003', 'staff');

-- 12b. §14 "Deactivate a clinic": one admin write removes it from BOTH discovery
--      paths at once — the member's directory and the anonymous booking link.
do $$
declare v_rows integer; v_n integer;
begin
  update public.workspaces
     set is_active = false, updated_at = now()
   where slug = 'ops-clinic';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: an admin deactivate touched % rows, expected exactly 1', v_rows;
  end if;
  select count(*) into v_n from public.my_workspaces() where slug = 'ops-clinic';
  if v_n <> 0 then
    raise exception 'FAIL: a deactivated clinic is still listed by my_workspaces()';
  end if;
  raise notice 'PASS: an admin deactivates a clinic and it leaves my_workspaces() at once';
end $$;

reset role;
set local role anon;
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.public_workspace_by_slug('ops-clinic');
  if v_n <> 0 then
    raise exception 'FAIL: a deactivated clinic still resolved for booking (% rows)', v_n;
  end if;
  raise notice 'PASS: the same deactivation darkens the public booking link (C6)';
end $$;

-- 12c. reactivating restores the member directory
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_n integer;
begin
  update public.workspaces set is_active = true, updated_at = now() where slug = 'ops-clinic';
  select count(*) into v_n from public.my_workspaces() where slug = 'ops-clinic';
  if v_n <> 1 then
    raise exception 'FAIL: reactivation did not restore the clinic to my_workspaces()';
  end if;
  raise notice 'PASS: reactivating restores the clinic to the member directory';
end $$;

-- 12d. §14 "Rotate an anon key": the new publishable key persists, and a privileged
--      key is refused even for an admin by the column CHECK.
do $$
declare v_key text;
begin
  update public.workspaces
     set supabase_anon_key = 'sb_publishable_ops_after', updated_at = now()
   where slug = 'ops-clinic';
  select supabase_anon_key into v_key from public.workspaces where slug = 'ops-clinic';
  if v_key <> 'sb_publishable_ops_after' then
    raise exception 'FAIL: the rotated key did not persist: %', coalesce(v_key, '<null>');
  end if;
  begin
    update public.workspaces set supabase_anon_key = 'sb_secret_ops_leaked' where slug = 'ops-clinic';
    raise exception 'FAIL: a privileged key was accepted into the directory';
  exception when check_violation then
    null;
  end;
  raise notice 'PASS: an admin rotates the publishable key; a sb_secret/service_role key is refused';
end $$;

reset role;
set local role anon;
do $$
declare v_key text;
begin
  select min(supabase_anon_key) into v_key from public.public_workspace_by_slug('ops-clinic');
  if v_key is distinct from 'sb_publishable_ops_after' then
    raise exception 'FAIL: anon booking still serves the pre-rotation key: %', coalesce(v_key, '<null>');
  end if;
  raise notice 'PASS: anon booking serves the rotated key at once, so clients revalidate (C6)';
end $$;

-- 12e. §14 "Revoke a user": the workspace_members row goes, and the revoked person
--      stops seeing the clinic — which is what makes their cached slug fail
--      revalidation on their next boot.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_rows integer;
begin
  delete from public.workspace_members
   where workspace_id = (select id from public.workspaces where slug = 'ops-clinic')
     and user_id = '00000000-0000-0000-0000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: an admin revoke deleted % member rows, expected 1', v_rows;
  end if;
  raise notice 'PASS: an admin revokes a workspace member';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"clinic_user"}}', true);
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.my_workspaces() where slug = 'ops-clinic';
  if v_n <> 0 then
    raise exception 'FAIL: a revoked member still sees the clinic in my_workspaces()';
  end if;
  raise notice 'PASS: the revoked member loses the clinic, so their cached slug fails revalidation';
end $$;

-- 12f. THE FINDING THE OPERATOR UI MUST RESPECT: a non-admin is refused SILENTLY.
--      Both statements succeed and touch 0 rows — there is no exception to catch.
--      A console that treats "no error" as success would report a deactivation or a
--      key rotation that never happened, so every operator write has to check its
--      row count (or re-read the row).
do $$
declare v_rows integer;
begin
  update public.workspaces
     set is_active = false, supabase_anon_key = 'sb_publishable_stolen'
   where slug = 'ops-clinic';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a non-admin updated % workspace rows', v_rows;
  end if;
  delete from public.workspace_members
   where workspace_id = (select id from public.workspaces where slug = 'ops-clinic');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a non-admin deleted % member rows', v_rows;
  end if;
  raise notice 'PASS: a non-admin is refused silently — 0 rows, no exception, on both writes';
end $$;

-- 12g. and the directory really is untouched, re-read as the admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_active boolean; v_key text; v_n integer;
begin
  select is_active, supabase_anon_key into v_active, v_key
    from public.workspaces where slug = 'ops-clinic';
  if v_active is not true then
    raise exception 'FAIL: the refused write actually deactivated the clinic';
  end if;
  if v_key <> 'sb_publishable_ops_after' then
    raise exception 'FAIL: the refused write changed the key to %', coalesce(v_key, '<null>');
  end if;
  select count(*) into v_n from public.workspace_members
   where workspace_id = (select id from public.workspaces where slug = 'ops-clinic');
  if v_n <> 1 then
    raise exception 'FAIL: the refused write left % member rows, expected the 1 admin', v_n;
  end if;
  raise notice 'PASS: the directory is exactly as the admin left it — active, rotated key, one member';
end $$;

-- 12h. The same trap on the BILLING tables the console writes. `invoices_admin_update`
--      is `using (is_license_admin())`, so a non-admin's status change succeeds and
--      changes nothing: the console would show an invoice as void while the database
--      still says paid. The admin's own update returns exactly one row, which is what
--      makes a `.select('id')` read-back plus a row count a reliable signal.
do $$
declare
  v_sub  public.admin_license_view;
  v_inv  uuid;
  v_rows integer;
begin
  create temporary table if not exists ops_billing_fixture (
    subscription_id uuid, license_id uuid, invoice_id uuid
  ) on commit drop;
  delete from ops_billing_fixture;

  v_sub := public.create_subscription_with_license(
    'ops-billing@clinic.in', 'growth', 2, now() + interval '365 days',
    'ops billing probe', null, false
  );

  insert into public.invoices (
    invoice_number, subscription_id, license_id, status, currency,
    line_items, tax_rate, subtotal, tax_amount, total, issued_at, due_at
  ) values (
    'INV-OPS-0001', v_sub.subscription_id, v_sub.license_id, 'issued', 'INR',
    '[{"description":"Growth plan - annual","qty":1,"unit":12000.00}]'::jsonb,
    0.18, 12000.00, 2160.00, 14160.00, now(), now() + interval '30 days'
  ) returning id into v_inv;

  insert into ops_billing_fixture
  values (v_sub.subscription_id, v_sub.license_id, v_inv);

  update public.invoices set status = 'paid', paid_at = now() where id = v_inv;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: the admin invoice update touched % rows, expected 1', v_rows;
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"clinic_user"}}', true);
do $$
declare v_rows integer;
begin
  update public.invoices
     set status = 'void'
   where id = (select invoice_id from ops_billing_fixture);
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a non-admin voided % invoice rows', v_rows;
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_status text;
begin
  select status into v_status
    from public.invoices
   where id = (select invoice_id from ops_billing_fixture);
  if v_status <> 'paid' then
    raise exception 'FAIL: the refused void left the invoice as %', coalesce(v_status, '<null>');
  end if;
  raise notice 'PASS: an invoice status change is silently refused for a non-admin — 0 rows, still paid';
end $$;

-- 12i. The contrast that decides where a row count is load-bearing. An INSERT is
--      refused LOUDLY: `clinic_activity_log_admin_append` is a WITH CHECK policy and
--      a rejected new row raises 42501. Only UPDATE and DELETE hide behind a USING
--      filter, so the silent case is the one an operator surface must count rows for.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"clinic_user"}}', true);
do $$
begin
  insert into public.clinic_activity_log (subscription_id, license_id, event_kind, actor, payload)
  values ((select subscription_id from ops_billing_fixture),
          (select license_id from ops_billing_fixture),
          'onboarded', 'not-admin@ops.in', '{"probe":"12i"}'::jsonb);
  raise exception 'FAIL: a non-admin appended to the audit log';
exception when insufficient_privilege then
  raise notice 'PASS: an audit-log append is refused loudly (42501) where an update is silent';
end $$;

-- =============================================================================
-- 13. SCHEMA v8 — public.workspace_audit_log: §14 operator attribution.
--     The console can deactivate a clinic, rotate its publishable key, revoke it
--     and edit its members. Every one of those is an admin write the database
--     already allowed (v5 RLS), and until v8 not one of them left a trace of WHO
--     did it. These five blocks prove the three properties §10 claims: admin-only
--     append, immutability for everyone, and attribution that outlives a revocation.
--     Fixtures use slugs no other section touches: audit-clinic, audit-gone.
-- =============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);

-- 13a. An admin action is recorded, and the log refuses to hold a secret or an
--      action outside its vocabulary.
do $$
declare v_ws uuid; v_id uuid; v_rows integer;
begin
  insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active, tenant_schema_version)
  values ('Audit Clinic', 'audit-clinic', 'https://audit-clinic.supabase.co', 'sb_publishable_audit_before', true, 22)
  returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, '00000000-0000-0000-0000-000000000003', 'staff');

  insert into public.workspace_audit_log (workspace_id, workspace_slug, action, actor, payload)
  values (v_ws, 'audit-clinic', 'workspace_key_rotated', 'admin@ops.in',
          '{"key_tail":"before","reason":"scheduled rotation"}'::jsonb)
  returning id into v_id;
  if v_id is null then
    raise exception 'FAIL: the audit append returned no id — the row did not land';
  end if;

  begin
    insert into public.workspace_audit_log (workspace_id, workspace_slug, action, actor, payload)
    values (v_ws, 'audit-clinic', 'workspace_key_rotated', 'admin@ops.in',
            '{"key":"sb_publishable_audit_after"}'::jsonb);
    raise exception 'FAIL: the audit log accepted a publishable key literal';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.workspace_audit_log (workspace_id, workspace_slug, action, actor, payload)
    values (v_ws, 'audit-clinic', 'clinic_deleted', 'admin@ops.in', '{}'::jsonb);
    raise exception 'FAIL: the audit log accepted an action outside its vocabulary';
  exception when check_violation then
    null;
  end;

  select count(*) into v_rows from public.workspace_audit_log where workspace_slug = 'audit-clinic';
  if v_rows <> 1 then
    raise exception 'FAIL: expected exactly 1 audit row for audit-clinic, got %', v_rows;
  end if;
  raise notice 'PASS: an admin action is recorded; a key literal and an unknown action are both refused';
end $$;

-- 13b. A non-admin cannot write history: the WITH CHECK policy refuses loudly.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"clinic_user"}}', true);
do $$
begin
  insert into public.workspace_audit_log (workspace_id, workspace_slug, action, actor, payload)
  values ((select id from public.workspaces where slug = 'audit-clinic'),
          'audit-clinic', 'workspace_revoked', 'staff@clinic.in', '{}'::jsonb);
  raise exception 'FAIL: a non-admin wrote to the audit log';
exception when insufficient_privilege then
  raise notice 'PASS: a non-admin cannot write history — the append policy is admin-only (42501)';
end $$;

-- 13c. Append-only for EVERYONE: no update/delete grant, so not even an admin can
--      rewrite or tidy the record after the fact.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_rows integer;
begin
  begin
    update public.workspace_audit_log set action = 'member_added' where workspace_slug = 'audit-clinic';
    raise exception 'FAIL: an admin rewrote an audit row';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.workspace_audit_log where workspace_slug = 'audit-clinic';
    raise exception 'FAIL: an admin deleted an audit row';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into v_rows from public.workspace_audit_log where workspace_slug = 'audit-clinic';
  if v_rows <> 1 then
    raise exception 'FAIL: history changed under an admin: % rows', v_rows;
  end if;
  raise notice 'PASS: the audit log is append-only — not even an admin can rewrite or delete history';
end $$;

-- 13d. Read scoping: a member sees only their own clinic trail, an admin sees all.
do $$
declare v_ws uuid;
begin
  insert into public.workspaces (clinic_name, slug, supabase_url, supabase_anon_key, is_active, tenant_schema_version)
  values ('Audit Gone Clinic', 'audit-gone', 'https://audit-gone.supabase.co', 'sb_publishable_gone', true, 22)
  returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, '00000000-0000-0000-0000-000000000004', 'doctor');
  insert into public.workspace_audit_log (workspace_id, workspace_slug, action, actor, payload)
  values (v_ws, 'audit-gone', 'workspace_deactivated', 'admin@ops.in', '{"reason":"subscription lapse"}'::jsonb);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"clinic_user"}}', true);
do $$
declare v_mine integer; v_other integer;
begin
  select count(*) into v_mine  from public.workspace_audit_log where workspace_slug = 'audit-clinic';
  select count(*) into v_other from public.workspace_audit_log where workspace_slug = 'audit-gone';
  if v_mine <> 1 or v_other <> 0 then
    raise exception 'FAIL: a member saw % own and % foreign audit rows (expected 1 and 0)', v_mine, v_other;
  end if;
  raise notice 'PASS: a member reads only their own clinic audit trail; another clinic is invisible';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}', true);
do $$
declare v_all integer;
begin
  select count(*) into v_all from public.workspace_audit_log;
  if v_all <> 2 then
    raise exception 'FAIL: an admin saw % audit rows, expected 2 across both clinics', v_all;
  end if;
  raise notice 'PASS: an admin reads the whole trail — 2 rows across 2 clinics';
end $$;

-- 13e. The property that decides the FK: revoking a clinic DELETES its directory
--      row, so a cascading log would erase the record of the revocation itself.
do $$
declare v_ws uuid; v_rows integer; v_orphan integer; v_members integer;
begin
  select id into v_ws from public.workspaces where slug = 'audit-gone';
  delete from public.workspaces where id = v_ws;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: revoke deleted % directory rows, expected 1', v_rows;
  end if;
  select count(*) into v_orphan
    from public.workspace_audit_log
   where workspace_slug = 'audit-gone' and workspace_id is null;
  if v_orphan <> 1 then
    raise exception 'FAIL: the revocation lost its attribution (% rows kept)', v_orphan;
  end if;
  select count(*) into v_members from public.workspace_members where workspace_id = v_ws;
  if v_members <> 0 then
    raise exception 'FAIL: revoking left % member rows behind', v_members;
  end if;
  raise notice 'PASS: revoking a clinic keeps the attribution — the audit row outlives the deleted directory row';
end $$;

reset role;

rollback;
