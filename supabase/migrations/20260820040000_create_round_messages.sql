-- Golf Call group chat has been real-user-scoped by round_participants
-- since Phase 4, but the chat MESSAGES themselves never got a real table --
-- GroupChat.tsx/DataContext.tsx's messagesForCall()/sendMessage() have
-- always read/written localStorage-backed data.messages regardless of
-- auth.isDemo, so two real participants on different devices could never
-- see each other's group chat messages. This gives it the same real table
-- + RLS + realtime treatment DMs already have (messages/conversation_participants),
-- just scoped to round membership instead of a conversation.
create table public.round_messages (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.golf_calls (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (length(text) > 0),
  created_at timestamptz not null default now()
);
alter table public.round_messages enable row level security;

-- Membership = the round's host, or a currently-joined participant. Mirrors
-- the private.is_conversation_participant() precedent for DMs -- a
-- SECURITY DEFINER helper so the policy itself can't recurse or leak.
create function private.is_round_member(p_round_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.golf_calls gc where gc.id = p_round_id and gc.host_user_id = (select auth.uid())
  ) or exists (
    select 1 from public.round_participants rp
    where rp.round_id = p_round_id and rp.user_id = (select auth.uid()) and rp.participant_status = 'joined'
  );
$$;
revoke execute on function private.is_round_member(uuid) from public, anon;
grant execute on function private.is_round_member(uuid) to authenticated;

create policy round_messages_select_member on public.round_messages
  for select to authenticated
  using (private.is_round_member(round_id));

create policy round_messages_insert_member on public.round_messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.is_round_member(round_id));

-- No update/delete policy -- chat history is append-only, same as DMs.
