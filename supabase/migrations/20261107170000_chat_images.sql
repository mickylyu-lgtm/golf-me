-- Photos in chat: DMs and round group chats (Micky, 2026-11-06: "add
-- sending images in chat, beside the emoji button"). PREPARED, NOT APPLIED:
-- designed by golfme-architect; apply only after Micky's sign-off.
-- Requires 20261107130000_round_chat_parity (round_messages.unsent_at and
-- public.unsend_round_message, which this extends); the guard below refuses
-- to run without it.
--
-- One JPEG per message, re-encoded on the device (canvas: no EXIF / GPS /
-- XMP survives), long edge <= 2048 px, <= 2 MB, stored in a PRIVATE bucket:
--   chat-media/dm/<conversation_id>/<message_id>.jpg
--   chat-media/round/<round_id>/<message_id>.jpg
-- The message id is made on the device. The client uploads the object
-- first, then inserts the row with that same id and the path; the row is
-- refused unless its path spells out its own conversation / round and id
-- and the object exists, owned by the sender.
--
-- 1. Bucket chat-media: private, 2 MiB, image/jpeg only.
--
-- 2. messages / round_messages gain image_path, image_width, image_height
--    (the stored size, so viewers reserve the box before the photo loads)
--    and image_thumb (a ~16 px JPEG data URL placeholder, <= 2048 chars).
--    Folded into each table's existing text check (round chat's check file
--    counts exactly one check constraint on round_messages):
--      * a message has text or a photo (or is an unsent '' row);
--      * an unsent message has no photo;
--      * the four columns are all null or all set, the path is exactly
--        this row's own path, 1 <= width/height <= 4096, a valid thumb.
--    Trigger check_*_image (BEFORE INSERT / UPDATE OF the image columns):
--      * insert with a photo: the object must exist in chat-media, owned
--        by the sender (hint image_not_uploaded). Authorization comes
--        first: for someone who isn't the sender / in the chat the trigger
--        says nothing and RLS refuses the row as before (no oracle about
--        which objects exist);
--      * update: the photo can only be cleared (unsend), never set or
--        changed (hint image_immutable). Neither table has a client UPDATE
--        policy anyway; this binds the SECURITY DEFINER functions too.
--
-- 3. storage.objects policies for chat-media (no UPDATE policy: an object
--    can never be overwritten, upserted or moved):
--    INSERT  owner_id = me, and private.can_upload_chat_image(name): the
--            path is dm/<conv>/<uuid>.jpg for a conversation I'm in with no
--            block either way with the other participant (= the messages
--            insert policy), or round/<round>/<uuid>.jpg for a round I'm in
--            (host or joined), open/full, no block either way with the host
--            (= the round_messages insert policy); and no message with that
--            id exists yet.
--    SELECT  (what signing a URL / downloading checks) one of:
--            * a message row I can read points at it: the subquery runs
--              under messages / round_messages RLS, so it is exactly "I can
--              read that message": DM participants (minus what I cleared),
--              current round members (host or joined; not after leaving).
--              Blocks: as for the messages themselves (existing history stays
--              readable, new posts are refused);
--            * I uploaded it (needed to remove it after unsend: Storage's
--              remove checks SELECT too);
--            * I'm an admin and it was sent by a golfer reported in that
--              chat (private.chat_image_reported: a 'chat' report by a
--              participant of that conversation, a report naming the
--              message, or a report on that round).
--            anon: nothing (no policy for anon).
--    DELETE  my own object that no message row points at (any row, not
--            only ones I can see): after unsend (the row's path is
--            cleared), or an upload whose row never got inserted. A live
--            photo can't be pulled from under a chat after the 5-minute
--            unsend window.
--
-- 4. Unsend clears the photo. public.unsend_message / unsend_round_message
--    are re-created with one change: the UPDATE also nulls the four image
--    columns. Hidden admin copy: TEXT ONLY, as before. The photo is not
--    copied (Micky's default: "no"): the copy tables exist for abuse
--    evidence of what was said; keeping a private photo the sender took
--    back would contradict "unsend" more than keeping text does, and a
--    photo is far more sensitive. The client then deletes the object
--    through the Storage API (SQL can't: storage.protect_delete). If that
--    delete fails, the object is an orphan nobody but its owner can read
--    (no row points at it); sweep with the purge query below.
--    A reported-then-unsent photo is therefore gone; if Micky wants report
--    evidence kept, that needs a separate private evidence bucket (not
--    built).
--
-- 5. Notifications (DMs only; round chat has none per message): the bell
--    row says "<name> sent a photo." and the push body "<name> sent a
--    photo" for a photo with no text ("📷 <text>" with a caption).
--    public.notify_new_message is re-created from 20260929120000 with only
--    that change.
--
-- 6. Moderation: public.admin_list_report_chat_images(report_id) lists the
--    photos the reported golfer sent in that chat (admin only); the admin
--    dashboard signs them with the admin SELECT clause above.
--
-- 7. Account deletion: Postgres can't delete storage objects, and these
--    paths aren't keyed by user, so the delete-account Edge Function asks
--    public.chat_media_paths_for_user(user_id) (service_role only) for the
--    deleted golfer's objects and removes them via the Storage API. Their
--    rows are already gone (sender_id on delete cascade), so nobody else
--    could read them meanwhile.
--
-- Orphan sweep (SQL editor; then remove the listed paths in the dashboard
-- or via the Storage API -- SQL can't delete them):
--   select o.name, o.owner_id, o.created_at from storage.objects o
--    where o.bucket_id = 'chat-media' and o.created_at < now() - interval '1 day'
--      and not exists (select 1 from public.messages m where m.image_path = o.name)
--      and not exists (select 1 from public.round_messages m where m.image_path = o.name);
--
-- Client rollout (feature-detected, safe either order): the photo button
-- shows only once a select of image_path succeeds (or a fetched row carries
-- it). Deploy the client FIRST: an older client would show a photo-only
-- message as an empty bubble.
-- Verify: chat-images-check.sql returns true. Rollback:
-- chat-images-rollback.sql.

do $$
begin
  if to_regprocedure('public.unsend_round_message(uuid)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'round_messages' and column_name = 'unsent_at') then
    raise exception '20261107170000_chat_images needs 20261107130000_round_chat_parity applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Columns, checks, triggers
-- ---------------------------------------------------------------------------

alter table public.messages
  add column image_path   text null,
  add column image_width  integer null,
  add column image_height integer null,
  add column image_thumb  text null;

alter table public.round_messages
  add column image_path   text null,
  add column image_width  integer null,
  add column image_height integer null,
  add column image_thumb  text null;

alter table public.messages drop constraint messages_text_check;
alter table public.messages
  add constraint messages_text_check check (
    (char_length(text) > 0 or image_path is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or image_path is null)
    and (
      (image_path is null and image_width is null and image_height is null and image_thumb is null)
      -- coalesce: a CHECK that evaluates to NULL passes, so a half-filled
      -- set of columns (a path without a size) must read as false.
      or coalesce(
        image_path = 'dm/' || conversation_id::text || '/' || id::text || '.jpg'
        and image_width between 1 and 4096
        and image_height between 1 and 4096
        and (image_thumb is null or (char_length(image_thumb) <= 2048 and image_thumb ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
        false
      )
    )
  );

alter table public.round_messages drop constraint round_messages_text_check;
alter table public.round_messages
  add constraint round_messages_text_check check (
    (length(text) > 0 or image_path is not null or (unsent_at is not null and text = ''))
    and (unsent_at is null or image_path is null)
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
  );

create index messages_image_path_idx on public.messages (image_path) where image_path is not null;
create index round_messages_image_path_idx on public.round_messages (image_path) where image_path is not null;

create function private.check_message_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.image_path, new.image_width, new.image_height, new.image_thumb)
         is distinct from (old.image_path, old.image_width, old.image_height, old.image_thumb)
       and not (new.image_path is null and new.image_width is null and new.image_height is null and new.image_thumb is null) then
      raise exception 'image_immutable: a message''s photo can only be removed.'
        using errcode = '42501', hint = 'image_immutable';
    end if;
    return new;
  end if;
  if new.image_path is null then
    return new;
  end if;
  -- Not the sender / not in this conversation: say nothing about storage;
  -- the insert policy refuses the row right after.
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_conversation_participant(new.conversation_id)) then
    return new;
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-media' and o.name = new.image_path and o.owner_id = new.sender_id::text
  ) then
    raise exception 'image_not_uploaded: upload the photo before sending it.'
      using errcode = '42501', hint = 'image_not_uploaded';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_message_image() from public, anon, authenticated;

create trigger check_message_image
  before insert or update of image_path, image_width, image_height, image_thumb on public.messages
  for each row execute function private.check_message_image();

create function private.check_round_message_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.image_path, new.image_width, new.image_height, new.image_thumb)
         is distinct from (old.image_path, old.image_width, old.image_height, old.image_thumb)
       and not (new.image_path is null and new.image_width is null and new.image_height is null and new.image_thumb is null) then
      raise exception 'image_immutable: a message''s photo can only be removed.'
        using errcode = '42501', hint = 'image_immutable';
    end if;
    return new;
  end if;
  if new.image_path is null then
    return new;
  end if;
  if v_uid is not null and (new.sender_id is distinct from v_uid or not private.is_round_member(new.round_id)) then
    return new;
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-media' and o.name = new.image_path and o.owner_id = new.sender_id::text
  ) then
    raise exception 'image_not_uploaded: upload the photo before sending it.'
      using errcode = '42501', hint = 'image_not_uploaded';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_round_message_image() from public, anon, authenticated;

create trigger check_round_message_image
  before insert or update of image_path, image_width, image_height, image_thumb on public.round_messages
  for each row execute function private.check_round_message_image();

-- ---------------------------------------------------------------------------
-- 3. Storage policies (chat-media only)
-- ---------------------------------------------------------------------------

-- May I put an object at this path? Mirrors the two insert policies.
create function private.can_upload_chat_image(p_name text)
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
    '^(dm|round)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$'
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

-- Does any message (every row, not just what the caller can see) point at it?
create function private.chat_image_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.messages m where m.image_path = p_name)
      or exists (select 1 from public.round_messages m where m.image_path = p_name);
