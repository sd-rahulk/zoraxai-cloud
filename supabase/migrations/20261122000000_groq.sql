alter table zorax.requests add column if not exists provider text;
alter table zorax.requests add column if not exists verified_total_tokens bigint;
alter table zorax.requests add column if not exists verified_reasoning bigint;
update zorax.requests set provider='ollama' where provider is null and route='cloud';
create table if not exists zorax.maintenance (
  singleton boolean primary key default true check(singleton),
  next_run timestamptz not null default now()
);
insert into zorax.maintenance default values on conflict do nothing;
alter table zorax.maintenance enable row level security;
