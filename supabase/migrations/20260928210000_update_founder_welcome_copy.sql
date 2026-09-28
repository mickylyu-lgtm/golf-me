-- Pre-launch copy update for the founder welcome DM (approved by Micky
-- 2026-09-28). Only the message text changes: the function body is
-- otherwise identical to the live definition from
-- 20260822140000_add_founder_welcome_conversation.sql (same trigger, guards,
-- idempotency check and security settings). Messages already sent are not
-- touched; only users who finish onboarding from now on get the new text.
-- The approved copy has a paragraph break after "get out and play."; it is
-- sent as one paragraph because chat bubbles don't render newlines and the
-- DM thread is frozen.
create or replace function public.notify_founder_welcome()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- Micky Lyu / mickylyu@gmail.com -- the site's real founder + admin
  -- account. Stable, not expected to be regenerated; if it ever is, update
  -- this literal (and src/lib/founder.ts's FOUNDER_USER_ID) together.
  v_founder uuid := '11be6983-7cd6-434d-bb52-6bfaf1d6e309'::uuid;
  v_conversation_id uuid;
begin
  if old.has_onboarded = true or new.has_onboarded = false or new.id = v_founder then
    return new;
  end if;

  select cp1.conversation_id into v_conversation_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = v_founder and cp2.user_id = new.id;

  -- Idempotency: a real account can only ever cross false->true once in
  -- normal use. The only other way this fires again is
  -- admin_reset_test_account_onboarding() below, which explicitly clears
  -- any prior founder conversation first because it *wants* a fresh one --
  -- so this guard only matters for genuinely unexpected repeat firings.
  if v_conversation_id is not null and exists (
    select 1 from public.messages where conversation_id = v_conversation_id and sender_id = v_founder
  ) then
    return new;
  end if;

  if v_conversation_id is null then
    insert into public.conversations default values returning id into v_conversation_id;
    insert into public.conversation_participants (conversation_id, user_id) values
      (v_conversation_id, v_founder),
      (v_conversation_id, new.id);
  end if;

  -- Approved copy, verbatim -- not a template, not auto-translated (product
  -- decision: this is Micky's own personal voice, kept English-only for
  -- every user rather than risk a machine translation flattening the tone).
  insert into public.messages (conversation_id, sender_id, text) values (
    v_conversation_id,
    v_founder,
    'Hey! Welcome to GolfMe 👋 I’m Micky, the founder. I built GolfMe to make it easier to find golfers, join or host rounds, and actually get out and play. If you have any questions, feedback, or ideas, message me right here anytime — I read every message. Hope to see you on the course! ⛳'
  );

  return new;
end;
$function$;

-- create or replace keeps the existing grants, but restate the lockdown so
-- this file is correct on its own.
revoke execute on function public.notify_founder_welcome() from public, anon, authenticated;
