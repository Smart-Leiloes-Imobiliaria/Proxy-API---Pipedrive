begin;

create table if not exists public.bitrix_installations (
  member_id text primary key,
  domain text not null,
  client_endpoint text not null,
  server_endpoint text not null,
  scope text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  application_token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  event_binding_status text not null default 'pending'
    check (event_binding_status in ('pending', 'bound')),
  event_binding_error text,
  event_bound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bitrix_evaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  member_id text not null references public.bitrix_installations(member_id) on delete cascade,
  event_id bigint not null check (event_id > 0),
  session_id bigint not null check (session_id > 0),
  chat_id bigint not null check (chat_id > 0),
  line_id bigint,
  connector_id text,
  user_id bigint,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'not_evaluable', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, session_id)
);

create index if not exists bitrix_evaluation_jobs_claim_idx
  on public.bitrix_evaluation_jobs (status, next_attempt_at, received_at);

alter table public.bitrix_installations enable row level security;
alter table public.bitrix_evaluation_jobs enable row level security;

revoke all on public.bitrix_installations from anon, authenticated;
revoke all on public.bitrix_evaluation_jobs from anon, authenticated;
grant all on public.bitrix_installations to service_role;
grant all on public.bitrix_evaluation_jobs to service_role;

create or replace function public.claim_bitrix_evaluation_jobs(max_jobs integer default 1)
returns setof public.bitrix_evaluation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.bitrix_evaluation_jobs as jobs
  set status = 'processing',
      attempts = jobs.attempts + 1,
      locked_at = now(),
      updated_at = now()
  where jobs.id in (
    select candidate.id
    from public.bitrix_evaluation_jobs as candidate
    where (
      (candidate.status = 'pending' and coalesce(candidate.next_attempt_at, now()) <= now())
      or (candidate.status = 'failed' and candidate.next_attempt_at is not null and candidate.next_attempt_at <= now())
      or (candidate.status = 'processing' and candidate.locked_at < now() - interval '15 minutes')
    )
    order by candidate.received_at asc
    for update skip locked
    limit greatest(1, least(coalesce(max_jobs, 1), 10))
  )
  returning jobs.*;
end;
$$;

revoke all on function public.claim_bitrix_evaluation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_bitrix_evaluation_jobs(integer) to service_role;

commit;
