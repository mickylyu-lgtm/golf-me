-- conversation_participants' own select policy subqueried
-- conversation_participants itself ("am I a fellow participant") — a raw
-- self-referencing subquery inside an RLS policy re-triggers that same
-- policy's evaluation on every row it touches, which is infinite recursion,
-- not just slow. conversations_select_participant and
-- messages_select_participant (and the block-check half of the messages
-- insert policy) hit the same recursion indirectly, since they subquery
-- conversation_participants too, which was already recursive on its own.
--
-- Standard fix: move the "is caller a participant of this conversation"
-- check into a SECURITY DEFINER function. A SECURITY DEFINER function's
-- internal queries bypass RLS entirely (same mechanism every other function
-- in this migration set already relies on), which breaks the recursion —
-- the check itself no longer re-triggers the policy it's being used inside.
create function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- Same reasoning for the messages insert policy's block-check, which
-- enumerates the *other* participant(s) of a conversation by querying
-- conversation_participants — also recursion-prone if left as a raw
-- subquery referenced from a policy.
create function public.conversation_other_participants(p_conversation_id uuid)
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select cp.user_id from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id and cp.user_id <> auth.uid();
$$;

revoke execute on function public.conversation_other_participants(uuid) from public, anon;
grant execute on function public.conversation_other_participants(uuid) to authenticated;

drop policy "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (public.is_conversation_participant(conversations.id));

drop policy "conversation_participants_select_fellow_participant" on public.conversation_participants;
create policy "conversation_participants_select_fellow_participant"
  on public.conversation_participants for select
  to authenticated
  using (public.is_conversation_participant(conversation_participants.conversation_id));

drop policy "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (public.is_conversation_participant(messages.conversation_id));

drop policy "messages_insert_participant_not_blocked" on public.messages;
create policy "messages_insert_participant_not_blocked"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_participant(messages.conversation_id)
    and not exists (
      select 1
      from public.conversation_other_participants(messages.conversation_id) as other_id
      join public.blocks b
        on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_id)
        or (b.blocker_id = other_id and b.blocked_id = (select auth.uid()))
    )
  );
