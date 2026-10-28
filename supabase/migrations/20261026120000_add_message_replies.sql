-- Swipe-to-reply in 1:1 chat (Micky, 2026-10-26): a DM can quote an earlier
-- message from the SAME conversation.
--
-- Schema: messages.reply_to_message_id, nullable, self-referencing. If the
-- quoted message is ever deleted (account deletion cascades, conversation
-- deletion), the reply survives as a normal message: ON DELETE SET NULL.
--
-- Security:
--   * RLS is unchanged. Clients still insert directly under the existing
--     messages_insert_participant_not_blocked policy (sender = caller,
--     caller is a participant, no block either way), and there is still no
--     UPDATE or DELETE policy on messages, so a client can only ever set
--     reply_to_message_id at insert time.
--   * The trigger below makes the database refuse any reply whose target
--     is not in the same conversation, so nobody can attach (and later get
--     rendered against) a message id from a conversation they aren't in.
--     It is SECURITY DEFINER only so that its lookup isn't filtered by the
--     caller's own RLS view (e.g. a message they hid with Clear chat is still
--     a valid target); it raises the SAME error for "doesn't exist" and
--     "exists in another conversation", and runs before the foreign-key
--     check, so it can't be used to probe whether some message id exists.
--   * No new data exposure: the client renders the quote only from messages
--     the reader has already loaded through messages_select_participant.
--
-- Notifications/push: unchanged (trg_notify_new_message fires for every
-- insert exactly as before; a reply is just a message).
--
-- Rollout: the client feature-detects the column (it only offers
-- swipe-to-reply once fetched rows carry reply_to_message_id, and falls back
-- to a plain message on a PGRST204/42703 insert error), so this can be
-- applied before or after the client deploy.

alter table public.messages
  add column reply_to_message_id uuid null
    references public.messages (id) on delete set null;

-- Serves the ON DELETE SET NULL lookup (and any "replies to X" query);
-- partial because almost every message is not a reply.
create index messages_reply_to_message_id_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

create function private.enforce_message_reply_same_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.messages m
    where m.id = new.reply_to_message_id
      and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply_not_in_conversation: a reply must quote a message from the same conversation.'
      using errcode = 'check_violation',
            hint    = 'reply_not_in_conversation';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_message_reply_same_conversation() from public, anon, authenticated;

create trigger enforce_message_reply_same_conversation
  before insert or update of reply_to_message_id, conversation_id on public.messages
  for each row execute function private.enforce_message_reply_same_conversation();
