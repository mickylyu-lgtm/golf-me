-- Per-user chat history controls. Deliberately NOT a raw `delete from
-- messages` for either action — messages are shared records between two
-- participants, so wiping them for everyone the moment one person clears
-- their own view would destroy the other person's legitimate history.
-- Reuses conversation_participants (already the per-(conversation,user)
-- row, already has last_read_at) rather than a new table — same
-- reasoning as every other per-user-state column already on this table.
--
-- cleared_before: "Clear Chat History" sets this to now(); messages older
-- than it become invisible to that user only, enforced by RLS below (not
-- just filtered in the app), while the other participant's own
-- cleared_before is untouched and they keep seeing everything.
--
-- hidden_at: "Delete Conversation" sets this to now(); the conversation
-- drops out of that user's inbox list (app-level filter, not RLS — the
-- conversation/message rows aren't actually inaccessible, just excluded
-- from the list) until a message newer than hidden_at arrives, at which
-- point it naturally reappears since the filter is a live comparison, not
-- a one-time flag.
alter table public.conversation_participants
  add column cleared_before timestamptz,
  add column hidden_at timestamptz;

-- Existing conversation_participants_update_own_read_state policy already
-- scopes UPDATE to `user_id = auth.uid()` for the whole row, so no new
-- policy is needed for these two columns — user A still can never touch
-- user B's row.

drop policy messages_select_participant on public.messages;
create policy messages_select_participant on public.messages
  for select to authenticated
  using (
    private.is_conversation_participant(conversation_id)
    and created_at > coalesce(
      (
        select cp.cleared_before
        from public.conversation_participants cp
        where cp.conversation_id = messages.conversation_id
          and cp.user_id = (select auth.uid())
      ),
      '-infinity'::timestamptz
    )
  );
