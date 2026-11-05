-- Reaction trigger: authorize before revealing anything about the message.
-- PREPARED, NOT APPLIED: apply only after Micky's sign-off.
--
-- Problem (20261105150000_add_dm_message_reactions)
--   private.prepare_message_reaction() is a SECURITY DEFINER BEFORE
--   INSERT/UPDATE trigger, and BEFORE row triggers run before RLS
--   WITH CHECK. It looked the message up (FOR SHARE, bypassing messages RLS)
--   and raised distinct errors before any policy was evaluated:
--     * missing id         -> reaction_not_allowed: message not found.
--     * unsent message     -> reaction_message_unsent (P0001)
--     * any other message  -> trigger passes, RLS then refuses
--                             ("new row violates row-level security ...")
--   So a signed-in non-participant who guessed a message id could tell
--   "doesn't exist" from "exists" from "exists and was unsent". Not the
--   text (never readable), but still an oracle on someone else's messages.
--
-- Fix: only private.prepare_message_reaction() is replaced, same name,
-- same trigger, same grants. The table, policies, unsend trigger and
-- realtime are untouched.
--   1. The caller must be allowed to write this row before anything about
--      the message is looked at: user_id = auth.uid(); the message is
--      visible to the caller under the same rule as
--      messages_select_participant (a participant of its conversation and
--      the message newer than the caller's own cleared_before); and no
--      block exists either way with the conversation's other participant
--      (same rule as messages_insert_participant_not_blocked and the
--      reaction policies).
--   2. Only then is the message locked FOR SHARE (still waits out a
--      concurrent unsend_message, see the original header) and its
--      unsent_at checked.
--   3. Every refusal in 1 and 2, whatever the reason (missing, not mine,
--      cleared, blocked, unsent, spoofed user_id), raises the SAME error:
--      errcode 42501, message 'reaction_not_allowed', hint
--      'reaction_not_allowed'. The first lookup takes no lock, so a refused
--      non-participant also can't time the lock.
--   The RLS policies are unchanged and still apply after the trigger
--   (defence in depth); with the trigger now refusing first they no longer
--   produce a different message for these cases.
--   reaction_immutable (changing message_id/user_id on an existing row) is
--   unchanged: it is decided from the caller's own row alone, before any
--   lookup, and says nothing about any other message.
--   Privileged callers with no auth.uid() (SQL editor, service_role; anon
--   has no table privileges at all) skip step 1 only; a missing or unsent
--   message is still refused, with the same error.
--
-- Client: setMessageReaction treats any write error as a failure (toast
-- chat.reactionFailed, pill rolled back unless a newer tap exists).
-- isMissingReactionsTableError does not match this error, so reactions stay
-- enabled. Safe to apply before or after the client deploy.
--
-- Verify (SQL editor, after applying): reactions-authz-check.sql returns
-- true (one row).
--
-- Rollback: re-create the previous function body from
-- 20261105150000_add_dm_message_reactions.sql (reactions-authz-rollback.sql
-- is exactly that, in a transaction).

create or replace function private.prepare_message_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_created_at timestamptz;
  v_unsent_at timestamptz;
  v_allowed boolean;
begin
  if tg_op = 'UPDATE' and (new.message_id <> old.message_id or new.user_id <> old.user_id) then
    raise exception 'reaction_immutable: only the emoji of a reaction can change.'
      using errcode = '42501', hint = 'reaction_immutable';
  end if;

  -- 1. Authorize. No lock, and nothing about the message decides the error.
  select m.conversation_id, m.created_at
    into v_conversation_id, v_created_at
    from public.messages m
   where m.id = new.message_id;

  if v_uid is null then
    v_allowed := v_conversation_id is not null;
  else
    v_allowed := v_conversation_id is not null
      and new.user_id = v_uid
      and exists (
        select 1
          from public.conversation_participants cp
         where cp.conversation_id = v_conversation_id
           and cp.user_id = v_uid
           and v_created_at > coalesce(cp.cleared_before, '-infinity'::timestamptz)
      )
      and not exists (
        select 1
          from public.conversation_participants other
          join public.blocks b
            on (b.blocker_id = v_uid and b.blocked_id = other.user_id)
            or (b.blocker_id = other.user_id and b.blocked_id = v_uid)
         where other.conversation_id = v_conversation_id
           and other.user_id <> v_uid
      );
  end if;

  if v_allowed then
    -- 2. Lock (waits for a concurrent unsend to commit) and re-read.
    select m.unsent_at
      into v_unsent_at
      from public.messages m
     where m.id = new.message_id
       for share;
    v_allowed := found and v_unsent_at is null;
  end if;

  -- 3. One error for every refusal.
  if not coalesce(v_allowed, false) then
    raise exception 'reaction_not_allowed'
      using errcode = '42501', hint = 'reaction_not_allowed';
  end if;

  new.conversation_id := v_conversation_id;
  if tg_op = 'UPDATE' and new.emoji is distinct from old.emoji then
    new.created_at := now();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.prepare_message_reaction() from public, anon, authenticated;
