-- Video messages and albums (several photos / videos in one message) in
-- chat: DMs and round group chats. Micky, 2026-11-06: video plan approved
-- ("yes for all": 60 s max, server-side transcode on our own
-- infrastructure, 180-day retention, one picker), then the album scope
-- ("select multiple photos ... including videos ... like a deck of
-- cards"). PREPARED, NOT APPLIED: golfme-architect; apply only after
-- Micky's sign-off. Requires 20261107180000_chat_voice (guard below).
--
-- Data model: ONE jsonb column, `media`, on messages and round_messages:
-- an ordered array of 1..10 items. A single video is a 1-item array; an
-- album is 2..10 items (photos and videos mixed). Single photos and voice
-- messages keep their existing columns (image_* / audio_*) and paths
-- exactly as today; existing rows are untouched. A message carries at most
-- one of image_path / audio_path / media.
--   {"kind":"image","path":"<p>/<i>.jpg","w":1600,"h":1200,"thumb":"data:image/jpeg;base64,..."}
--   {"kind":"video","path":"<p>/<i>.mp4","poster":"<p>/<i>.poster.jpg","w":1280,"h":720,"ms":12340}
--   {"kind":"video","expired":true,"w":1280,"h":720,"ms":12340}   (after 180 days)
-- where <p> = dm/<conversation_id>/<message_id> or round/<round_id>/<message_id>
-- and <i> = the item's position (0..9). The path is a pure function of the
-- row and the position, so the CHECK can verify it without a lookup.
--
-- Why jsonb rather than a child table: a child table needs its own RLS
-- (mirroring two parent tables), a second insert after the message (a
-- recipient's realtime refetch would see an album with no items), or a
-- SECURITY DEFINER send RPC duplicating the messages insert policy (block
-- checks, round status, objectionable-content trigger). jsonb rides on the
-- existing row: the same insert policy, the same RLS, the same realtime
-- event, unsend is one column, account deletion cascades with the row.
-- Storage ownership is checked per item by the trigger below; storage
-- read access uses a GIN (jsonb_path_ops) containment lookup.
--
-- Storage:
--   chat-video (private, 25 MiB, video/mp4 + image/jpeg): every media
--     item: album photos (<i>.jpg, <= 2 MiB, checked by the trigger from
--     the object's stored size), transcoded videos (<i>.mp4) and their
--     posters (<i>.poster.jpg). Videos are written by api/chat-video.ts
--     (Vercel, ffmpeg) with the SENDER's forwarded JWT, so owner_id is the
--     sender and the same policies apply.
--   chat-video-incoming (private, 200 MiB, video/*): the sender's original,
--     uploaded with a resumable (TUS) upload to <user_id>/<message_id>-<i>.orig,
--     owner-only, deleted by api/chat-video.ts after transcoding; leftovers
--     are swept after a day.
--
-- 1. Buckets + storage policies (same shape as chat-media: INSERT member +
--    unused message id, SELECT owner / readable row / admin+report, DELETE
--    own and unused; no UPDATE anywhere).
-- 2. messages / round_messages.media, folded into the single text check
--    (round chat's check file counts exactly one check constraint), a GIN
--    index each.
-- 3. Triggers check_*_media: on insert every item's objects must exist in
--    chat-video owned by the sender (authorization first: no oracle), photo
--    items <= 2 MiB; on update media can only be cleared (unsend) or a
--    video item expired (retention), never set or changed.
-- 4. unsend_message / unsend_round_message also clear media (hidden copy
--    stays text only); the client deletes the objects via the Storage API.
-- 5. notify_new_message: "<name> sent a video." / "sent 3 photos." /
--    "sent 2 photos and 1 video."; and the photo-with-caption push no
--    longer starts with an emoji: "[Photo] <caption>" (Micky's no-emoji
--    rule), "[Video] <caption>" / "[Album] <caption>" for media.
-- 6. public.admin_list_report_chat_media(report_id): admin only.
-- 7. public.chat_media_paths_for_user(user_id, bucket): service role only,
--    for delete-account (chat-media, chat-video, chat-video-incoming). The
--    one-argument version (chat-media) is unchanged, so an old
--    delete-account keeps working.
-- 8. Retention (180 days, videos only; photos are kept like single
--    photos): public.chat_video_expire_due(limit) turns due video items
--    into {"kind":"video","expired":true,...} and returns the objects to
--    delete; public.chat_video_orphans(limit) lists chat-video objects no
--    row points at and staged originals, older than a day. Both service
--    role only. A video whose message is under an OPEN report is kept until
--    the report is resolved. Objects can't be deleted from SQL
--    (storage.protect_delete), so the chat-video-retention Edge Function
--    calls these and removes the objects through the Storage API. It is
--    scheduled daily here if pg_cron is already installed; otherwise
--    chat-video-schedule.sql (scratchpad) enables pg_cron and schedules it.
--    The job authenticates with the existing push_internal_secret (Vault +
--    PUSH_INTERNAL_SECRET function secret), no new secret.
--
-- Client rollout: feature-detected (a select of messages.media); photos and
-- voice keep working before this is applied. Deploy the client first.
-- Verify: chat-video-check.sql. Rollback: chat-video-rollback.sql.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'messages' and column_name = 'audio_path') then
    raise exception '20261107220000_chat_video_albums needs 20261107180000_chat_voice applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-video', 'chat-video', false, 26214400, array['video/mp4', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-video-incoming', 'chat-video-incoming', false, 209715200, array['video/*'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. The media column, its validation and the folded checks
-- ---------------------------------------------------------------------------

alter table public.messages add column media jsonb null;
alter table public.round_messages add column media jsonb null;

-- Shape of a media array for the row whose items live under p_prefix
-- (dm/<conversation>/<message> or round/<round>/<message>). Pure: no table
-- reads, so it can sit in a CHECK. Any malformed value is false, never an
-- error.
create function private.chat_media_valid(p_media jsonb, p_prefix text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row record;
  v_item jsonb;
  v_i integer;
  v_kind text;
  v_key text;
begin
  if p_media is null then
    return true;
  end if;
  if p_prefix is null or jsonb_typeof(p_media) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_media) < 1 or jsonb_array_length(p_media) > 10 then
    return false;
  end if;
  for v_row in select e, (o - 1)::integer as i from jsonb_array_elements(p_media) with ordinality as t(e, o) loop
    v_item := v_row.e;
    v_i := v_row.i;
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    v_kind := v_item ->> 'kind';
    if v_kind is null or v_kind not in ('image', 'video') then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_kind = 'image' and v_key not in ('kind', 'path', 'w', 'h', 'thumb') then
        return false;
      end if;
      if v_kind = 'video' and v_key not in ('kind', 'path', 'poster', 'w', 'h', 'ms', 'expired') then
        return false;
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'w') is distinct from 'number' or jsonb_typeof(v_item -> 'h') is distinct from 'number' then
      return false;
    end if;
    if (v_item ->> 'w')::numeric <> trunc((v_item ->> 'w')::numeric) or (v_item ->> 'w')::numeric not between 1 and 4096
       or (v_item ->> 'h')::numeric <> trunc((v_item ->> 'h')::numeric) or (v_item ->> 'h')::numeric not between 1 and 4096 then
      return false;
    end if;
    if v_kind = 'image' then
      if (v_item ->> 'path') is distinct from (p_prefix || '/' || v_i || '.jpg') then
        return false;
      end if;
      if v_item ? 'thumb' and v_item -> 'thumb' <> 'null'::jsonb
         and not (jsonb_typeof(v_item -> 'thumb') = 'string'
                  and char_length(v_item ->> 'thumb') <= 2048
                  and (v_item ->> 'thumb') ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
        return false;
      end if;
    else
      if jsonb_typeof(v_item -> 'ms') is distinct from 'number'
         or (v_item ->> 'ms')::numeric <> trunc((v_item ->> 'ms')::numeric)
         or (v_item ->> 'ms')::numeric not between 1 and 61000 then
        return false;
      end if;
      if v_item ? 'expired' then
        if v_item -> 'expired' <> 'true'::jsonb or v_item ? 'path' or v_item ? 'poster' then
          return false;
        end if;
      else
        if (v_item ->> 'path') is distinct from (p_prefix || '/' || v_i || '.mp4')
           or (v_item ->> 'poster') is distinct from (p_prefix || '/' || v_i || '.poster.jpg') then
          return false;
        end if;
      end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

revoke execute on function private.chat_media_valid(jsonb, text) from public, anon;
-- Evaluated by the tables' CHECK as the inserting role.
grant execute on function private.chat_media_valid(jsonb, text) to authenticated, service_role;

alter table public.messages drop constraint messages_text_check;
alter table public.messages
  add constraint messages_text_check check (
    (char_length(text) > 0 or image_path is not null or audio_path is not null or media is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or (image_path is null and audio_path is null and media is null))
    and (image_path is null or audio_path is null)
    and num_nonnulls(image_path, audio_path, media) <= 1
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
    and coalesce(private.chat_media_valid(media, 'dm/' || conversation_id::text || '/' || id::text), false)
  );

alter table public.round_messages drop constraint round_messages_text_check;
alter table public.round_messages
  add constraint round_messages_text_check check (
    (length(text) > 0 or image_path is not null or audio_path is not null or media is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or (image_path is null and audio_path is null and media is null))
    and (image_path is null or audio_path is null)
    and num_nonnulls(image_path, audio_path, media) <= 1
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
    and coalesce(private.chat_media_valid(media, 'round/' || round_id::text || '/' || id::text), false)
  );

create index messages_media_idx on public.messages using gin (media jsonb_path_ops) where media is not null;
create index round_messages_media_idx on public.round_messages using gin (media jsonb_path_ops) where media is not null;

-- ---------------------------------------------------------------------------
-- 3. Triggers: objects exist and are the sender's; media only shrinks
-- ---------------------------------------------------------------------------

-- The only allowed changes to a stored media array: cleared (unsend), or
-- video items turned into their expired form (retention), item by item.
create function private.chat_media_change_allowed(p_old jsonb, p_new jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_i integer;
  v_old jsonb;
  v_new jsonb;
begin
  if p_new is null then
    return true;
  end if;
  if p_old is null or jsonb_typeof(p_old) <> 'array' or jsonb_typeof(p_new) <> 'array'
     or jsonb_array_length(p_old) <> jsonb_array_length(p_new) then
    return false;
  end if;
  for v_i in 0 .. jsonb_array_length(p_old) - 1 loop
    v_old := p_old -> v_i;
    v_new := p_new -> v_i;
    if v_new = v_old then
      continue;
    end if;
    if v_old ->> 'kind' = 'video' and v_new = ((v_old - 'path' - 'poster') || '{"expired": true}'::jsonb) then
      continue;
    end if;
    return false;
  end loop;
  return true;
end;
$$;

revoke execute on function private.chat_media_change_allowed(jsonb, jsonb) from public, anon, authenticated;

create function private.chat_media_objects_ok(p_media jsonb, p_sender uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_size bigint;
begin
  for v_item in select e from jsonb_array_elements(p_media) as t(e) loop
    foreach v_name in array array[v_item ->> 'path', v_item ->> 'poster'] loop
      continue when v_name is null;
      select coalesce((o.metadata ->> 'size')::bigint, 0) into v_size
        from storage.objects o
       where o.bucket_id = 'chat-video' and o.name = v_name and o.owner_id = p_sender::text;
      if not found then
        return 'media_not_uploaded';
      end if;
      -- An album photo has the single-photo limit (the client re-encodes
      -- to <= 2 MiB); the bucket's own limit (25 MiB) is for videos.
      if v_item ->> 'kind' = 'image' and v_size > 2097152 then
        return 'media_too_large';
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

revoke execute on function private.chat_media_objects_ok(jsonb, uuid) from public, anon, authenticated;

create function private.check_message_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_problem text;
begin
  if tg_op = 'UPDATE' then
    if new.media is distinct from old.media and not private.chat_media_change_allowed(old.media, new.media) then
      raise exception 'media_immutable: photos and videos in a message can only be removed.'
        using errcode = '42501', hint = 'media_immutable';
    end if;
    return new;
  end if;
  if new.media is null then
    return new;
  end if;
  -- Authorization first: someone who isn't the sender / in the chat gets
  -- the plain RLS refusal, never a hint about which objects exist.
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_conversation_participant(new.conversation_id)) then
    return new;
  end if;
  -- A malformed array is refused by the CHECK (which runs after BEFORE
  -- triggers): don't look anything up for it.
  if not private.chat_media_valid(new.media, 'dm/' || new.conversation_id::text || '/' || new.id::text) then
    return new;
  end if;
  v_problem := private.chat_media_objects_ok(new.media, new.sender_id);
  if v_problem is not null then
    raise exception '%: upload every photo and video before sending them.', v_problem
      using errcode = '42501', hint = v_problem;
  end if;
  return new;
end;
$$;

revoke execute on function private.check_message_media() from public, anon, authenticated;

create trigger check_message_media
  before insert or update of media on public.messages
  for each row execute function private.check_message_media();

create function private.check_round_message_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_problem text;
begin
  if tg_op = 'UPDATE' then
    if new.media is distinct from old.media and not private.chat_media_change_allowed(old.media, new.media) then
      raise exception 'media_immutable: photos and videos in a message can only be removed.'
        using errcode = '42501', hint = 'media_immutable';
    end if;
    return new;
  end if;
  if new.media is null then
    return new;
  end if;
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_round_member(new.round_id)) then
    return new;
  end if;
  if not private.chat_media_valid(new.media, 'round/' || new.round_id::text || '/' || new.id::text) then
    return new;
  end if;
  v_problem := private.chat_media_objects_ok(new.media, new.sender_id);
  if v_problem is not null then
    raise exception '%: upload every photo and video before sending them.', v_problem
      using errcode = '42501', hint = v_problem;
  end if;
  return new;
end;
$$;

revoke execute on function private.check_round_message_media() from public, anon, authenticated;

create trigger check_round_message_media
  before insert or update of media on public.round_messages
  for each row execute function private.check_round_message_media();

-- ---------------------------------------------------------------------------
-- 1b. Storage helpers and policies (chat-video, chat-video-incoming)
-- ---------------------------------------------------------------------------

-- <scope>/<scope id>/<message id>/<i>.jpg | <i>.mp4 | <i>.poster.jpg, i = 0..9,
-- under the same membership rules as chat photos (private.can_upload_chat_image).
create function private.can_upload_chat_video(p_name text)
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
  v_parts := regexp_match(
    p_name,
    '^(dm|round)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9]\.(jpg|mp4|poster\.jpg)$'
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

-- Whether ANY row (visible to me or not) points at the object.
create function private.chat_video_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.messages m
                  where m.media @> jsonb_build_array(jsonb_build_object('path', p_name))
                     or m.media @> jsonb_build_array(jsonb_build_object('poster', p_name)))
      or exists (select 1 from public.round_messages m
                  where m.media @> jsonb_build_array(jsonb_build_object('path', p_name))
                     or m.media @> jsonb_build_array(jsonb_build_object('poster', p_name)));
$$;

-- Admin, and the object belongs to a message of a golfer reported in that
-- chat (same scope as private.chat_image_reported).
create function private.chat_video_reported(p_name text)
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
       where (m.media @> jsonb_build_array(jsonb_build_object('path', p_name))
              or m.media @> jsonb_build_array(jsonb_build_object('poster', p_name)))
         and (r.reported_message_id = m.id
              or (r.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = r.reporter_id))))
    or exists (
      select 1
        from public.round_messages m
        join public.reports r on r.reported_user_id = m.sender_id and r.round_id = m.round_id
       where m.media @> jsonb_build_array(jsonb_build_object('path', p_name))
          or m.media @> jsonb_build_array(jsonb_build_object('poster', p_name)))
  );
$$;

revoke execute on function private.can_upload_chat_video(text) from public, anon;
revoke execute on function private.chat_video_in_use(text) from public, anon;
revoke execute on function private.chat_video_reported(text) from public, anon;
-- Called from the storage policies, so the calling role needs EXECUTE.
grant execute on function private.can_upload_chat_video(text) to authenticated;
grant execute on function private.chat_video_in_use(text) to authenticated;
grant execute on function private.chat_video_reported(text) to authenticated;

create policy chat_video_insert_member on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-video'
    and owner_id = (select auth.uid())::text
    and private.can_upload_chat_video(name)
  );

create policy chat_video_select_visible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-video'
    and (
      owner_id = (select auth.uid())::text
      -- Runs under messages / round_messages RLS: "I can read that message".
      or exists (select 1 from public.messages m where m.media @> jsonb_build_array(jsonb_build_object('path', objects.name)))
      or exists (select 1 from public.messages m where m.media @> jsonb_build_array(jsonb_build_object('poster', objects.name)))
      or exists (select 1 from public.round_messages m where m.media @> jsonb_build_array(jsonb_build_object('path', objects.name)))
      or exists (select 1 from public.round_messages m where m.media @> jsonb_build_array(jsonb_build_object('poster', objects.name)))
      or private.chat_video_reported(objects.name)
    )
  );

create policy chat_video_delete_own_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-video'
    and owner_id = (select auth.uid())::text
    and not private.chat_video_in_use(objects.name)
  );

-- Staging: <my user id>/<message id>-<i>.orig, mine only.
create policy chat_video_incoming_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-video-incoming'
    and owner_id = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]\.orig$')
  );

create policy chat_video_incoming_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-video-incoming' and owner_id = (select auth.uid())::text);

create policy chat_video_incoming_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-video-incoming' and owner_id = (select auth.uid())::text);

-- The transcoder's early "may this golfer post here?" check (the storage
-- INSERT policy above is the real gate). p_scope 'dm' | 'round'.
create function public.chat_video_can_post(p_scope text, p_scope_id uuid, p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_upload_chat_video(
    p_scope || '/' || p_scope_id::text || '/' || p_message_id::text || '/0.mp4'
  ) and p_scope in ('dm', 'round');
$$;

revoke execute on function public.chat_video_can_post(text, uuid, uuid) from public, anon;
grant execute on function public.chat_video_can_post(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Unsend clears media too (text-only hidden copy, unchanged)
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

  -- Hidden copy first, same transaction. Text only: no photo, voice
  -- recording or video is kept (20261107170000, 20261107180000, 20261107220000).
  insert into private.unsent_message_copies
    (message_id, conversation_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.conversation_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Media goes with the text: no row points at the files any more, so only
  -- their owner can read them; the client then deletes them.
  update public.messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null,
         audio_path = null, audio_duration_ms = null,
         media = null
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

  -- Hidden copy first, same transaction. Text only.
  insert into private.unsent_round_message_copies
    (message_id, round_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.round_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Fires round_messages_clear_reactions_on_unsend. Photo, voice and media
  -- go with the text; the client then deletes the files.
  update public.round_messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null,
         audio_path = null, audio_duration_ms = null,
         media = null
   where id = p_message_id;

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_round_message(uuid) from public, anon;
grant execute on function public.unsend_round_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. DM notification + push text for videos and albums
-- ---------------------------------------------------------------------------

-- "a video", "3 photos", "2 photos and 1 video" (English, like the rest of
-- this trigger's text).
create function private.chat_media_phrase(p_media jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (
    select count(*) filter (where e ->> 'kind' = 'image') as photos,
           count(*) filter (where e ->> 'kind' = 'video') as videos
      from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) as t(e)
  ), parts as (
    select case when photos = 1 then 'a photo' when photos > 1 then photos || ' photos' end as p,
           case when videos = 1 then 'a video' when videos > 1 then videos || ' videos' end as v,
           photos, videos
      from c
  )
  select case
           when photos > 0 and videos > 0 then
             (case when photos = 1 then '1 photo' else photos || ' photos' end) || ' and ' ||
             (case when videos = 1 then '1 video' else videos || ' videos' end)
           else coalesce(p, v, 'a message')
         end
    from parts;
$$;

revoke execute on function private.chat_media_phrase(jsonb) from public, anon, authenticated;

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
  v_media boolean := new.media is not null;
  v_phrase text := case when new.media is not null then private.chat_media_phrase(new.media) end;
  v_single_video boolean := new.media is not null and jsonb_array_length(new.media) = 1 and new.media -> 0 ->> 'kind' = 'video';
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id,
         coalesce(v_sender_name, 'A golfer') ||
           case when v_voice then ' sent a voice message.'
                when v_media then ' sent ' || v_phrase || '.'
                when v_photo then ' sent a photo.'
                else ' sent you a message.' end,
         '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    v_preview := btrim(regexp_replace(coalesce(new.text, ''), '\s+', ' ', 'g'));
    if v_voice then
      v_preview := coalesce(v_sender_name, 'A golfer') || ' sent a voice message';
    elsif v_preview = '' then
      v_preview := case when v_media then coalesce(v_sender_name, 'A golfer') || ' sent ' || v_phrase
                        when v_photo then coalesce(v_sender_name, 'A golfer') || ' sent a photo'
                        else 'Sent you a new message' end;
    else
      if char_length(v_preview) > 100 then
        v_preview := left(v_preview, 99);
        v_preview := rtrim(coalesce(substring(v_preview from '^(.{60,}) '), v_preview)) || '…';
      end if;
      -- No emoji (Micky's rule): a bracketed label, like the app's previews.
      if v_media then
        v_preview := case when v_single_video then '[Video] ' else '[Album] ' end || v_preview;
      elsif v_photo then
        v_preview := '[Photo] ' || v_preview;
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
-- 6. Moderation: a report's media messages (admin only)
-- ---------------------------------------------------------------------------

create function public.admin_list_report_chat_media(p_report_id uuid)
returns table (
  message_id uuid,
  chat text,
  media jsonb,
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
  select x.message_id, x.chat, x.media, x.sent_at
    from (
      select m.id as message_id, 'dm'::text as chat, m.media, m.created_at as sent_at
        from public.messages m
       where m.media is not null
         and m.sender_id = v_report.reported_user_id
         and (m.id = v_report.reported_message_id
              or (v_report.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = v_report.reporter_id)))
      union all
      select m.id, 'round'::text, m.media, m.created_at
        from public.round_messages m
       where m.media is not null
         and m.sender_id = v_report.reported_user_id
         and v_report.round_id is not null
         and m.round_id = v_report.round_id
    ) x
   order by x.sent_at desc
   limit 50;
end;
$$;

revoke execute on function public.admin_list_report_chat_media(uuid) from public, anon;
grant execute on function public.admin_list_report_chat_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Account deletion: the deleted golfer's objects per chat bucket
-- ---------------------------------------------------------------------------

create function public.chat_media_paths_for_user(p_user_id uuid, p_bucket text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where p_bucket in ('chat-media', 'chat-video', 'chat-video-incoming')
     and o.bucket_id = p_bucket and o.owner_id = p_user_id::text
   order by o.name;
$$;

revoke execute on function public.chat_media_paths_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.chat_media_paths_for_user(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Retention: videos expire after 180 days (not while under open report)
-- ---------------------------------------------------------------------------

create function private.chat_message_report_open(p_chat text, p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_chat
    when 'dm' then exists (
      select 1
        from public.messages m
        join public.reports r on r.reported_user_id = m.sender_id and r.status = 'open'
       where m.id = p_message_id
         and (r.reported_message_id = m.id
              or (r.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = r.reporter_id))))
    when 'round' then exists (
      select 1
        from public.round_messages m
        join public.reports r on r.reported_user_id = m.sender_id and r.round_id = m.round_id and r.status = 'open'
       where m.id = p_message_id)
    else false
  end;
$$;

revoke execute on function private.chat_message_report_open(text, uuid) from public, anon, authenticated;

-- The expired form of an array: every video item that still has its files
-- loses path + poster and gains "expired": true. Photos are unchanged.
create function private.chat_media_expired(p_media jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(
           case when e ->> 'kind' = 'video' and e ? 'path'
                then (e - 'path' - 'poster') || '{"expired": true}'::jsonb
                else e end
           order by o)
    from jsonb_array_elements(p_media) with ordinality as t(e, o);
$$;

revoke execute on function private.chat_media_expired(jsonb) from public, anon, authenticated;

-- Expires up to p_limit due messages and returns the chat-video objects to
-- delete (each video's .mp4 and poster). Run by chat-video-retention.
create function public.chat_video_expire_due(p_limit integer default 200, p_days integer default 180)
returns table (bucket text, name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 180));
begin
  for v_row in
    select 'dm'::text as chat, m.id, m.media
      from public.messages m
     where m.media is not null and m.created_at < v_cutoff
       and exists (select 1 from jsonb_array_elements(m.media) as t(e) where e ->> 'kind' = 'video' and e ? 'path')
       and not private.chat_message_report_open('dm', m.id)
    union all
    select 'round'::text, m.id, m.media
      from public.round_messages m
     where m.media is not null and m.created_at < v_cutoff
       and exists (select 1 from jsonb_array_elements(m.media) as t(e) where e ->> 'kind' = 'video' and e ? 'path')
       and not private.chat_message_report_open('round', m.id)
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    if v_row.chat = 'dm' then
      update public.messages set media = private.chat_media_expired(v_row.media) where id = v_row.id;
    else
      update public.round_messages set media = private.chat_media_expired(v_row.media) where id = v_row.id;
    end if;
    return query
      select 'chat-video'::text, n
        from (select e ->> 'path' as n from jsonb_array_elements(v_row.media) as t(e) where e ->> 'kind' = 'video'
              union all
              select e ->> 'poster' from jsonb_array_elements(v_row.media) as t(e) where e ->> 'kind' = 'video') s
       where n is not null;
  end loop;
end;
$$;

revoke execute on function public.chat_video_expire_due(integer, integer) from public, anon, authenticated;
grant execute on function public.chat_video_expire_due(integer, integer) to service_role;

-- Objects nobody needs, older than a day: chat-video objects no row points
-- at (an unsent album whose delete failed, a send that never got its row)
-- and staged originals (the transcoder deletes them; leftovers are failed
-- or abandoned sends).
create function public.chat_video_orphans(p_limit integer default 500)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  (select o.bucket_id::text, o.name
     from storage.objects o
    where o.bucket_id = 'chat-video' and o.created_at < now() - interval '1 day'
      and not private.chat_video_in_use(o.name)
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000)))
  union all
  (select o.bucket_id::text, o.name
     from storage.objects o
    where o.bucket_id = 'chat-video-incoming' and o.created_at < now() - interval '1 day'
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 500), 1000)));
$$;

revoke execute on function public.chat_video_orphans(integer) from public, anon, authenticated;
grant execute on function public.chat_video_orphans(integer) to service_role;

-- Asks the chat-video-retention Edge Function to run (pg_net, the same
-- internal secret as send-push).
create function private.request_chat_video_retention()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/chat-video-retention',
    headers := jsonb_build_object('x-internal-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke execute on function private.request_chat_video_retention() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chat-video-retention', '23 4 * * *', 'select private.request_chat_video_retention()');
  else
    raise notice 'pg_cron is not installed: run chat-video-schedule.sql to schedule the daily chat video retention job.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
