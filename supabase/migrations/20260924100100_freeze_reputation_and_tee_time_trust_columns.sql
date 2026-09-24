-- Health audit Batch C, P1-3: client-writable columns that feed Reputation
-- and round trust signals.
--
-- (1) profiles. profiles_update_own has no column limits, and the 2026-09-19
-- freeze trigger (20260919030000) only covered phone_verified /
-- email_verified / verified_golfer. That left:
--   member_since       -- get_reputation_state()'s tenure gate reads this
--                          directly, so back-dating it unlocks tenure-gated
--                          tiers (Established 14d, Trusted 60d, Premier 180d,
--                          Elite 365d) the account hasn't earned.
--   completed_rounds, show_up_rate_pct, would_play_again_pct, on_time_pct,
--   respectful_pct, good_pace_pct, circle_size
--                       -- legacy denormalized counters shown on golfer
--                          cards / the join modal. Nothing server-side ever
--                          writes them (real values come from
--                          get_credibility_stats/get_reputation_state), and
--                          golferPatchToProfileRow() deliberately never sends
--                          them, so freezing them breaks no legitimate path.
-- Same approach as the existing freeze: extend that trigger function so the
-- values silently keep their old value on every update (a future
-- server-side writer should allow itself through explicitly, not relax this
-- default). The Reputation formula, thresholds, tier names and
-- qualifying-round definition are NOT touched -- this only stops the inputs
-- from being forged.
create or replace function public.protect_unverified_trust_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone_verified := old.phone_verified;
  new.email_verified := old.email_verified;
  new.verified_golfer := old.verified_golfer;
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

-- (2) golf_calls. golf_calls_update_host / golf_calls_insert_own have no
-- column limits, so a host could write tee_time_source = 'user_verified' +
-- booking_source + verification_created_at directly (a fake "Booking Proof
-- Attached" badge with no proof row), or change course/date/time directly
-- and keep a real proof attached to what is now a different booking.
--
-- The sanctioned writers are all SECURITY DEFINER RPCs owned by postgres
-- (host_golf_call, attach_booking_proof, remove_booking_proof,
-- edit_golf_call_tee_time, join/leave_golf_call). Inside those, current_user
-- is the function owner, not 'authenticated' -- so this trigger is
-- deliberately SECURITY INVOKER and only restricts writes made directly by
-- the client roles (PostgREST requests run as authenticated/anon).
-- service_role / postgres (Edge Functions, admin fixes, the RPCs above) pass
-- through untouched.
--
-- Direct client writes that stay allowed: status changes (cancel/complete,
-- policed separately by 20260924100200) and the descriptive fields
-- (notes, vibe, game_format, skill_level, walk_or_cart, holes, price).
-- Frozen for direct client writes: identity/ownership, every verification
-- column, the course/date/time fields proof is tied to (must go through
-- edit_golf_call_tee_time, which invalidates proof when they change), and
-- total_spots (capacity is policed atomically by join_golf_call; shrinking
-- it under the joined count directly would overfill the round).
create function public.guard_golf_calls_client_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Rounds are created through host_golf_call(); a direct insert never
    -- gets to start out verified or already finished.
    new.status := 'open';
    new.tee_time_source := 'manual';
    new.booking_source := null;
    new.verification_created_at := null;
    new.tee_time_provider := null;
    new.external_tee_time_id := null;
    return new;
  end if;

  if new.tee_time_source is distinct from old.tee_time_source
     or new.booking_source is distinct from old.booking_source
     or new.verification_created_at is distinct from old.verification_created_at
     or new.tee_time_provider is distinct from old.tee_time_provider
     or new.external_tee_time_id is distinct from old.external_tee_time_id then
    raise exception 'Booking proof can only be changed by attaching or removing proof.' using errcode = '42501';
  end if;

  if new.course_id is distinct from old.course_id
     or new.course_name is distinct from old.course_name
     or new.course_area_label is distinct from old.course_area_label
     or new.course_lat is distinct from old.course_lat
     or new.course_lng is distinct from old.course_lng
     or new.date_iso is distinct from old.date_iso
     or new.tee_time_label is distinct from old.tee_time_label then
    raise exception 'Use Edit tee time to change the course, date or time.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.host_user_id is distinct from old.host_user_id
     or new.created_at is distinct from old.created_at
     or new.total_spots is distinct from old.total_spots
     or new.join_mode is distinct from old.join_mode then
    raise exception 'That round detail can''t be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_golf_calls_client_writes() from public, anon, authenticated;

create trigger golf_calls_guard_client_writes
  before insert or update on public.golf_calls
  for each row execute function public.guard_golf_calls_client_writes();
