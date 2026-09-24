-- Health audit Batch C, P1-5: blocking wasn't enforced for rounds. DMs
-- already refuse to deliver across a block (messages insert policy), but a
-- blocked golfer could still join the blocker's round, or a round the
-- blocker is playing in, and post in that round's group chat.
--
-- Micky's decision (2026-09-24): blocking prevents joining in both
-- directions, and the blocker's rounds are hidden from the blocked user (and
-- vice versa). The hiding is client-side (DataContext filters rounds whose
-- host is blocked either way, the blocks select policy already lets each
-- side see a block row that involves them); this migration is the server
-- enforcement.
--
-- Join: rejected if a block exists either way between the joiner and the
-- host OR any currently joined participant -- a round is a small in-person
-- group, so "can't join" has to cover the people you'd actually be playing
-- with, not just the host. The error text is deliberately generic so it
-- doesn't reveal who in the round did the blocking.
--
-- Round chat: a member can't post while a block exists either way between
-- them and the round's host. Blocks between two non-host members don't stop
-- either from posting (that would let any one member silence the group);
-- the join check above already stops that pairing from forming after a
-- block.

create function private.has_block_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- Used from an RLS policy, so the calling role needs EXECUTE; it only ever
-- answers yes/no for a pair, and every caller of the policy passes
-- auth.uid() as one side.
revoke execute on function private.has_block_between(uuid, uuid) from public, anon;
grant execute on function private.has_block_between(uuid, uuid) to authenticated;

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
  v_uid uuid := (select auth.uid());
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
  if v_call.host_user_id = v_uid then
    raise exception 'You are already hosting this round.';
  end if;
  if private.has_block_between(v_uid, v_call.host_user_id) or exists (
    select 1 from public.round_participants rp
    where rp.round_id = p_round_id and rp.participant_status = 'joined'
      and private.has_block_between(v_uid, rp.user_id)
  ) then
    raise exception 'You can''t join this round.' using errcode = '42501';
  end if;

  select count(*) into v_joined_count from public.round_participants
    where round_id = p_round_id and participant_status = 'joined';
  if v_joined_count >= v_call.total_spots then
    raise exception 'This round is full.';
  end if;

  insert into public.round_participants (round_id, user_id, participant_status, joined_at)
    values (p_round_id, v_uid, 'joined', now())
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

revoke execute on function public.join_golf_call(uuid) from public, anon;
grant execute on function public.join_golf_call(uuid) to authenticated;

drop policy round_messages_insert_member on public.round_messages;
create policy round_messages_insert_member on public.round_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_round_member(round_id)
    and not private.has_block_between(
      (select auth.uid()),
      (select gc.host_user_id from public.golf_calls gc where gc.id = round_id)
    )
  );
