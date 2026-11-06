-- =============================================================================
-- myClinic License Authority — Single Source-of-Truth Database Schema
--
--   ██  THIS IS THE ONLY SQL FILE THE AUTHORITY NEEDS.
--
--   Run it whole, top to bottom, in Supabase → SQL Editor.
--   Or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
--
-- Idempotent and additive: safe to re-run on a blank project or a live one.
-- Never drops a table or deletes subscription, license, or hardware-lock rows.
--
-- ── Contents ─────────────────────────────────────────────────────────────────
--   §0  version + migration registry     public.app_meta, public.schema_migrations
--   §1  helpers + admin predicate        generate_license_hex(), is_license_admin()
--   §2  core entitlement tables          subscriptions, licenses, activated_machines
--   §3  hardware lock + secure view      enforce_max_machines_limit(), admin_license_view
--   §4  transactional RPCs               create_subscription_with_license(), revoke_machine_node()
--   §5  zero-trust row-level security    strict admin-only RLS; anon has zero table access
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
select 1, 'initial central license authority schema'
where not exists (select 1 from public.app_meta);

insert into public.schema_migrations (version, name, app_version, summary) values
  (1, 'license-authority-core', '1.0.0', 'subscriptions, licenses, activated_machines hardware lock, admin_license_view, transactional provisioning RPC, admin RLS')
on conflict (version) do nothing;

update public.app_meta set schema_version = greatest(schema_version, 1), applied_at = now();

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

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Checks immutable `app_metadata.role = 'admin'` on the Supabase Auth JWT.
-- End-users can mutate `user_metadata`, NEVER `app_metadata`.
-- Grant an operator admin standing in Supabase SQL Editor:
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
-- §2 · CORE ENTITLEMENT TABLES
-- =============================================================================

-- 1. `subscriptions`
create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  customer_email  text not null
                  check (char_length(customer_email) <= 254 and customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status          text not null default 'active'
                  check (status in ('active', 'suspended', 'expired')),
  tier            text not null default 'standard'
                  check (tier in ('standard', 'solo', 'growth', 'chain', 'enterprise')),
  max_machines    integer not null default 1
                  check (max_machines >= 1 and max_machines <= 10000),
  expires_at      timestamptz not null,
  notes           text not null default ''
                  check (char_length(notes) <= 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_subscriptions_customer_email
  on public.subscriptions (lower(customer_email));

create index if not exists idx_subscriptions_status_expires
  on public.subscriptions (status, expires_at);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- 2. `licenses`
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

-- 3. `activated_machines` (Hardware Lock)
create table if not exists public.activated_machines (
  id                  uuid primary key default gen_random_uuid(),
  license_id          uuid not null
                      references public.licenses(id) on delete cascade,
  machine_fingerprint text not null
                      check (char_length(btrim(machine_fingerprint)) between 1 and 512),
  activated_at        timestamptz not null default now(),
  last_heartbeat      timestamptz not null default now(),
  constraint activated_machines_license_fingerprint_unique
    unique (license_id, machine_fingerprint)
);

create index if not exists idx_activated_machines_license_id
  on public.activated_machines (license_id);

-- =============================================================================
-- §3 · CONCURRENCY-SAFE HARDWARE LOCK & SECURE FLATTENED VIEW
-- =============================================================================

-- Row-locks the parent `licenses` record (`FOR UPDATE OF l`) before counting
-- existing machines so concurrent container startups cannot exceed `max_machines`.
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
  s.updated_at
from public.licenses l
join public.subscriptions s
  on s.id = l.subscription_id;

-- =============================================================================
-- §4 · ATOMIC PROVISIONING & NODE RELEASE RPCs
-- =============================================================================
create or replace function public.create_subscription_with_license(
  p_customer_email text,
  p_tier           text default 'standard',
  p_max_machines   integer default 1,
  p_expires_at     timestamptz default (now() + interval '1 year'),
  p_notes          text default ''
)
returns public.admin_license_view
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subscription_id uuid;
  v_license_id      uuid;
  v_result          public.admin_license_view;
begin
  if not public.is_license_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'administrator privileges required'
      using errcode = '42501';
  end if;

  insert into public.subscriptions (
    customer_email,
    status,
    tier,
    max_machines,
    expires_at,
    notes
  )
  values (
    lower(btrim(p_customer_email)),
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

-- =============================================================================
-- §5 · ZERO-TRUST ROW-LEVEL SECURITY (RLS)
-- =============================================================================
alter table public.app_meta enable row level security;
alter table public.schema_migrations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.licenses enable row level security;
alter table public.activated_machines enable row level security;

revoke all on public.app_meta from public, anon;
revoke all on public.schema_migrations from public, anon;
revoke all on public.subscriptions from public, anon;
revoke all on public.licenses from public, anon;
revoke all on public.activated_machines from public, anon;
revoke all on public.admin_license_view from public, anon;
revoke all on function public.create_subscription_with_license(text, text, integer, timestamptz, text) from public, anon;
revoke all on function public.revoke_machine_node(uuid) from public, anon;

grant select on public.app_meta to authenticated;
grant select on public.schema_migrations to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.licenses to authenticated;
grant select, insert, update, delete on public.activated_machines to authenticated;
grant select on public.admin_license_view to authenticated;
grant execute on function public.app_schema_version() to authenticated;
grant execute on function public.app_migrations() to authenticated;
grant execute on function public.create_subscription_with_license(text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.revoke_machine_node(uuid) to authenticated;

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
