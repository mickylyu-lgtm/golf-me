-- Verified Golfer, server-derived (Micky's decision, 2026-11-06).
--
-- Old rule: "phone + email verification". Real phone verification never
-- existed (no number is collected; 20260919030000 froze phone_verified /
-- email_verified / verified_golfer against client writes), so nobody could
-- earn the badge.
--
-- New rule:
--   verified_golfer = (a confirmed email OR an Apple / Google sign-in identity)
--                     AND a profile photo
--                     AND at least 1 qualifying completed round.
--
-- "Qualifying completed round" is NOT redefined here: the round check is
-- get_reputation_state(uid).qualifying_rounds >= 1, i.e. the frozen
-- Reputation definition (completed round, the user joined, >= 2 joined),
-- reused as is. The Reputation formula, thresholds, tier names and that
-- definition are untouched by this migration.
--
-- Architecture: profiles.verified_golfer stays the one column every display
-- surface already reads (profiles select *, the directory RPCs, admin), but
-- it becomes trigger-maintained and is never client-settable:
--   * protect_unverified_trust_columns() (BEFORE UPDATE on profiles, runs for
--     every role) now derives verified_golfer instead of copying the old
--     value. It recomputes when photo_url changes or when the server-side
--     refresh below asks for it; any other write keeps the stored value.
--     Whatever a client sends for the column is discarded either way.
--   * a new BEFORE INSERT trigger derives it on insert too (profiles_insert_own
--     would otherwise let a client insert a row with verified_golfer = true).
--   * private.refresh_verified_golfer(uid) recomputes one user; it is called
--     from AFTER triggers when an input changes: auth.users.email_confirmed_at,
--     golf_calls.status to/from 'completed', and round_participants changes
--     on a completed (or just-deleted) round. Refresh failures are logged as
--     warnings and never fail the sign-in / round write that triggered them.
--   * get_my_verified_golfer_status() returns the caller's own checklist
--     (four booleans, nothing else) and self-heals the stored column, so an
--     input change no trigger watches (e.g. linking an Apple / Google identity
--     to an account with no confirmed email) is picked up next time the
--     golfer opens Reputation.
--
-- Privacy: other golfers see only profiles.verified_golfer (same visibility
-- as before). The per-criterion booleans are returned to the caller only,
-- about the caller only. Nothing from the auth schema (email, timestamps,
-- providers) is ever returned; the helpers that read it live in `private`
-- with EXECUTE revoked from every API role.
--
-- phone_verified / email_verified are retired: always false from now on (the
-- client never reads them for real accounts; their old values were
-- self-set before 20260919030000 and meant nothing).

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 1. Criteria (private, not callable by any API role)
-- ---------------------------------------------------------------------------

create or replace function private.verified_identity_confirmed(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    return true;
  end if;
  -- Guarded so a missing/renamed auth.identities can never break a profile
  -- write; the email signal above still works on its own.
  if to_regclass('auth.identities') is null then
    return false;
  end if;
  return exists (
    select 1 from auth.identities i
    where i.user_id = p_user_id and i.provider in ('apple', 'google')
  );
end;
$$;

-- The frozen Reputation definition, reused (not copied).
create or replace function private.has_qualifying_round(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((select r.qualifying_rounds from public.get_reputation_state(p_user_id) r limit 1), 0) >= 1;
end;
$$;

create or replace function private.verified_golfer_checks(p_user_id uuid, p_photo_url text)
returns table (identity_confirmed boolean, has_photo boolean, has_qualifying_round boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query select
    private.verified_identity_confirmed(p_user_id),
    coalesce(btrim(p_photo_url), '') <> '',
    private.has_qualifying_round(p_user_id);
end;
$$;

-- Cheapest checks first: the round check (get_reputation_state) only runs for
-- golfers who already have a photo and a confirmed identity.
create or replace function private.is_verified_golfer(p_user_id uuid, p_photo_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(btrim(p_photo_url), '') = '' then
    return false;
  end if;
  if not private.verified_identity_confirmed(p_user_id) then
    return false;
  end if;
  return private.has_qualifying_round(p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The column is derived on every write
-- ---------------------------------------------------------------------------

-- Same function as 20260924100100 except: phone_verified / email_verified are
-- retired (always false) and verified_golfer is derived instead of frozen.
-- Every other frozen column keeps its old value exactly as before.
create or replace function public.protect_unverified_trust_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone_verified := false;
  new.email_verified := false;
  new.verified_golfer := old.verified_golfer;
  if new.photo_url is distinct from old.photo_url
     or coalesce(current_setting('golfme.verified_refresh', true), '') = 'on' then
    -- A recompute error never fails the profile save; the value then stays
    -- as it was and get_my_verified_golfer_status() heals it later.
    begin
      new.verified_golfer := private.is_verified_golfer(new.id, new.photo_url);
    exception when others then
      raise warning 'verified_golfer recompute failed for %: %', new.id, sqlerrm;
    end;
  end if;
  new.member_since := old.member_since;
  new.completed_rounds := old.completed_rounds;
  new.show_up_rate_pct := old.show_up_rate_pct;
  new.would_play_again_pct := old.would_play_again_pct;
  new.on_time_pct := old.on_time_pct;
  new.respectful_pct := old.respectful_pct;
  new.good_pace_pct := old.good_pace_pct;
  new.circle_size := old.circle_size;
  return new;
end;
$$;

revoke execute on function public.protect_unverified_trust_columns() from public, anon, authenticated;

create or replace function private.derive_verified_golfer_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone_verified := false;
  new.email_verified := false;
  new.verified_golfer := false;
  begin
    new.verified_golfer := private.is_verified_golfer(new.id, new.photo_url);
  exception when others then
    raise warning 'verified_golfer derive on insert failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger profiles_derive_verified_golfer_on_insert
  before insert on public.profiles
  for each row execute function private.derive_verified_golfer_on_insert();

-- ---------------------------------------------------------------------------
-- 3. Refresh one golfer (server-side only)
-- ---------------------------------------------------------------------------

-- Writes only when the derived value actually changes (no updated_at /
-- realtime churn). The GUC only tells the profiles trigger to recompute; it
-- can't make the value anything but the truth.
create or replace function private.refresh_verified_golfer(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_photo text;
  v_current boolean;
  v_next boolean;
begin
  if p_user_id is null then
    return;
  end if;
  select p.photo_url, p.verified_golfer into v_photo, v_current
  from public.profiles p where p.id = p_user_id;
  if not found then
    return;
  end if;
  v_next := private.is_verified_golfer(p_user_id, v_photo);
  if v_next is distinct from v_current then
    perform set_config('golfme.verified_refresh', 'on', true);
    update public.profiles set verified_golfer = v_next where id = p_user_id;
    perform set_config('golfme.verified_refresh', '', true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Input-change triggers (never fail the write that fired them)
-- ---------------------------------------------------------------------------

create or replace function private.verified_golfer_after_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.refresh_verified_golfer(new.id);
  exception when others then
    raise warning 'verified_golfer refresh failed for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger on_auth_user_email_confirmed_verified_golfer
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function private.verified_golfer_after_email_confirmed();

create or replace function private.verified_golfer_after_round_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct rp.user_id from public.round_participants rp where rp.round_id = new.id
  loop
    begin
      perform private.refresh_verified_golfer(v_user);
    exception when others then
      raise warning 'verified_golfer refresh failed for %: %', v_user, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

create trigger golf_calls_refresh_verified_golfer
  after update of status on public.golf_calls
  for each row
  when (old.status is distinct from new.status and (old.status = 'completed' or new.status = 'completed'))
  execute function private.verified_golfer_after_round_status();

-- A participant change only matters on a completed round (joined count and
-- membership feed the qualifying definition), or when the round itself is
-- gone (cascade delete: the golf_calls row is already invisible here).
create or replace function private.verified_golfer_after_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_status text;
  v_users uuid[];
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_round := old.round_id;
  else
    v_round := new.round_id;
  end if;

  select gc.status into v_status from public.golf_calls gc where gc.id = v_round;
  if found and v_status <> 'completed' then
    return null;
  end if;

  v_users := array(select rp.user_id from public.round_participants rp where rp.round_id = v_round);
  if tg_op in ('UPDATE', 'DELETE') then
    v_users := v_users || old.user_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_users := v_users || new.user_id;
  end if;

  for v_user in select distinct u from unnest(v_users) as u where u is not null
  loop
    begin
      perform private.refresh_verified_golfer(v_user);
    exception when others then
      raise warning 'verified_golfer refresh failed for %: %', v_user, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

create trigger round_participants_refresh_verified_golfer
  after insert or delete or update of participant_status, user_id, round_id on public.round_participants
  for each row execute function private.verified_golfer_after_participant_change();

-- ---------------------------------------------------------------------------
-- 5. The caller's own checklist (the only client entry point)
-- ---------------------------------------------------------------------------

create or replace function public.get_my_verified_golfer_status()
returns table (verified boolean, identity_confirmed boolean, has_photo boolean, has_qualifying_round boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_photo text;
  v_identity boolean;
  v_has_photo boolean;
  v_round boolean;
  v_verified boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select p.photo_url into v_photo from public.profiles p where p.id = v_uid;
  if not found then
    return;
  end if;

  perform private.refresh_verified_golfer(v_uid);

  select c.identity_confirmed, c.has_photo, c.has_qualifying_round
    into v_identity, v_has_photo, v_round
  from private.verified_golfer_checks(v_uid, v_photo) c;
  select p.verified_golfer into v_verified from public.profiles p where p.id = v_uid;

  return query select coalesce(v_verified, false), coalesce(v_identity, false), coalesce(v_has_photo, false), coalesce(v_round, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------

revoke execute on function private.verified_identity_confirmed(uuid) from public, anon, authenticated;
revoke execute on function private.has_qualifying_round(uuid) from public, anon, authenticated;
revoke execute on function private.verified_golfer_checks(uuid, text) from public, anon, authenticated;
revoke execute on function private.is_verified_golfer(uuid, text) from public, anon, authenticated;
revoke execute on function private.refresh_verified_golfer(uuid) from public, anon, authenticated;
revoke execute on function private.derive_verified_golfer_on_insert() from public, anon, authenticated;
revoke execute on function private.verified_golfer_after_email_confirmed() from public, anon, authenticated;
revoke execute on function private.verified_golfer_after_round_status() from public, anon, authenticated;
revoke execute on function private.verified_golfer_after_participant_change() from public, anon, authenticated;

revoke execute on function public.get_my_verified_golfer_status() from public, anon;
grant execute on function public.get_my_verified_golfer_status() to authenticated;

comment on column public.profiles.verified_golfer is
  'Server-derived (20261107230000): confirmed email or Apple/Google identity + photo + >= 1 qualifying completed round. Never client-settable.';
comment on column public.profiles.phone_verified is 'Retired (20261107230000): always false.';
comment on column public.profiles.email_verified is 'Retired (20261107230000): always false. Email confirmation is auth.users.email_confirmed_at.';

-- ---------------------------------------------------------------------------
-- 7. Backfill: derive every existing row once (only rows that change)
-- ---------------------------------------------------------------------------

select set_config('golfme.verified_refresh', 'on', false);
update public.profiles p
set verified_golfer = p.verified_golfer
where p.phone_verified
   or p.email_verified
   or p.verified_golfer is distinct from private.is_verified_golfer(p.id, p.photo_url);
select set_config('golfme.verified_refresh', '', false);
