-- Health audit Batch C, P2-3: conversation_participants_update_own_read_state
-- (20260813210000) is meant for the caller's own read/clear/hide state
-- (last_read_at, cleared_before, hidden_at), but it has no column limits:
-- WITH CHECK only pins user_id to the caller, so a user could rewrite
-- conversation_id on their own row and move themselves into any other
-- conversation whose id they know -- and is_conversation_participant()
-- would then let them read that conversation's messages.
--
-- Membership rows are only ever created by get_or_create_dm_conversation() /
-- the founder-welcome trigger and never legitimately re-keyed, so the key
-- columns are frozen for every role (raise, not silently revert, so a
-- misbehaving caller finds out).
create function public.freeze_conversation_participant_keys()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Conversation membership can''t be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.freeze_conversation_participant_keys() from public, anon, authenticated;

create trigger conversation_participants_freeze_keys
  before update on public.conversation_participants
  for each row execute function public.freeze_conversation_participant_keys();