$$;

-- For an admin: was this photo sent by a golfer reported in that chat?
create function private.chat_image_reported(p_name text)
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
       where m.image_path = p_name
         and (r.reported_message_id = m.id
              or (r.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = r.reporter_id))))
    or exists (
      select 1
        from public.round_messages m
        join public.reports r on r.reported_user_id = m.sender_id and r.round_id = m.round_id
       where m.image_path = p_name)
  );
$$;

revoke execute on function private.can_upload_chat_image(text) from public, anon;
revoke execute on function private.chat_image_in_use(text) from public, anon;
revoke execute on function private.chat_image_reported(text) from public, anon;
-- Called from the storage policies, so the calling role needs EXECUTE.
grant execute on function private.can_upload_chat_image(text) to authenticated;
grant execute on function private.chat_image_in_use(text) to authenticated;
grant execute on function private.chat_image_reported(text) to authenticated;

create policy chat_media_insert_member on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and owner_id = (select auth.uid())::text
    and private.can_upload_chat_image(name)
  );

create policy chat_media_select_visible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      owner_id = (select auth.uid())::text
      -- Runs under messages / round_messages RLS: "I can read that message".
      or exists (select 1 from public.messages m where m.image_path = objects.name)
      or exists (select 1 from public.round_messages m where m.image_path = objects.name)
      or private.chat_image_reported(objects.name)
    )
  );

