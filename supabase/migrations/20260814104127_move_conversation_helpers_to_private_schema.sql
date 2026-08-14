-- Correction to the previous migration (lock_down_conversation_helper_functions):
-- revoking EXECUTE from `authenticated` broke RLS entirely, because unlike
-- trigger functions (which fire without an EXECUTE check on the invoking
-- role), functions called inside a policy's USING/WITH CHECK expression are
-- ordinary function calls evaluated under the querying role's privileges --
-- `authenticated` must have EXECUTE on them for the policy itself to work.
--
-- The correct way to keep these SECURITY DEFINER helpers usable by RLS but
-- unreachable as a direct /rest/v1/rpc/... endpoint is to move them out of
-- `public` (the only schema PostgREST auto-exposes here) into a `private`
-- schema that is never exposed via the API. RLS policies call functions by
-- direct SQL reference, not through PostgREST, so this has no effect on
-- policy evaluation once the policies are repointed at the new location.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

grant execute on function public.conversation_other_participants(uuid) to authenticated;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

alter function public.conversation_other_participants(uuid) set schema private;
alter function public.is_conversation_participant(uuid) set schema private;

grant usage on schema private to authenticated;
grant execute on function private.conversation_other_participants(uuid) to authenticated;
grant execute on function private.is_conversation_participant(uuid) to authenticated;

drop policy conversation_participants_select_fellow_participant on public.conversation_participants;
create policy conversation_participants_select_fellow_participant on public.conversation_participants
  for select to authenticated
  using (private.is_conversation_participant(conversation_id));

drop policy conversations_select_participant on public.conversations;
create policy conversations_select_participant on public.conversations
  for select to authenticated
  using (private.is_conversation_participant(id));

drop policy messages_select_participant on public.messages;
create policy messages_select_participant on public.messages
  for select to authenticated
  using (private.is_conversation_participant(conversation_id));

drop policy messages_insert_participant_not_blocked on public.messages;
create policy messages_insert_participant_not_blocked on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_conversation_participant(conversation_id)
    and not exists (
      select 1
      from private.conversation_other_participants(messages.conversation_id) as other_id(other_id)
      join public.blocks b
        on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_id.other_id)
        or (b.blocker_id = other_id.other_id and b.blocked_id = (select auth.uid()))
    )
  );
