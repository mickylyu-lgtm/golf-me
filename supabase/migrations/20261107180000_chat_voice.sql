-- Voice messages in chat: DMs and round group chats, WeChat-style "Hold to
-- talk" (Micky, 2026-11-06). PREPARED, NOT APPLIED: designed by
-- golfme-architect; apply only after Micky's sign-off. Requires
-- 20261107170000_chat_images (the guard below refuses without it).
--
-- Why a second migration rather than folding into 20261107170000 (neither
-- is applied): photos are finished, reviewed and tested on their own; this
-- keeps them shippable without voice, keeps their paste / check / rollback
-- files exactly as reviewed, and lets voice be rolled back without touching
-- photos. The cost is that this file re-creates a few of the photo
-- migration's objects (listed below) with audio added.
--
-- Same bucket, same rules as photos. One audio file per message, recorded
-- on the device with MediaRecorder (AAC in MP4 where possible, else
-- WebM/Opus; lib/chatVoice.ts says why), at most 60 s, stored privately:
--   chat-media/dm/<conversation_id>/<message_id>.m4a | .webm
--   chat-media/round/<round_id>/<message_id>.m4a | .webm
-- Nothing on the server listens to, transcodes or transcribes recordings.
--
-- 1. Bucket: allowed types become image/jpeg + audio/mp4 + audio/webm
--    (still private, still 2 MiB: 60 s of 64 kb/s AAC is ~0.5 MB).
-- 2. messages / round_messages gain audio_path and audio_duration_ms
--    (1..61000), folded into the same single text check as photos: a voice
--    message has no text and no photo; its path is exactly its own
--    <scope>/<id>.m4a or .webm; unsent rows have neither. Triggers
--    check_*_audio: the object must exist owned by the sender (authz first,
--    no oracle); audio can only ever be cleared.
-- 3. Re-created with audio added (bodies otherwise identical to
--    20261107170000): private.can_upload_chat_image (path may end .jpg,
--    .m4a or .webm), private.chat_image_in_use, private.chat_image_reported,
--    the chat_media_select_visible policy (a readable row's audio_path also
--    grants read). The insert and delete policies are unchanged (they call
--    those functions). Still no UPDATE policy.
-- 4. unsend_message / unsend_round_message also clear the audio. Hidden
--    admin copy: text only, as for photos (a voice message has no text: the
--    copy row holds ''). The client deletes the file via the Storage API.
-- 5. notify_new_message: bell "<name> sent a voice message.", push
--    "<name> sent a voice message" (title: the sender's name).
-- 6. public.admin_list_report_chat_voice(report_id): admin only, same
--    report scope as photos.
-- Account deletion: public.chat_media_paths_for_user already lists every
-- object the user owns in chat-media, audio included.
--
-- Client rollout: feature-detected (a select of audio_path), the mic button
-- also needs a browser that can record. Deploy the client first.
-- Verify: chat-voice-check.sql. Rollback: chat-voice-rollback.sql.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'messages' and column_name = 'image_path')
     or to_regprocedure('private.can_upload_chat_image(text)') is null then
    raise exception '20261107180000_chat_voice needs 20261107170000_chat_images applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'audio/mp4', 'audio/webm']
 where id = 'chat-media';

-- ---------------------------------------------------------------------------
-- 2. Columns, checks, triggers
-- ---------------------------------------------------------------------------

alter table public.messages
  add column audio_path        text null,
  add column audio_duration_ms integer null;

alter table public.round_messages
  add column audio_path        text null,
  add column audio_duration_ms integer null;

