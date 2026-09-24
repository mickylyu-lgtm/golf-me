-- Health audit Batch C, P2-12: leave_golf_call() had no status or host
-- check.
--   * Leaving a completed round flipped the caller to 'left', which silently
--     strips that round from their (and, for a 2-person round, their
--     partner's) Reputation credit -- get_reputation_state() only counts
--     'joined' participants of completed rounds.
--   * A host "leaving" their own round removed the host's seat while the
--     round stayed hosted by them, skewing capacity (and flipping a full
--     round back to open).
--   * Leaving a cancelled round was a pointless no-op-ish write.
-- New rules: you can only leave an open or full round, and the host can't
-- leave at all (they cancel instead). The error text is what the client
-- already surfaces in its leave toast (GolfCallDetail's catch shows
-- err.message).
create or replace function public.leave_golf_call(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.golf_calls%rowtype;
begin
  select * into v_call from public.golf_calls where id = p_round_id for update;
  if not found then
    raise exception 'Round not found.';
  end if;
  if v_call.host_user_id = (select auth.uid()) then
    raise exception 'Hosts can''t leave their own round. Cancel it instead.';
  end if;
  if v_call.status not in ('open', 'full') then
    raise exception 'This round has already ended, so you can''t leave it.';
  end if;

  update public.round_participants
    set participant_status = 'left'
    where round_id = p_round_id and user_id = (select auth.uid()) and participant_status = 'joined';

  update public.golf_calls
    set status = 'open'
    where id = p_round_id and status = 'full';
end;
$$;

revoke execute on function public.leave_golf_call(uuid) from public, anon;
grant execute on function public.leave_golf_call(uuid) to authenticated;
