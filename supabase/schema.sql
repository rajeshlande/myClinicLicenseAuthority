-- =============================================================================
-- myClinic License Authority — Single Source-of-Truth Database Schema (v2)
--
--   ██  THIS IS THE ONLY SQL FILE CENTRAL SUPABASE NEEDS.
--   ██  NO EDGE FUNCTIONS OR RSA KEYS REQUIRED FOR KEYLESS AUTO-SYNC.
--
--   Run it whole, top to bottom, in Central Supabase → SQL Editor.
--   Or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--
-- Idempotent and additive: safe to re-run on a blank project OR a live v1 project.
-- Never drops a table or deletes subscription, license, or hardware-lock rows.
--
-- ── Contents ─────────────────────────────────────────────────────────────────
--   §0  version + migration registry     public.app_meta, public.schema_migrations
--   §1  helpers + admin predicate        normalize_clinic_origin(), is_license_admin()
--   §2  core entitlement tables          subscriptions (email + URL), licenses,
--                                        activated_machines, sync_rate_limits
--   §3  hardware lock + secure view      enforce_max_machines_limit(), admin_license_view
--   §4  admin & keyless auto-sync RPCs   create_subscription_with_license(),
--                                        update_subscription_routing(),
--                                        revoke_machine_node(),
--                                        sync_clinic_subscription()
--   §5  zero-trust row-level security    FORCE RLS; anon has ZERO table access
--                                        and can ONLY execute sync_clinic_subscription()
-- =============================================================================

begin;

create extension if not exists "pgcrypto";

-- =============================================================================
-- §0 · VERSION + MIGRATION REGISTRY
-- =============================================================================
create table if not exists public.app_meta (
  id boolean primary key default true check (id),
  schema_version integer not null,
  applied_at timestamptz not null default now(),
  notes text not null default ''
);

create table if not exists public.schema_migrations (
  version integer primary key,
  name text not null,
  applied_at timestamptz not null default now(),
  app_version text not null default '',
  summary text not null default ''
);

insert into public.app_meta (schema_version, notes)
select 2, 'central subscription & keyless auto-sync authority schema'
where not exists (select 1 from public.app_meta);

insert into public.schema_migrations (version, name, app_version, summary) values
  (1, 'license-authority-core', '1.0.0', 'subscriptions, licenses, activated_machines hardware lock, admin_license_view, transactional provisioning RPC, admin RLS'),
  (2, 'keyless-auto-sync-core', '1.6.0', 'email + clinic URL dual routing, TOFU origin lock, per-IP SHA-256 rate limiter, hardened sync_clinic_subscription RPC, FORCE RLS')
on conflict (version) do nothing;

update public.app_meta
   set schema_version = greatest(schema_version, 2),
       applied_at = now(),
       notes = 'keyless auto-sync + dual email/origin routing enabled';

create or replace function public.app_schema_version()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select schema_version from public.app_meta limit 1;
$$;

create or replace function public.app_migrations()
returns table (version integer, name text, app_version text, applied_at timestamptz, summary text)
language sql
stable
security invoker
set search_path = public
as $$
  select version, name, app_version, applied_at, summary
  from public.schema_migrations
  order by version desc;
$$;

-- =============================================================================
-- §1 · HELPERS & ZERO-TRUST ADMIN AUTHORIZATION PREDICATE
-- =============================================================================
create or replace function public.generate_license_hex()
returns text
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
begin
  return upper(encode(gen_random_bytes(16), 'hex'));
end;
$$;