alter table public.messages drop constraint messages_text_check;
alter table public.messages
  add constraint messages_text_check check (
    (char_length(text) > 0 or image_path is not null or audio_path is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or (image_path is null and audio_path is null))
    and (image_path is null or audio_path is null)
    and (
      (image_path is null and image_width is null and image_height is null and image_thumb is null)
      or coalesce(
        image_path = 'dm/' || conversation_id::text || '/' || id::text || '.jpg'
        and image_width between 1 and 4096
        and image_height between 1 and 4096
        and (image_thumb is null or (char_length(image_thumb) <= 2048 and image_thumb ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
        false
      )
    )
    and (
      (audio_path is null and audio_duration_ms is null)
      or coalesce(
        audio_path in ('dm/' || conversation_id::text || '/' || id::text || '.m4a',
                       'dm/' || conversation_id::text || '/' || id::text || '.webm')
        and audio_duration_ms between 1 and 61000
        and text = '',
        false
      )
    )
  );

alter table public.round_messages drop constraint round_messages_text_check;
alter table public.round_messages
  add constraint round_messages_text_check check (
    (length(text) > 0 or image_path is not null or audio_path is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or (image_path is null and audio_path is null))
    and (image_path is null or audio_path is null)
    and (
      (image_path is null and image_width is null and image_height is null and image_thumb is null)
      or coalesce(
        image_path = 'round/' || round_id::text || '/' || id::text || '.jpg'
        and image_width between 1 and 4096
        and image_height between 1 and 4096
        and (image_thumb is null or (char_length(image_thumb) <= 2048 and image_thumb ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
        false
      )
    )
    and (
      (audio_path is null and audio_duration_ms is null)
      or coalesce(
        audio_path in ('round/' || round_id::text || '/' || id::text || '.m4a',
                       'round/' || round_id::text || '/' || id::text || '.webm')
        and audio_duration_ms between 1 and 61000
        and text = '',
        false
      )
    )
  );

create index messages_audio_path_idx on public.messages (audio_path) where audio_path is not null;
create index round_messages_audio_path_idx on public.round_messages (audio_path) where audio_path is not null;

create function private.check_message_audio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.audio_path, new.audio_duration_ms) is distinct from (old.audio_path, old.audio_duration_ms)
       and not (new.audio_path is null and new.audio_duration_ms is null) then
      raise exception 'audio_immutable: a voice message can only be removed.'
        using errcode = '42501', hint = 'audio_immutable';
    end if;
    return new;
  end if;
  if new.audio_path is null then
    return new;
  end if;
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_conversation_participant(new.conversation_id)) then
    return new;
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-media' and o.name = new.audio_path and o.owner_id = new.sender_id::text
  ) then
    raise exception 'audio_not_uploaded: upload the recording before sending it.'
      using errcode = '42501', hint = 'audio_not_uploaded';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_message_audio() from public, anon, authenticated;

create trigger check_message_audio
  before insert or update of audio_path, audio_duration_ms on public.messages
  for each row execute function private.check_message_audio();

create function private.check_round_message_audio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.audio_path, new.audio_duration_ms) is distinct from (old.audio_path, old.audio_duration_ms)
       and not (new.audio_path is null and new.audio_duration_ms is null) then
      raise exception 'audio_immutable: a voice message can only be removed.'
        using errcode = '42501', hint = 'audio_immutable';
    end if;
    return new;
  end if;
  if new.audio_path is null then
    return new;
  end if;
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_round_member(new.round_id)) then
    return new;
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-media' and o.name = new.audio_path and o.owner_id = new.sender_id::text
  ) then
    raise exception 'audio_not_uploaded: upload the recording before sending it.'
      using errcode = '42501', hint = 'audio_not_uploaded';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_round_message_audio() from public, anon, authenticated;

create trigger check_round_message_audio
  before insert or update of audio_path, audio_duration_ms on public.round_messages
  for each row execute function private.check_round_message_audio();

-- ---------------------------------------------------------------------------
-- 3. Storage helpers + read policy, audio added
-- ---------------------------------------------------------------------------

