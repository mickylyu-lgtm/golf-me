-- Founder welcome chat: every genuinely new user gets a one-time welcome
-- DM from the real founder account (Micky's own real account, id below --
-- product decision: replies land in the inbox he already checks, not a
-- separate system persona). Fires server-side off profiles.has_onboarded
-- flipping false -> true, the same signal the client already uses to
-- distinguish "mid-onboarding" from "fully set up" (see create_profiles.sql)
-- -- never client-driven, so it can't be skipped/duplicated by a client
-- that never runs the right useEffect, matches this schema's existing
-- philosophy that notifications/side effects are a guaranteed consequence
-- of the real event (see notify_new_message and friends).
--
-- The resulting message insert is picked up by the existing
-- notify_new_message trigger (Phase 5), so the recipient's unread badge and
-- "new_message" notification come for free -- no new notification logic
-- needed here.
create function public.notify_founder_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    'Hey! Welcome to GolfMe 👋 I’m Micky, the founder of GolfMe. I built GolfMe to make it easier to find people to play with, organize rounds, and connect with other golfers. We’re still early, so I’d genuinely love to hear what you think as you use the app — what you like, what feels confusing, or anything you wish GolfMe had. You can message me right here anytime. Hope you enjoy it, and see you on the course! ⛳'
  );

  return new;
end;
$$;

revoke execute on function public.notify_founder_welcome() from public, anon, authenticated;

create trigger trg_notify_founder_welcome
  after update on public.profiles
  for each row execute function public.notify_founder_welcome();

-- Testing-only tool: real accounts only ever cross has_onboarded
-- false->true once, so there's no natural way to replay the first-time
-- flow on an existing test account. Admin-gated, explicitly clears any
-- prior founder conversation before resetting has_onboarded so the
-- trigger above creates a genuinely fresh one, not a no-op.
create function public.admin_reset_test_account_onboarding(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_founder uuid := '11be6983-7cd6-434d-bb52-6bfaf1d6e309'::uuid;
  v_conversation_id uuid;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Admin role required.';
  end if;
  if p_user_id = v_founder then
    raise exception 'Cannot reset the founder account.';
  end if;

  select cp1.conversation_id into v_conversation_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = v_founder and cp2.user_id = p_user_id;

  if v_conversation_id is not null then
    delete from public.conversations where id = v_conversation_id; -- cascades to participants + messages
  end if;

  update public.profiles set has_onboarded = false where id = p_user_id;
end;
$$;

revoke execute on function public.admin_reset_test_account_onboarding(uuid) from public, anon;
grant execute on function public.admin_reset_test_account_onboarding(uuid) to authenticated;
