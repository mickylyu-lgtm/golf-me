-- DM reply trigger: authorize before looking at the quoted message.
-- PREPARED, NOT APPLIED: apply only after Micky's sign-off.
--
-- Background (Micky, 2026-11-06, after the voice-routing privacy fix): "add
-- a server-side check that reply_to_message_id belongs to the same
-- conversation / round". That check already exists and is unchanged here:
--   * DMs:   private.enforce_message_reply_same_conversation()
--            (20261026120000_add_message_replies)
--   * Round: private.enforce_round_message_reply_same_round()
--            (20261107130000_round_chat_parity)
-- Both are SECURITY DEFINER BEFORE INSERT / UPDATE triggers that refuse a
-- reply whose quoted message is not in the same conversation / round
-- (reply_not_in_conversation / reply_not_in_round, check_violation 23514),
-- with one error for "missing" and "in another chat". There is still no
-- client UPDATE policy on either table, so clients only set the column at
-- insert time.
--
-- Gap closed here (DMs only)
--   BEFORE row triggers run before RLS WITH CHECK. The DM trigger looked the
--   quoted id up first, so a signed-in NON-participant inserting into
--   conversation X with reply_to_message_id = M got
--     * reply_not_in_conversation  if M is missing or in another chat
--     * the plain RLS refusal      if M IS a message of X
--   i.e. an oracle on whether a guessed message id belongs to someone
--   else's conversation (never its text). Same class as the reaction
--   trigger fixed in 20261105160000. The round trigger already checks
--   membership first (20261107130000), so it is not touched.
--
-- Fix: only the DM trigger FUNCTION is replaced (same name, same trigger,
-- same grants, same error). Before any lookup: if the caller is signed in
-- and is not this row's sender or not a participant of its conversation,
-- the trigger says nothing and returns the row; the unchanged insert policy
-- (messages_insert_participant_not_blocked) then refuses it with its usual
-- message. Same rule as check_message_image / check_message_audio. A
-- participant (who can read the whole conversation anyway) still gets
-- reply_not_in_conversation for a quote from any other conversation.
-- Privileged callers with no auth.uid() (SQL editor, service_role) skip
-- the authorization step only; a cross-conversation reply is still refused.
--
-- Client: unchanged. RealSocialContext only quotes messages loaded from the
-- thread it sends to, and since 2026-11-06 a voice clip's quote comes from
-- its own origin thread only (lib/voiceSession.ts voiceSendPlan).
-- Safe to apply before or after any client deploy. No table, column,
-- policy, index or grant changes; no data changes.
--
-- Verify (SQL editor, after applying): reply-scope-check.sql returns true.
-- Rollback: reply-scope-rollback.sql (the 20261026120000 body, verbatim).

create or replace function private.enforce_message_reply_same_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  -- Not allowed to write this row: say nothing about the quoted id; the
  -- insert policy refuses the row right after this trigger.
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_conversation_participant(new.conversation_id)) then
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