create or replace function private.can_upload_chat_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[];
  v_scope uuid;
  v_message uuid;
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  -- .jpg (photo), .m4a / .webm (voice, 20261107180000).
  v_parts := regexp_match(
    p_name,
    '^(dm|round)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|m4a|webm)$'
  );
  if v_parts is null then
    return false;
  end if;
  v_scope := v_parts[2]::uuid;
  v_message := v_parts[3]::uuid;
  if v_parts[1] = 'dm' then
    return exists (
        select 1 from public.conversation_participants cp
         where cp.conversation_id = v_scope and cp.user_id = v_uid)
      and not exists (
        select 1 from public.conversation_participants cp
         where cp.conversation_id = v_scope and cp.user_id <> v_uid
           and private.has_block_between(v_uid, cp.user_id))
      and not exists (select 1 from public.messages m where m.id = v_message);
  end if;
  return private.is_round_member(v_scope)
    and exists (
      select 1 from public.golf_calls gc
       where gc.id = v_scope and gc.status in ('open', 'full')
         and not private.has_block_between(v_uid, gc.host_user_id))
    and not exists (select 1 from public.round_messages m where m.id = v_message);
end;
$$;

create or replace function private.chat_image_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.messages m where m.image_path = p_name or m.audio_path = p_name)
      or exists (select 1 from public.round_messages m where m.image_path = p_name or m.audio_path = p_name);
$$;

create or replace function private.chat_image_reported(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(auth.uid(), 'admin') and (
    exists (
      select 1
        from public.messages m
        join public.reports r on r.reported_user_id = m.sender_id
       where (m.image_path = p_name or m.audio_path = p_name)
         and (r.reported_message_id = m.id
              or (r.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = r.reporter_id))))
    or exists (
      select 1
        from public.round_messages m
        join public.reports r on r.reported_user_id = m.sender_id and r.round_id = m.round_id
       where (m.image_path = p_name or m.audio_path = p_name))
  );
$$;

drop policy chat_media_select_visible on storage.objects;
create policy chat_media_select_visible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      owner_id = (select auth.uid())::text
      -- Runs under messages / round_messages RLS: "I can read that message".
      or exists (select 1 from public.messages m where m.image_path = objects.name)
      or exists (select 1 from public.round_messages m where m.image_path = objects.name)
      or exists (select 1 from public.messages m where m.audio_path = objects.name)
      or exists (select 1 from public.round_messages m where m.audio_path = objects.name)
      or private.chat_image_reported(objects.name)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Unsend clears photo and voice (text-only hidden copy, unchanged)
-- ---------------------------------------------------------------------------