create or replace function public.normalize_clinic_origin(p_raw text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_raw, '')), '') is null then null
    when lower(btrim(p_raw)) ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?([/?#].*)?$' then
      substring(lower(btrim(p_raw)) from '^(https?://[a-z0-9.-]+(:[0-9]{1,5})?)')
    else
      lower(regexp_replace(btrim(p_raw), '/+$', ''))
  end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Checks immutable `app_metadata.role = 'admin'` on the Supabase Auth JWT.
-- End-users can mutate `user_metadata`, NEVER `app_metadata`.
-- Grant an operator admin standing in Central Supabase SQL Editor:
--   update auth.users
--   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--   where email = 'ops@yourdomain.com';
create or replace function public.is_license_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- =============================================================================
-- §2 · CORE ENTITLEMENT TABLES + INTERNAL RATE LIMITER
-- =============================================================================

-- 1. `subscriptions` (supports Email, Clinic URL, or BOTH Email + Clinic URL)
create table if not exists public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  customer_email    text,
  allowed_origin    text,
  lock_first_origin boolean not null default false,
  status            text not null default 'active'
                    check (status in ('active', 'suspended', 'expired')),
  tier              text not null default 'standard'
                    check (tier in ('standard', 'solo', 'growth', 'chain', 'enterprise')),
  max_machines      integer not null default 1
                    check (max_machines >= 1 and max_machines <= 10000),
  expires_at        timestamptz not null,
  notes             text not null default ''
                    check (char_length(notes) <= 4000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Additive migration path for existing Schema v1 databases:
alter table public.subscriptions alter column customer_email drop not null;
alter table public.subscriptions add column if not exists allowed_origin text;
alter table public.subscriptions add column if not exists lock_first_origin boolean not null default false;

alter table public.subscriptions drop constraint if exists subscriptions_customer_email_check;
alter table public.subscriptions drop constraint if exists subscriptions_customer_email_valid;
alter table public.subscriptions add constraint subscriptions_customer_email_valid
  check (
    customer_email is null
    or (char_length(customer_email) <= 254 and customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  );

alter table public.subscriptions drop constraint if exists subscriptions_allowed_origin_valid;
alter table public.subscriptions add constraint subscriptions_allowed_origin_valid
  check (
    allowed_origin is null
    or (char_length(allowed_origin) <= 255 and allowed_origin ~* '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$')
  );

alter table public.subscriptions drop constraint if exists subscriptions_identity_required;
alter table public.subscriptions add constraint subscriptions_identity_required
  check (
    nullif(btrim(coalesce(customer_email, '')), '') is not null
    or nullif(btrim(coalesce(allowed_origin, '')), '') is not null
  );

create index if not exists idx_subscriptions_customer_email
  on public.subscriptions (lower(customer_email))
  where customer_email is not null;

create index if not exists idx_subscriptions_allowed_origin
  on public.subscriptions (lower(allowed_origin))
  where allowed_origin is not null;

create index if not exists idx_subscriptions_status_expires
  on public.subscriptions (status, expires_at);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- 2. `licenses` (retained for instant kill-switch + backwards compatibility)
create table if not exists public.licenses (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
                  references public.subscriptions(id) on delete cascade,
  license_key     text not null unique
                  default public.generate_license_hex()
                  check (char_length(btrim(license_key)) between 16 and 128),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_licenses_subscription_id
  on public.licenses (subscription_id);

-- Touch parent `subscriptions.updated_at` whenever `licenses.is_active` (Pause / Resume)
-- flips so Central immediately knows a state change is pending client sync.
create or replace function public.touch_parent_subscription_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_active is distinct from new.is_active then
    update public.subscriptions
       set updated_at = now()
     where id = new.subscription_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_licenses_touch_subscription on public.licenses;
create trigger trg_licenses_touch_subscription
  after update on public.licenses
  for each row execute function public.touch_parent_subscription_updated_at();

-- 3. `activated_machines` (Domain / Device Seat Lock + Client Sync Delivery Telemetry)
create table if not exists public.activated_machines (
  id                     uuid primary key default gen_random_uuid(),
  license_id             uuid not null
                         references public.licenses(id) on delete cascade,
  machine_fingerprint    text not null
                         check (char_length(btrim(machine_fingerprint)) between 1 and 512),
  activated_at           timestamptz not null default now(),
  last_heartbeat         timestamptz not null default now(),
  last_synced_tier       text,
  last_synced_status     text,
  last_synced_expires_at timestamptz,
  constraint activated_machines_license_fingerprint_unique
    unique (license_id, machine_fingerprint)
);

-- Additive client sync delivery columns for existing Schema v1 / v2 databases:
alter table public.activated_machines add column if not exists last_synced_tier text;
alter table public.activated_machines add column if not exists last_synced_status text;
alter table public.activated_machines add column if not exists last_synced_expires_at timestamptz;

create index if not exists idx_activated_machines_license_id
  on public.activated_machines (license_id);

-- 4. `sync_rate_limits` (Internal anti-enumeration & anti-flood buckets; zero external access)
create table if not exists public.sync_rate_limits (
  bucket_key        text primary key check (char_length(bucket_key) <= 128),
  window_started_at timestamptz not null default now(),
  hit_count         integer not null default 1 check (hit_count >= 0)
);

create index if not exists idx_sync_rate_limits_window
  on public.sync_rate_limits (window_started_at);

-- =============================================================================
-- §3 · CONCURRENCY-SAFE HARDWARE LOCK & SECURE FLATTENED VIEW
-- =============================================================================

-- Row-locks the parent `licenses` record (`FOR UPDATE OF l`) before counting
-- existing machines so concurrent clinic startups cannot exceed `max_machines`.
create or replace function public.enforce_max_machines_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_machines integer;
  v_current_count integer;
begin
  select s.max_machines
    into v_max_machines
    from public.licenses l
    join public.subscriptions s on s.id = l.subscription_id
   where l.id = new.license_id
     for update of l;

  if v_max_machines is null then
    raise exception 'license % does not reference a valid subscription', new.license_id
      using errcode = '23503';
  end if;

  select count(*)::integer
    into v_current_count
    from public.activated_machines am
   where am.license_id = new.license_id;

  if v_current_count >= v_max_machines then
    raise exception 'hardware limit reached (% / % machines activated)', v_current_count, v_max_machines
      using errcode = '53400';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_max_machines_limit on public.activated_machines;
create trigger trg_enforce_max_machines_limit
  before insert on public.activated_machines
  for each row execute function public.enforce_max_machines_limit();

-- Flattened view (`security_invoker = true`) so `.from('admin_license_view').select('*')`
-- retrieves complete operational standing in one round trip while respecting RLS.
-- Note: v2 columns (`allowed_origin`, `lock_first_origin`) are appended at the end so
-- `CREATE OR REPLACE VIEW` upgrades live v1 installations cleanly in place.
create or replace view public.admin_license_view
with (security_invoker = true)
as
select
  l.id as license_id,
  s.id as subscription_id,
  s.customer_email,
  l.license_key,
  l.is_active,
  s.status,
  s.tier,
  s.max_machines,
  (
    select count(*)::integer
    from public.activated_machines am
    where am.license_id = l.id
  ) as registered_machines,
  (
    select max(am.last_heartbeat)
    from public.activated_machines am
    where am.license_id = l.id
  ) as last_heartbeat,
  s.expires_at,
  s.notes,
  s.created_at,
  s.updated_at,
  s.allowed_origin,
  s.lock_first_origin,
  (
    select am.last_synced_tier
    from public.activated_machines am
    where am.license_id = l.id
    order by am.last_heartbeat desc nulls last
    limit 1
  ) as last_synced_tier,
  (
    select am.last_synced_status
    from public.activated_machines am
    where am.license_id = l.id
    order by am.last_heartbeat desc nulls last
    limit 1
  ) as last_synced_status,
  (
    select am.last_synced_expires_at
    from public.activated_machines am
    where am.license_id = l.id
    order by am.last_heartbeat desc nulls last
    limit 1
  ) as last_synced_expires_at
from public.licenses l
join public.subscriptions s
  on s.id = l.subscription_id;

-- =============================================================================
-- §4 · ADMIN PROVISIONING, ROUTING & KEYLESS AUTO-SYNC RPCs
-- =============================================================================

-- Drop legacy 5-arg signature so the 7-arg signature with defaults handles both
-- 5-arg and 7-arg callers without overload ambiguity.
drop function if exists public.create_subscription_with_license(text, text, integer, timestamptz, text);

create or replace function public.create_subscription_with_license(
  p_customer_email    text default null,
  p_tier              text default 'standard',
  p_max_machines      integer default 1,
  p_expires_at        timestamptz default (now() + interval '1 year'),
  p_notes             text default '',
  p_allowed_origin    text default null,
  p_lock_first_origin boolean default false
)
returns public.admin_license_view
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email           text;
  v_origin          text;
  v_subscription_id uuid;
  v_license_id      uuid;
  v_result          public.admin_license_view;
begin
  if not public.is_license_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'administrator privileges required'
      using errcode = '42501';
  end if;

  v_email := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  v_origin := public.normalize_clinic_origin(p_allowed_origin);

  if v_email is null and v_origin is null then
    raise exception 'Provide at least a clinic owner email or a clinic URL (https://...)'
      using errcode = '22023';
  end if;

  insert into public.subscriptions (
    customer_email,
    allowed_origin,
    lock_first_origin,
    status,
    tier,
    max_machines,
    expires_at,
    notes
  )
  values (
    v_email,
    v_origin,
    coalesce(p_lock_first_origin, false),
    'active',
    coalesce(nullif(btrim(p_tier), ''), 'standard'),
    p_max_machines,
    p_expires_at,
    coalesce(p_notes, '')
  )
  returning id into v_subscription_id;

  insert into public.licenses (
    subscription_id,
    is_active
  )
  values (
    v_subscription_id,
    true
  )
  returning id into v_license_id;

  select *
    into v_result
    from public.admin_license_view
   where license_id = v_license_id;

  return v_result;
end;
$$;

create or replace function public.update_subscription_routing(
  p_subscription_id   uuid,
  p_customer_email    text default null,
  p_allowed_origin    text default null,
  p_lock_first_origin boolean default false
)
returns public.admin_license_view
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email  text;
  v_origin text;
  v_result public.admin_license_view;
begin
  if not public.is_license_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'administrator privileges required'
      using errcode = '42501';
  end if;

  v_email := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  v_origin := public.normalize_clinic_origin(p_allowed_origin);

  if v_email is null and v_origin is null then
    raise exception 'Provide at least a clinic owner email or a clinic URL (https://...)'
      using errcode = '22023';
  end if;

  update public.subscriptions
     set customer_email    = v_email,
         allowed_origin    = v_origin,
         lock_first_origin = coalesce(p_lock_first_origin, false)
   where id = p_subscription_id;

  if not found then
    raise exception 'subscription % not found', p_subscription_id
      using errcode = 'P0002';
  end if;

  select *
    into v_result
    from public.admin_license_view
   where subscription_id = p_subscription_id
   limit 1;

  return v_result;
end;
$$;

create or replace function public.revoke_machine_node(p_machine_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.is_license_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'administrator privileges required'
      using errcode = '42501';
  end if;

  delete from public.activated_machines
   where id = p_machine_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- Internal helper for SHA-256 hashed rate-limit buckets (never directly callable by clients)
create or replace function public.consume_sync_rate_limit(
  p_bucket        text,
  p_window_secs   integer,
  p_max_hits      integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_now   timestamptz := now();
  v_count integer;
begin
  -- Opportunistically prune stale rate-limit buckets older than 1 hour (~2% of calls)
  if random() < 0.02 then
    delete from public.sync_rate_limits
     where window_started_at < (v_now - interval '1 hour');
  end if;

  insert into public.sync_rate_limits (bucket_key, window_started_at, hit_count)
  values (p_bucket, v_now, 1)
  on conflict (bucket_key) do update
     set hit_count = case
           when public.sync_rate_limits.window_started_at <= (v_now - make_interval(secs => p_window_secs))
             then 1
           else public.sync_rate_limits.hit_count + 1
         end,
         window_started_at = case
           when public.sync_rate_limits.window_started_at <= (v_now - make_interval(secs => p_window_secs))
             then v_now
           else public.sync_rate_limits.window_started_at
         end
  returning hit_count into v_count;

  return v_count <= p_max_hits;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC CLIENT AUTO-SYNC RPC (`sync_clinic_subscription`)
--
-- The ONLY object in Central Supabase callable by `anon` (`VITE_CENTRAL_SUPABASE_ANON_KEY`).
-- Security invariants enforced inside this function:
--   1. Fixed `search_path = public, extensions` + zero dynamic SQL.
--   2. Strict length & format validation on `p_email`, `p_origin`, `p_device_id`.
--   3. Unforgeable browser HTTP `Origin` header check via PostgREST `request.headers`
--      (blocks cross-origin spoofing from unauthorized websites).
--   4. Per-IP SHA-256 hashed rate limiting (60 calls/min + 15 misses/5min; raw IPs never stored).
--   5. Supports 3 routing modes: Dual (`email+url`), `email`, and `url`, plus optional TOFU lock.
--   6. Deterministic `web:<origin>` seat fingerprint for cloud clinics (prevents curl seat DoS)
--      and 5-minute heartbeat write throttling (prevents DB write amplification).
--   7. Returns ONLY minimal plan capability JSON — zero customer PII, notes, or other rows.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_clinic_subscription(
  p_email     text default '',
  p_origin    text default '',
  p_device_id text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_now            timestamptz := now();
  v_email          text;
  v_origin         text;
  v_device         text;
  v_headers        jsonb := '{}'::jsonb;
  v_header_origin  text;
  v_raw_ip         text;
  v_ip_hash        text;
  v_is_admin       boolean := public.is_license_admin();
  v_is_preview     boolean := false;
  v_is_local       boolean := false;
  v_fingerprint    text;
  v_match_mode     text;
  v_plan           text;
  v_doctors        integer;
  v_frontdesk      integer;
  v_branches       integer;
  v_grace_until    timestamptz;
  v_sub            record;
  v_machine        record;
begin
  v_email  := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_origin := public.normalize_clinic_origin(p_origin);
  v_device := left(regexp_replace(btrim(coalesce(p_device_id, '')), '[^a-zA-Z0-9._:-]', '', 'g'), 96);

  -- Safe zero-side-effect readiness check used by Guide & Settings diagnostics
  if v_email is null and v_origin is null and v_device = 'healthcheck' then
    return jsonb_build_object(
      'ok', true,
      'sync_ready', true,
      'schema_version', 2,
      'server_time', v_now
    );
  end if;

  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object(
      'allowed', false,
      'status', 'invalid_request',
      'code', 'INVALID_EMAIL',
      'tier', 'solo',
      'reason', 'Invalid clinic email format.'
    );
  end if;

  if v_origin is not null and (char_length(v_origin) > 255 or v_origin !~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$') then
    return jsonb_build_object(
      'allowed', false,
      'status', 'invalid_request',
      'code', 'INVALID_ORIGIN',
      'tier', 'solo',
      'reason', 'Clinic URL must be scheme + domain (for example https://clinic.github.io).'
    );
  end if;

  -- Extract PostgREST HTTP request headers safely
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_header_origin := public.normalize_clinic_origin(v_headers ->> 'origin');
  if v_header_origin = 'null' then
    v_header_origin := null;
  end if;

  v_is_preview := v_is_admin and v_device = 'admin-preview';

  -- Enforce browser HTTP Origin header integrity for all non-admin-preview calls
  if not v_is_preview and v_header_origin is not null then
    if v_origin is null then
      v_origin := v_header_origin;
    elsif v_origin <> v_header_origin then
      return jsonb_build_object(
        'allowed', false,
        'status', 'origin_mismatch',
        'code', 'ORIGIN_MISMATCH',
        'tier', 'solo',
        'reason', 'Browser Origin header does not match the claimed clinic URL.'
      );
    end if;
  end if;

  if v_email is null and v_origin is null then
    return jsonb_build_object(
      'allowed', false,
      'status', 'unlicensed',
      'code', 'MISSING_IDENTITY',
      'tier', 'solo',
      'reason', 'Provide clinic owner email or clinic URL.'
    );
  end if;

  -- Privacy-preserving SHA-256 IP rate limiting (60 calls/min + 15 misses/5min)
  v_raw_ip := coalesce(
    nullif(btrim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'direct'
  );
  v_ip_hash := encode(digest('myclinic-sync-v2:' || v_raw_ip, 'sha256'), 'hex');

  if not public.consume_sync_rate_limit('req:' || left(v_ip_hash, 40), 60, 60) then
    return jsonb_build_object(
      'allowed', false,
      'status', 'rate_limited',
      'code', 'RATE_LIMITED',
      'tier', 'solo',
      'reason', 'Too many sync requests from this network. Please retry in a minute.'
    );
  end if;

  -- Check if caller IP has already exhausted the failed-lookup budget (anti-enumeration)
  if exists (
    select 1
      from public.sync_rate_limits
     where bucket_key = ('miss:' || left(v_ip_hash, 40))
       and window_started_at > (v_now - interval '5 minutes')
       and hit_count >= 15
  ) then
    return jsonb_build_object(
      'allowed', false,
      'status', 'rate_limited',
      'code', 'RATE_LIMITED',
      'tier', 'solo',
      'reason', 'Too many unmatched lookup attempts. Please wait 5 minutes.'
    );
  end if;

  -- Match subscription using strict 3-tier priority:
  --   1) Dual-pinned (both email AND URL configured on row -> BOTH must match)
  --   2) Email-configured (URL not pinned on row -> email must match)
  --   3) URL-only configured (email blank on row -> URL must match)
  select
    s.id as subscription_id,
    s.customer_email,
    s.allowed_origin,
    s.lock_first_origin,
    s.status,
    s.tier,
    s.max_machines,
    s.expires_at,
    s.updated_at,
    l.id as license_id,
    l.is_active,
    case
      when s.customer_email is not null and s.allowed_origin is not null then 'email+url'
      when s.customer_email is not null then 'email'
      else 'url'
    end as matched_by
  into v_sub
  from public.subscriptions s
  join public.licenses l
    on l.subscription_id = s.id
  where (
    (
      s.customer_email is not null
      and s.allowed_origin is not null
      and v_email is not null
      and v_origin is not null
      and lower(s.customer_email) = v_email
      and lower(s.allowed_origin) = v_origin
    )
    or (
      s.customer_email is not null
      and s.allowed_origin is null
      and v_email is not null
      and lower(s.customer_email) = v_email
    )
    or (
      s.customer_email is null
      and s.allowed_origin is not null
      and v_origin is not null
      and lower(s.allowed_origin) = v_origin
    )
  )
  order by
    case
      when s.customer_email is not null and s.allowed_origin is not null then 1
      when s.customer_email is not null then 2
      else 3
    end asc,
    (l.is_active and s.status = 'active') desc,
    s.expires_at desc,
    s.created_at desc
  limit 1;

  if not found then
    perform public.consume_sync_rate_limit('miss:' || left(v_ip_hash, 40), 300, 15);
    return jsonb_build_object(
      'allowed', false,
      'status', 'unlicensed',
      'code', 'SUBSCRIPTION_NOT_FOUND',
      'tier', 'solo',
      'reason', 'No active subscription matched this clinic email / URL.'
    );
  end if;

  v_is_local := v_origin is null
    or v_origin ~ '^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)';

  if not v_is_local and v_origin is not null then
    -- Cloud origins bind deterministically to `web:<origin>` so external curl callers
    -- can never pre-empt or exhaust seats with random device IDs.
    v_fingerprint := 'web:' || v_origin;
  else
    v_fingerprint := 'device:' || coalesce(v_origin, 'local') || '|' || coalesce(nullif(v_device, ''), 'default');
  end if;

  if not v_sub.is_active then
    if not v_is_preview then
      update public.activated_machines
         set last_heartbeat = v_now,
             last_synced_tier = 'solo',
             last_synced_status = 'paused',
             last_synced_expires_at = v_sub.expires_at
       where license_id = v_sub.license_id
         and machine_fingerprint = v_fingerprint
         and (
           last_synced_status is distinct from 'paused'
           or last_heartbeat < v_sub.updated_at
           or last_heartbeat < (v_now - interval '5 minutes')
         );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'status', 'paused',
      'code', 'SUBSCRIPTION_PAUSED',
      'tier', 'solo',
      'expires_at', v_sub.expires_at,
      'server_time', v_now,
      'reason', 'Subscription is paused by the administrator.'
    );
  end if;

  if v_now >= v_sub.expires_at then
    if v_sub.status = 'active' then
      update public.subscriptions
         set status = 'expired'
       where id = v_sub.subscription_id
         and status = 'active';
    end if;

    if not v_is_preview then
      update public.activated_machines
         set last_heartbeat = v_now,
             last_synced_tier = 'solo',
             last_synced_status = 'expired',
             last_synced_expires_at = v_sub.expires_at
       where license_id = v_sub.license_id
         and machine_fingerprint = v_fingerprint
         and (
           last_synced_status is distinct from 'expired'
           or last_heartbeat < (v_now - interval '5 minutes')
         );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'status', 'expired',
      'code', 'SUBSCRIPTION_EXPIRED',
      'tier', 'solo',
      'expires_at', v_sub.expires_at,
      'server_time', v_now,
      'reason', 'Subscription expired. Please contact admin to renew.'
    );
  end if;

  if v_sub.status <> 'active' then
    if not v_is_preview then
      update public.activated_machines
         set last_heartbeat = v_now,
             last_synced_tier = 'solo',
             last_synced_status = v_sub.status,
             last_synced_expires_at = v_sub.expires_at
       where license_id = v_sub.license_id
         and machine_fingerprint = v_fingerprint
         and (
           last_synced_status is distinct from v_sub.status
           or last_heartbeat < v_sub.updated_at
           or last_heartbeat < (v_now - interval '5 minutes')
         );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'status', v_sub.status,
      'code', 'SUBSCRIPTION_INACTIVE',
      'tier', 'solo',
      'expires_at', v_sub.expires_at,
      'server_time', v_now,
      'reason', 'Subscription status is ' || v_sub.status || '.'
    );
  end if;

  v_match_mode := v_sub.matched_by;

  -- Optional TOFU ("Trust On First Use") cloud URL lock when enabled on an email-matched row
  if not v_is_preview
     and v_sub.allowed_origin is null
     and v_sub.lock_first_origin
     and v_origin is not null
     and not v_is_local
  then
    update public.subscriptions
       set allowed_origin = v_origin
     where id = v_sub.subscription_id
       and allowed_origin is null;
    v_match_mode := 'email+url';
  end if;

  -- Register or heartbeat deployment seat + record exact delivered plan/status receipt
  if not v_is_preview then
    select id, last_heartbeat, last_synced_tier, last_synced_status, last_synced_expires_at
      into v_machine
      from public.activated_machines
     where license_id = v_sub.license_id
       and machine_fingerprint = v_fingerprint
     limit 1;

    if found then
      -- Write immediately when Central plan/term/standing changed since last client sync,
      -- otherwise throttle steady-state heartbeats to once every 5 minutes per seat.
      if v_machine.last_heartbeat < (v_now - interval '5 minutes')
         or v_machine.last_heartbeat < v_sub.updated_at
         or v_machine.last_synced_tier is distinct from v_sub.tier
         or v_machine.last_synced_status is distinct from 'active'
         or v_machine.last_synced_expires_at is distinct from v_sub.expires_at
      then
        update public.activated_machines
           set last_heartbeat = v_now,
               last_synced_tier = v_sub.tier,
               last_synced_status = 'active',
               last_synced_expires_at = v_sub.expires_at
         where id = v_machine.id;
      end if;
    else
      begin
        insert into public.activated_machines (
          license_id,
          machine_fingerprint,
          activated_at,
          last_heartbeat,
          last_synced_tier,
          last_synced_status,
          last_synced_expires_at
        )
        values (
          v_sub.license_id,
          v_fingerprint,
          v_now,
          v_now,
          v_sub.tier,
          'active',
          v_sub.expires_at
        )
        on conflict (license_id, machine_fingerprint)
        do update set
          last_heartbeat = excluded.last_heartbeat,
          last_synced_tier = excluded.last_synced_tier,
          last_synced_status = excluded.last_synced_status,
          last_synced_expires_at = excluded.last_synced_expires_at;
      exception
        when sqlstate '53400' then
          return jsonb_build_object(
            'allowed', false,
            'status', 'seat_limit',
            'code', 'SEAT_LIMIT_REACHED',
            'tier', 'solo',
            'max_machines', v_sub.max_machines,
            'reason', 'Maximum clinic deployments reached for this subscription.'
          );
      end;
    end if;
  end if;

  -- Map central tier to myClinic capabilities
  case v_sub.tier
    when 'solo' then
      v_plan := 'solo';   v_doctors := 1;    v_frontdesk := 1;    v_branches := 1;
    when 'standard' then
      v_plan := 'growth'; v_doctors := 5;    v_frontdesk := 3;    v_branches := 1;
    when 'growth' then
      v_plan := 'growth'; v_doctors := 5;    v_frontdesk := 3;    v_branches := 1;
    else
      v_plan := 'chain';  v_doctors := null; v_frontdesk := null; v_branches := null;
  end case;

  v_grace_until := least(v_sub.expires_at, v_now + interval '7 days');

  return jsonb_build_object(
    'allowed', true,
    'status', 'active',
    'code', 'ACTIVE',
    'tier', v_sub.tier,
    'plan', v_plan,
    'doctors', v_doctors,
    'frontdesk', v_frontdesk,
    'branches', v_branches,
    'max_machines', v_sub.max_machines,
    'expires_at', v_sub.expires_at,
    'grace_until', v_grace_until,
    'match_mode', v_match_mode,
    'server_time', v_now
  );
end;
$$;

-- =============================================================================
-- §5 · ZERO-TRUST ROW-LEVEL SECURITY (FORCE RLS + MINIMAL RPC SURFACE)
-- =============================================================================
alter table public.app_meta enable row level security;
alter table public.schema_migrations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.licenses enable row level security;
alter table public.activated_machines enable row level security;
alter table public.sync_rate_limits enable row level security;

alter table public.app_meta force row level security;
alter table public.schema_migrations force row level security;
alter table public.subscriptions force row level security;
alter table public.licenses force row level security;
alter table public.activated_machines force row level security;
alter table public.sync_rate_limits force row level security;

-- Revoke ALL table, view, and function privileges from `public` and `anon` first
revoke all on public.app_meta from public, anon;
revoke all on public.schema_migrations from public, anon;
revoke all on public.subscriptions from public, anon;
revoke all on public.licenses from public, anon;
revoke all on public.activated_machines from public, anon;
revoke all on public.sync_rate_limits from public, anon, authenticated;
revoke all on public.admin_license_view from public, anon;

revoke all on function public.app_schema_version() from public, anon;
revoke all on function public.app_migrations() from public, anon;
revoke all on function public.generate_license_hex() from public, anon;
revoke all on function public.touch_parent_subscription_updated_at() from public, anon;
revoke all on function public.normalize_clinic_origin(text) from public, anon;
revoke all on function public.is_license_admin() from public, anon;
revoke all on function public.create_subscription_with_license(text, text, integer, timestamptz, text, text, boolean) from public, anon;
revoke all on function public.update_subscription_routing(uuid, text, text, boolean) from public, anon;
revoke all on function public.revoke_machine_node(uuid) from public, anon;
revoke all on function public.consume_sync_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.sync_clinic_subscription(text, text, text) from public;

-- Authenticated Central Admin grants (still gated by `is_license_admin()` RLS & checks)
grant select on public.app_meta to authenticated;
grant select on public.schema_migrations to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.licenses to authenticated;
grant select, insert, update, delete on public.activated_machines to authenticated;
grant select on public.admin_license_view to authenticated;

grant execute on function public.app_schema_version() to authenticated;
grant execute on function public.app_migrations() to authenticated;
grant execute on function public.normalize_clinic_origin(text) to authenticated;
grant execute on function public.is_license_admin() to authenticated;
grant execute on function public.create_subscription_with_license(text, text, integer, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.update_subscription_routing(uuid, text, text, boolean) to authenticated;
grant execute on function public.revoke_machine_node(uuid) to authenticated;

-- ONLY `sync_clinic_subscription` is callable by client apps (`anon` + `authenticated`)
grant execute on function public.sync_clinic_subscription(text, text, text) to anon, authenticated;

drop policy if exists app_meta_admin_read on public.app_meta;
create policy app_meta_admin_read
  on public.app_meta for select to authenticated
  using (public.is_license_admin());

drop policy if exists schema_migrations_admin_read on public.schema_migrations;
create policy schema_migrations_admin_read
  on public.schema_migrations for select to authenticated
  using (public.is_license_admin());

drop policy if exists admin_all_subscriptions on public.subscriptions;
create policy admin_all_subscriptions
  on public.subscriptions for all to authenticated
  using (public.is_license_admin())
  with check (public.is_license_admin());

drop policy if exists admin_all_licenses on public.licenses;
create policy admin_all_licenses
  on public.licenses for all to authenticated
  using (public.is_license_admin())
  with check (public.is_license_admin());

drop policy if exists admin_all_activated_machines on public.activated_machines;
create policy admin_all_activated_machines
  on public.activated_machines for all to authenticated
  using (public.is_license_admin())
  with check (public.is_license_admin());

commit;
