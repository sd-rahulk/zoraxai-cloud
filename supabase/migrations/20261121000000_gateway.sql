create schema if not exists zorax;
revoke all on schema zorax from public;

create table if not exists zorax.settings (
  singleton boolean primary key default true check (singleton),
  model text,
  max_output integer check (max_output between 64 and 1024),
  context_size integer check (context_size between 1024 and 32768),
  daily_tokens bigint check (daily_tokens > 0),
  monthly_tokens bigint check (monthly_tokens > 0)
);
insert into zorax.settings default values on conflict do nothing;

create table if not exists zorax.sessions (
  digest text primary key,
  admin_identity text not null,
  expires_at timestamptz not null
);

create table if not exists zorax.keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null,
  digest text not null unique,
  requests_per_minute integer not null check (requests_per_minute between 1 and 600),
  daily_requests integer not null check (daily_requests > 0),
  daily_tokens bigint check (daily_tokens > 0),
  monthly_tokens bigint check (monthly_tokens > 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists zorax.extension_credentials (
  digest text primary key,
  key_id uuid not null references zorax.keys(id),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  kind text not null check (kind in ('pair', 'access'))
);

create table if not exists zorax.requests (
  id uuid primary key default gen_random_uuid(),
  key_id uuid references zorax.keys(id),
  endpoint text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'pending' check (status in ('pending','ok','failed')),
  route text check (route in ('local','cache','cloud')),
  needs_ai boolean not null default false,
  model text,
  provider_model text,
  latency_ms integer,
  provider_latency_ms integer,
  provider_created_at timestamptz,
  done_reason text,
  provider_attempts integer not null default 0,
  verified_input bigint,
  verified_output bigint,
  verified_cached_input bigint,
  estimated_input bigint,
  estimated_output bigint,
  timings jsonb,
  error_code text,
  reserved_tokens bigint not null default 0,
  budget_charge bigint not null default 0,
  estimated_cost numeric(20,10),
  cost_assumption text,
  local_fields integer not null default 0,
  cache_fields integer not null default 0,
  field_count integer not null
);
create index if not exists requests_time on zorax.requests (created_at desc);
create index if not exists requests_key_time on zorax.requests (key_id, created_at desc);
create index if not exists requests_pending on zorax.requests (created_at) where status = 'pending';

create table if not exists zorax.model_pricing (
  model text primary key,
  input_per_million numeric not null,
  cached_per_million numeric not null,
  output_per_million numeric not null,
  checked_on date not null,
  source text not null
);
insert into zorax.model_pricing values
 ('gpt-oss:20b', 0.07, 0.035, 0.30, '2026-11-21', 'https://ollama.com/library/gpt-oss:20b-cloud'),
 ('gemma4:31b', 0.14, 0.05, 0.40, '2026-11-21', 'https://ollama.com/library/gemma4:cloud'),
 ('glm-5.3-flash', 0.15, 0.03, 0.50, '2026-11-21', 'https://ollama.com/pricing')
on conflict do nothing;

create table if not exists zorax.field_cache (
  digest text primary key,
  profile_index integer not null check (profile_index >= 0),
  expires_at timestamptz not null
);
create table if not exists zorax.audit (
  id bigint generated always as identity primary key,
  action text not null,
  key_id uuid references zorax.keys(id),
  created_at timestamptz not null default now()
);
create table if not exists zorax.login_attempts (
  attempted_at timestamptz not null default now()
);
create index if not exists login_attempts_time on zorax.login_attempts (attempted_at);

do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'zorax' loop
    execute format('alter table zorax.%I enable row level security', item.tablename);
  end loop;
end $$;