create or replace function public.unsend_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'unsend_not_allowed: sign in to unsend.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- Row lock: two taps (or two devices) can't race each other.
  select * into v_msg from public.messages where id = p_message_id for update;

  -- Same error for "no such message" and "not yours", so this can't be used
  -- to probe other conversations' message ids.
  if not found or v_msg.sender_id <> v_uid then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  if v_msg.unsent_at is not null then
    return 'already_unsent';
  end if;

  if v_msg.created_at <= v_now - interval '5 minutes' then
    raise exception 'unsend_window_expired: messages can only be unsent within 5 minutes.'
      using errcode = 'P0001', hint = 'unsend_window_expired';
  end if;

  -- Hidden copy first, same transaction. Text only: neither a photo nor a
  -- voice recording is kept (20261107170000, 20261107180000).
  insert into private.unsent_message_copies
    (message_id, conversation_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.conversation_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Photo and voice go with the text: no row points at the file any more,
  -- so only its owner can read it; the client then deletes it.
  update public.messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null,
         audio_path = null, audio_duration_ms = null
   where id = p_message_id;

  delete from public.notifications n
   where n.type = 'new_message'
     and n.actor_id = v_msg.sender_id
     and n.created_at = v_msg.created_at
     and n.user_id in (
       select cp.user_id
       from public.conversation_participants cp
       where cp.conversation_id = v_msg.conversation_id
         and cp.user_id <> v_msg.sender_id
     );

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_message(uuid) from public, anon;
grant execute on function public.unsend_message(uuid) to authenticated;

create or replace function public.unsend_round_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.round_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- 1. Authorize. No lock, and nothing about the message's state decides
  --    the error: missing, someone else's, or a round I'm no longer in all
  --    read the same.
  select * into v_msg from public.round_messages where id = p_message_id;
  if not found or v_msg.sender_id <> v_uid or not private.is_round_member(v_msg.round_id) then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- 2. Row lock (two taps or two devices can't race), then re-read.
  select * into v_msg from public.round_messages where id = p_message_id for update;
  if not found then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  if v_msg.unsent_at is not null then
    return 'already_unsent';
  end if;

  if v_msg.created_at <= v_now - interval '5 minutes' then
    raise exception 'unsend_window_expired: messages can only be unsent within 5 minutes.'
      using errcode = 'P0001', hint = 'unsend_window_expired';
  end if;

  -- Hidden copy first, same transaction. Text only (20261107170000, 20261107180000).
  insert into private.unsent_round_message_copies
    (message_id, round_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.round_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Fires round_messages_clear_reactions_on_unsend. Photo and voice go with
  -- the text; the client then deletes the file.
  update public.round_messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null,
         audio_path = null, audio_duration_ms = null
   where id = p_message_id;

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_round_message(uuid) from public, anon;
grant execute on function public.unsend_round_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. DM notification + push text for voice
-- ---------------------------------------------------------------------------

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
  v_photo boolean := new.image_path is not null;
  v_voice boolean := new.audio_path is not null;
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id,
         coalesce(v_sender_name, 'A golfer') ||
           case when v_voice then ' sent a voice message.' when v_photo then ' sent a photo.' else ' sent you a message.' end,
         '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    v_preview := btrim(regexp_replace(coalesce(new.text, ''), '\s+', ' ', 'g'));
    if v_voice then
      v_preview := coalesce(v_sender_name, 'A golfer') || ' sent a voice message';
    elsif v_preview = '' then
      v_preview := case when v_photo then coalesce(v_sender_name, 'A golfer') || ' sent a photo' else 'Sent you a new message' end;
    else
      if char_length(v_preview) > 100 then
        v_preview := left(v_preview, 99);
        v_preview := rtrim(coalesce(substring(v_preview from '^(.{60,}) '), v_preview)) || '…';
      end if;
      if v_photo then
        v_preview := '📷 ' || v_preview;
      end if;
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

revoke execute on function public.notify_new_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Moderation: a report's voice messages (admin only)
-- ---------------------------------------------------------------------------

create function public.admin_list_report_chat_voice(p_report_id uuid)
returns table (
  message_id uuid,
  chat text,
  audio_path text,
  duration_ms integer,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report public.reports%rowtype;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into v_report from public.reports where id = p_report_id;
  if not found or v_report.reported_user_id is null then
    return;
  end if;
  return query
  select x.message_id, x.chat, x.audio_path, x.duration_ms, x.sent_at
    from (
      select m.id as message_id, 'dm'::text as chat, m.audio_path, m.audio_duration_ms as duration_ms, m.created_at as sent_at
        from public.messages m
       where m.audio_path is not null
         and m.sender_id = v_report.reported_user_id
         and (m.id = v_report.reported_message_id
              or (v_report.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = v_report.reporter_id)))
      union all
      select m.id, 'round'::text, m.audio_path, m.audio_duration_ms, m.created_at
        from public.round_messages m
       where m.audio_path is not null
         and m.sender_id = v_report.reported_user_id
         and v_report.round_id is not null
         and m.round_id = v_report.round_id
    ) x
   order by x.sent_at desc
   limit 50;
end;
$$;

revoke execute on function public.admin_list_report_chat_voice(uuid) from public, anon;
grant execute on function public.admin_list_report_chat_voice(uuid) to authenticated;

notify pgrst, 'reload schema';