create policy chat_media_delete_own_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and owner_id = (select auth.uid())::text
    and not private.chat_image_in_use(objects.name)
  );

-- ---------------------------------------------------------------------------
-- 4. Unsend clears the photo (text-only hidden copy, unchanged)
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

  -- Hidden copy first, same transaction: if anything below fails, neither
  -- the copy nor the wipe happens. The row lock + unsent_at check above
  -- means this runs at most once per message. Text only: a photo is not
  -- kept (20261107170000).
  insert into private.unsent_message_copies
    (message_id, conversation_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.conversation_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- The photo goes with the text: no row points at the object any more, so
  -- only its owner can read it; the client then deletes it.
  update public.messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null
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

  -- Hidden copy first, same transaction: if anything below fails, neither
  -- the copy nor the wipe happens. Text only (20261107170000).
  insert into private.unsent_round_message_copies
    (message_id, round_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.round_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Fires round_messages_clear_reactions_on_unsend (section 3). The photo
  -- goes with the text; the client then deletes the object.
  update public.round_messages
     set text = '', unsent_at = v_now,
         image_path = null, image_width = null, image_height = null, image_thumb = null
   where id = p_message_id;

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_round_message(uuid) from public, anon;
grant execute on function public.unsend_round_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. DM notification + push text for photos
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
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id,
         coalesce(v_sender_name, 'A golfer') || case when v_photo then ' sent a photo.' else ' sent you a message.' end,
         '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    v_preview := btrim(regexp_replace(coalesce(new.text, ''), '\s+', ' ', 'g'));
    if v_preview = '' then
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
-- 6. Moderation: a report's photos (admin only)
-- ---------------------------------------------------------------------------

create function public.admin_list_report_chat_images(p_report_id uuid)
returns table (
  message_id uuid,
  chat text,
  image_path text,
  image_width integer,
  image_height integer,
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
  select x.message_id, x.chat, x.image_path, x.image_width, x.image_height, x.sent_at
    from (
      select m.id as message_id, 'dm'::text as chat, m.image_path, m.image_width, m.image_height, m.created_at as sent_at
        from public.messages m
       where m.image_path is not null
         and m.sender_id = v_report.reported_user_id
         and (m.id = v_report.reported_message_id
              or (v_report.context = 'chat' and exists (
                    select 1 from public.conversation_participants cp
                     where cp.conversation_id = m.conversation_id and cp.user_id = v_report.reporter_id)))
      union all
      select m.id, 'round'::text, m.image_path, m.image_width, m.image_height, m.created_at
        from public.round_messages m
       where m.image_path is not null
         and m.sender_id = v_report.reported_user_id
         and v_report.round_id is not null
         and m.round_id = v_report.round_id
    ) x
   order by x.sent_at desc
   limit 50;
end;
$$;

revoke execute on function public.admin_list_report_chat_images(uuid) from public, anon;
grant execute on function public.admin_list_report_chat_images(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Account deletion: the deleted golfer's chat photos (service role only)
-- ---------------------------------------------------------------------------

create function public.chat_media_paths_for_user(p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'chat-media' and o.owner_id = p_user_id::text
   order by o.name;
$$;

revoke execute on function public.chat_media_paths_for_user(uuid) from public, anon, authenticated;
grant execute on function public.chat_media_paths_for_user(uuid) to service_role;

notify pgrst, 'reload schema';
