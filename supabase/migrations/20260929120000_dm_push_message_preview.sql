-- DM push notifications show a preview of the message again (approved by
-- Micky 2026-09-29), reversing the 2026-09-16 generic-body decision in
-- 20260916190000: iOS users control lock-screen previews themselves
-- (Settings -> Notifications -> Show Previews).
--
-- Only the push BODY changes. Unchanged: the push title (sender name, "A
-- golfer" fallback), link_to ('/messages/<sender>', so a tap still opens the
-- DM thread), the in-app notifications row ("<name> sent you a message."),
-- recipient selection, the push_enabled check and the Vault secret lookup.
--
-- Preview: whitespace/newlines collapsed to single spaces; over 100
-- characters it is cut at the last word break after character 60 (or hard
-- at 99 if there is none) and ends with "…"; blank text falls back to
-- "Sent you a new message".
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
  v_preview text;
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id, coalesce(v_sender_name, 'A golfer') || ' sent you a message.', '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    v_preview := btrim(regexp_replace(coalesce(new.text, ''), '\s+', ' ', 'g'));
    if v_preview = '' then
      v_preview := 'Sent you a new message';
    elsif char_length(v_preview) > 100 then
      v_preview := left(v_preview, 99);
      v_preview := rtrim(coalesce(substring(v_preview from '^(.{60,}) '), v_preview)) || '…';
    end if;

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
          'body', v_preview,
          'link_to', '/messages/' || new.sender_id
        ),
        timeout_milliseconds := 5000
      );
    end loop;
  end if;

  return new;
end;
$function$;

-- create or replace keeps the existing grants; restated so this file stands
-- on its own (trigger functions are never called directly).
revoke execute on function public.notify_new_message() from public, anon, authenticated;
