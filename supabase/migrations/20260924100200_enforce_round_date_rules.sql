-- Health audit Batch C, P1-4 (server half): past-dated rounds.
--
-- Micky's decision (2026-09-24): completion must require the round's date to
-- have passed, enforced server-side. The client half (0195df9) already hides
-- past rounds from browse/join and confirms before completing, but nothing
-- stopped a direct RPC/REST call from joining a stale round or completing a
-- round that hasn't happened yet (completed rounds are what Reputation
-- credits).
--
-- How dates are stored: golf_calls.date_iso is the round's calendar day at
-- LOCAL NOON on the host's device, converted to UTC (CreateGolfCall /
-- EditTeeTimeModal: new Date(`${date}T12:00:00`).toISOString()). The tee
-- time itself is a separate free-text label. So, in the host's timezone:
--   date_iso               = noon on the round day
--   date_iso + 12 hours    = midnight at the END of the round day
-- Both rules below are expressed relative to date_iso only, so they're the
-- same for every viewer regardless of the viewer's own timezone.
--
-- Rule 1 -- joining: rejected once now() > date_iso + 12 hours, i.e. once
--   the round's calendar day is over in the host's timezone. Matches the
--   client's isPastRound() for a viewer in the host's timezone; a viewer in
--   a different timezone may see the client and server disagree by at most
--   their UTC offset difference, and the server error is the backstop.
-- Rule 2 -- completing: allowed once now() >= date_iso, i.e. from noon on
--   the round day (host's timezone) onward. Earlier than that the round
--   can't have been played yet in any meaningful sense; noon (rather than
--   end of day) lets a host close out a morning round the same afternoon.
--
-- Completion is currently a direct golf_calls update by the host
-- (RealRoundsContext.completeRound via golf_calls_update_host), so rule 2 is
-- a BEFORE UPDATE trigger that also locks down every other direct status
-- transition. Same SECURITY INVOKER + current_user pattern as
-- guard_golf_calls_client_writes (20260924100100): only direct writes by the
-- client roles are policed; the SECURITY DEFINER RPCs (join/leave flipping
-- open<->full) run as the function owner and pass through.
create function public.guard_golf_call_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('open', 'full') and new.status = 'cancelled' then
    return new;
  end if;

  if old.status in ('open', 'full') and new.status = 'completed' then
    if now() < old.date_iso then
      raise exception 'You can mark this round completed once its date arrives.';
    end if;
    return new;
  end if;

  raise exception 'This round''s status can''t be changed that way.' using errcode = '42501';
end;
$$;

revoke execute on function public.guard_golf_call_status_transition() from public, anon, authenticated;

create trigger golf_calls_guard_status_transition
  before update of status on public.golf_calls
  for each row execute function public.guard_golf_call_status_transition();

-- Rule 1. Same function as before plus the date check; everything else is
-- unchanged. (20260924100300 replaces this again to add the block check.)
create or replace function public.join_golf_call(p_round_id uuid)
returns public.round_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
  v_participant public.round_participants%rowtype;
  v_joined_count int;
begin
  select * into v_call from public.golf_calls where id = p_round_id for update;
  if not found then
    raise exception 'Round not found.';
  end if;
  if v_call.status <> 'open' then
    raise exception 'This round is no longer open to join.';
  end if;
  if now() > v_call.date_iso + interval '12 hours' then
    raise exception 'This round has already taken place.';
  end if;
  if v_call.host_user_id = (select auth.uid()) then
    raise exception 'You are already hosting this round.';
  end if;

  select count(*) into v_joined_count from public.round_participants
    where round_id = p_round_id and participant_status = 'joined';
  if v_joined_count >= v_call.total_spots then
    raise exception 'This round is full.';
  end if;

  insert into public.round_participants (round_id, user_id, participant_status, joined_at)
    values (p_round_id, (select auth.uid()), 'joined', now())
    on conflict (round_id, user_id)
    do update set participant_status = 'joined', joined_at = now()
    returning * into v_participant;

  select count(*) into v_joined_count from public.round_participants
    where round_id = p_round_id and participant_status = 'joined';
  if v_joined_count >= v_call.total_spots then
    update public.golf_calls set status = 'full' where id = p_round_id;
  end if;

  return v_participant;
end;
$$;

-- create or replace keeps existing grants; restate them explicitly anyway
-- (this project auto-grants EXECUTE to anon on new functions).
revoke execute on function public.join_golf_call(uuid) from public, anon;
grant execute on function public.join_golf_call(uuid) to authenticated;
