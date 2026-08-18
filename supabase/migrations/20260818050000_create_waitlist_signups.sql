-- Public pre-TestFlight waitlist. The one table in this project written by
-- the `anon` role -- every other table requires a real `authenticated`
-- session, but a marketing landing page visitor has neither an account nor
-- a reason to create one yet (the brief is explicit: waitlist signup and
-- GolfMe authentication stay separate, never auto-create an account).
--
-- normalized_email is computed server-side by a trigger (never trusted from
-- the client) and is the unique-constraint target -- a duplicate signup
-- attempt fails with a plain Postgres unique_violation (23505), which the
-- client catches to show a friendly "already on the waitlist" message.
-- This means the public form never needs any read access to the table at
-- all to detect duplicates, which is exactly what keeps this safe as an
-- anon-writable table: RLS grants insert only, with no select/update/
-- delete policy for anon or authenticated, so nobody can read anyone
-- else's email, identity, or the raw signup list through the API, ever.
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  normalized_email text not null unique,
  home_region text not null check (char_length(home_region) between 1 and 100),
  referral_source text check (referral_source is null or char_length(referral_source) <= 100),
  status text not null default 'waiting' check (status in ('waiting', 'invited', 'beta', 'declined')),
  created_at timestamptz not null default now()
);
create index waitlist_signups_home_region_idx on public.waitlist_signups (home_region);
create index waitlist_signups_status_idx on public.waitlist_signups (status);

create function public.set_waitlist_normalized_email()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.normalized_email = lower(trim(new.email));
  new.status = 'waiting'; -- client-supplied status is never trusted, always overwritten
  return new;
end;
$$;

create trigger set_waitlist_signups_normalized_email
  before insert on public.waitlist_signups
  for each row execute function public.set_waitlist_normalized_email();

alter table public.waitlist_signups enable row level security;

-- Anonymous (logged-out) visitors can insert; the trigger above strips any
-- attempt to set normalized_email/status directly. No select/update/delete
-- policy for anon OR authenticated -- reading the list back (aggregate
-- region counts, moving someone from waiting -> invited -> beta) is a
-- founder-only operation done directly via the Supabase dashboard/SQL for
-- now, not exposed through the app's API surface at all.
create policy waitlist_signups_insert_anon on public.waitlist_signups
  for insert to anon, authenticated
  with check (true);
