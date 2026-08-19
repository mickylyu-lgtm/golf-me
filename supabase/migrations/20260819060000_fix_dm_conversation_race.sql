-- get_or_create_dm_conversation() previously had a documented, accepted
-- race: two people messaging each other for the very first time at the
-- exact same instant could each create a SEPARATE conversation row for the
-- same pair, since there was no locking (unlike join_golf_call(), which
-- locks the existing golf_calls row with `for update`). That's not
-- available here — the row that needs protecting doesn't exist yet, that's
-- the whole race — so this uses a transaction-scoped Postgres advisory
-- lock keyed on the sorted pair of user ids instead, which serializes
-- concurrent first-contact calls for the exact same pair (in either
-- direction) without needing a real row to lock. Symptom this fixes: a
-- golfer's messages silently "splitting" across two conversation rows for
-- the same other golfer, since the client only ever resolves the first
-- conversation it finds for a pair.
create or replace function public.get_or_create_dm_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_self uuid := (select auth.uid());
  v_conversation_id uuid;
  v_lock_key bigint;
begin
  if v_self = p_other_user_id then
    raise exception 'Cannot start a conversation with yourself.';
  end if;
  if exists (
    select 1 from public.blocks
    where (blocker_id = v_self and blocked_id = p_other_user_id)
       or (blocker_id = p_other_user_id and blocked_id = v_self)
  ) then
    raise exception 'Cannot message this golfer.';
  end if;

  -- Order-independent so it doesn't matter which of the two callers'
  -- transactions asks for the lock first — both hash to the same key.
  v_lock_key := hashtextextended(
    (select string_agg(id::text, ',' order by id) from (values (v_self), (p_other_user_id)) as pair(id)),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  select cp1.conversation_id into v_conversation_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = v_self and cp2.user_id = p_other_user_id
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.conversations default values returning id into v_conversation_id;
  insert into public.conversation_participants (conversation_id, user_id) values
    (v_conversation_id, v_self),
    (v_conversation_id, p_other_user_id);

  return v_conversation_id;
end;
$$;

revoke execute on function public.get_or_create_dm_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_dm_conversation(uuid) to authenticated;
