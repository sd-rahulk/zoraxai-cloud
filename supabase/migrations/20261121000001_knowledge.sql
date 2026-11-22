create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists zorax.knowledge_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  is_default boolean not null default false,
  version integer not null default 1 check (version > 0),
  content bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists knowledge_profile_name on zorax.knowledge_profiles (lower(name));
create unique index if not exists knowledge_default on zorax.knowledge_profiles (is_default) where is_default;

create table if not exists zorax.knowledge_revisions (
  profile_id uuid not null references zorax.knowledge_profiles(id) on delete cascade,
  version integer not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, version)
);

create table if not exists zorax.knowledge_access (
  profile_id uuid not null references zorax.knowledge_profiles(id) on delete cascade,
  key_id uuid not null references zorax.keys(id) on delete cascade,
  primary key (profile_id, key_id)
);
create index if not exists knowledge_access_key on zorax.knowledge_access (key_id, profile_id);
alter table zorax.knowledge_profiles enable row level security;
alter table zorax.knowledge_revisions enable row level security;
alter table zorax.knowledge_access enable row level security;

-- Supabase commonly installs pgcrypto in extensions. Existing standalone
-- installations can already have it in public. Resolve the real extension schema.
do $migration$
declare crypto_schema text;
begin
  select n.nspname into strict crypto_schema from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  execute format(
    'create or replace function zorax.encrypt_knowledge(text,text) returns bytea language sql strict '
    'set search_path=pg_catalog as %L',
    format('select %I.pgp_sym_encrypt($1,$2,''cipher-algo=aes256,compress-algo=0'')', crypto_schema)
  );
  execute format(
    'create or replace function zorax.decrypt_knowledge(bytea,text) returns text language sql strict '
    'set search_path=pg_catalog as %L',
    format('select %I.pgp_sym_decrypt($1,$2)', crypto_schema)
  );
end
$migration$;
revoke all on function zorax.encrypt_knowledge(text,text) from public;
revoke all on function zorax.decrypt_knowledge(bytea,text) from public;
