-- Phase A of the push-notifications follow-up (audit approved 2026-09-16):
-- 1. Message push now uses the same privacy-preserving copy the in-app row
--    already uses, instead of the raw message body, for lock-screen safety.
-- 2. A client-facing delete policy on device_push_tokens, so a signed-in
--    user can remove their OWN device's token on logout (src/lib/push.ts's
--    new unregisterPushNotifications()) -- previously there was no way for
--    a logged-out device to stop being a valid push target short of Apple
--    eventually 410-ing a stale token.
-- 3/4. Extends the same "insert notification -> if secret configured, call
--    send-push" pattern notify_new_message() already has to
--    notify_round_joined() and notify_caddie_analysis_complete() -- no new
--    architecture, same trigger-guarded idempotency each already had
--    (round_participants' unique(round_id,user_id) for joins; the existing
--    old.status is distinct from 'complete' transition guard for Caddie).

create policy "device_push_tokens_delete_own" on public.device_push_tokens
  for delete using (auth.uid() = user_id);

-- Same as before except the push body: was the raw message text (a
-- lock-screen privacy leak independent of the recipient's own iOS "Show
-- Previews" setting), now the same generic "<name> sent you a message."
-- already used for the in-app notification row two lines above it.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sender_name text;
  v_push_secret text;
  v_recipient record;
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id, coalesce(v_sender_name, 'A golfer') || ' sent you a message.', '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    for v_recipient in
      select cp.user_id
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id and p.push_enabled
    loop
      perform net.http_post(
        url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'user_id', v_recipient.user_id,
          'title', coalesce(v_sender_name, 'A golfer'),
          'body', coalesce(v_sender_name, 'A golfer') || ' sent you a message.',
          'link_to', '/messages/' || new.sender_id
        ),
        timeout_milliseconds := 5000
      );
    end loop;
  end if;

  return new;
end;
$function$;

-- Round activity, V1 scope: joins only ("starting with a reliable someone
-- joined your round event" -- round_left/round_cancelled push deliberately
-- left for a later pass, not part of this approval). Enriched with the
-- course name (already on golf_calls, no new query) to match the actual
-- example text from the brief ("Nathan joined your round at Skyway Golf
-- Course") -- applied to BOTH the in-app row and the push for the same
-- "one authoritative event, one piece of copy" reason every other trigger
-- here already follows.
create or replace function public.notify_round_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_host uuid;
  v_course_name text;
  v_joiner_name text;
  v_text text;
  v_push_secret text;
  v_host_push_enabled boolean;
begin
  if new.participant_status <> 'joined' then
    return new;
  end if;
  select host_user_id, course_name into v_host, v_course_name from public.golf_calls where id = new.round_id;
  if v_host is null or v_host = new.user_id then
    return new; -- the host's own seat at hosting time, not a real "someone joined" event
  end if;
  select name into v_joiner_name from public.profiles where id = new.user_id;
  v_text := coalesce(v_joiner_name, 'A golfer') || ' joined your round' || coalesce(' at ' || v_course_name, '') || '.';

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_host, 'round_joined', new.user_id, v_text, '/golf-calls/' || new.round_id);

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    select push_enabled into v_host_push_enabled from public.profiles where id = v_host;
    if v_host_push_enabled then
      perform net.http_post(
        url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'user_id', v_host,
          'title', coalesce(v_joiner_name, 'A golfer'),
          'body', v_text,
          'link_to', '/golf-calls/' || new.round_id
        ),
        timeout_milliseconds := 5000
      );
    end if;
  end if;

  return new;
end;
$function$;

-- Caddie ready -- push nested inside the SAME status-transition guard the
-- in-app insert already uses (old.status is distinct from 'complete'), not
-- a second independent check -- a retried/duplicate completion callback
-- that re-runs this UPDATE still can't fire twice, since old.status is
-- already 'complete' on the second pass.
create or replace function public.notify_caddie_analysis_complete()
returns trigger
security definer
set search_path = ''
language plpgsql
as $function$
declare
  v_push_secret text;
  v_push_enabled boolean;
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (new.owner_id, 'caddie_analysis_complete', null, 'Caddie finished analyzing your swing.', '/caddie/' || new.id);

    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    if v_push_secret is not null then
      select push_enabled into v_push_enabled from public.profiles where id = new.owner_id;
      if v_push_enabled then
        perform net.http_post(
          url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'user_id', new.owner_id,
            'title', 'GolfMe Caddie',
            'body', 'Caddie finished analyzing your swing.',
            'link_to', '/caddie/' || new.id
          ),
          timeout_milliseconds := 5000
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.notify_round_joined() from public, anon, authenticated;
revoke execute on function public.notify_caddie_analysis_complete() from public, anon, authenticated;
