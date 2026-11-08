-- ---------------------------------------------------------------------------
-- 20261108120000_chat_message_edit
--
-- Edit your own text message within 5 minutes, in DMs and round chats
-- (Micky's brief 2026-11-08, section 4). PREPARED, NOT APPLIED: designed by
-- golfme-architect; apply only after Micky's sign-off.
-- Needs (all applied in production): 20261105120000 DM unsend,
-- 20261107130000 round chat parity, 20261107220000 chat video/albums (media
-- columns), 20261107240000 privacy retention jobs (pg_cron). Works with or
-- without 20261107270000 admin moderation (suspension is looked up at run
-- time, see 4).
--
-- THE BOUNDARY (exact): an edit is accepted only while
--     created_at <= now()  AND  now() < created_at + interval '5 minutes'
-- where created_at is the message row's ORIGINAL server timestamp and now()
-- is the database transaction's start time (microsecond precision). At
-- exactly created_at + 5:00.000000 it is refused (edit_window_expired), the
-- same instant unsend stops (unsend_message: created_at <= now() - 5 min).
-- Editing never moves the window: the check reads created_at only, never
-- edited_at, and nothing updates created_at. No time comes from the client.
--
-- 1. messages.edited_at / round_messages.edited_at (nullable): set to now()
--    by the edit RPCs only; the app shows "Edited" when it is set. Its
--    presence on fetched rows (select "*") is how the client detects the
--    feature (Edit is hidden before this is applied).
--
-- 2. created_at is stamped by the server on every client insert. Until now
--    the insert policies did not constrain created_at, so a client could
--    insert a message dated in the future and keep it inside the 5-minute
--    edit (and unsend) window for as long as it liked. A BEFORE INSERT
--    trigger now sets created_at := now() whenever auth.uid() is not null
--    (every PostgREST insert, and every SECURITY DEFINER path a signed-in
--    caller triggers, e.g. the founder welcome DM). auth.uid() null (SQL
--    editor, service role, cron) is left alone. This is the value the app
--    already got (the column default is now()); no app code sets it.
--
-- 3. Earlier text is kept in a hidden copy, the same design Micky chose for
--    unsend (option B, 2026-11-04): private.message_edit_copies and
--    private.round_message_edit_copies, one row per edit with the text it
--    REPLACED. Private schema, RLS on with no policies, no grants, not in
--    realtime: readable only by the table owner (SQL editor), so a report of
--    "harassed, then edited it away" can still be checked. Each copy
--    cascades with its message (unsend keeps the row, so its edit copies
--    stay until the row goes; account deletion / round deletion removes
--    them). Retention: 90 days after the edit, except while an OPEN report
--    holds it (same scope as the unsent copies, 20261107240000): daily
--    pg_cron job 'golfme-purge-edit-copies' (04:19 UTC) runs
--    private.purge_expired_edit_copies(). PRIVACY POLICY: needs the sentence
--    added in src/pages/PrivacyPolicy.tsx in the same commit, approved by
--    Micky before this is applied.
--
-- 4. public.edit_message(p_message_id, p_text, p_expected_text) and
--    public.edit_round_message(...): the ONLY way to change a message's text
--    (there is still no client UPDATE policy on either table). SECURITY
--    DEFINER, search_path ''. In this order:
--      a. Authorization, before the row is locked or its state is looked at,
--         one error for every refusal (42501, hint edit_not_allowed) so it
--         can't probe message ids: signed in; the message exists; I am its
--         sender; I can still POST in that chat right now:
--           DM:    I'm a participant of its conversation and there is no
--                  block either way with the other participant (= the
--                  messages insert policy);
--           round: private.is_round_member (host, or participant 'joined':
--                  a golfer who left / was removed is out), no block either
--                  way with the host, round still 'open'/'full' (= the
--                  round_messages insert policy; a finished round's chat is
--                  read-only, so are its messages).
--      b. Suspension (20261107270000): if private.is_suspended exists and
--         says so: P0001, hint account_suspended (the same contract as
--         private.reject_suspended_write). Looked up with to_regprocedure +
--         EXECUTE so this file applies before or after moderation.
--      c. Row lock (FOR UPDATE: a concurrent unsend, a second device or a
--         retry waits), then: unsent -> P0001 edit_message_unsent; a photo,
--         voice message, video or album (even with a caption) -> P0001
--         edit_not_text (text messages only, media is never replaced);
--         outside the window above -> P0001 edit_window_expired.
--      d. The text: trimmed of leading/trailing whitespace like the app's
--         send (text.trim()); empty -> 22023 edit_empty. The UPDATE then runs
--         the same BEFORE UPDATE OF text trigger a send runs
--         (filter_objectionable_text -> P0001 objectionable_content) and the
--         same table CHECK; there is no length limit on a send, so none here.
--      e. Same text as stored -> {"status":"unchanged"}: a retry after a lost
--         response, or a duplicate tap, is a harmless no-op (no copy, no new
--         edited_at, no realtime event).
--      f. p_expected_text (the text the editor was opened on; optional): if
--         given and the stored text is different (edited meanwhile on another
--         device), P0001 edit_conflict, nothing written; the app shows the
--         newer text and keeps the golfer's draft.
--      g. Copy the old text (3), set text + edited_at = now(), return
--         {"status":"edited","text":...,"edited_at":...}.
--    Reactions, the reply link (reply_to_message_id) and every quote of the
--    message are untouched: quotes are drawn from the live row, so they show
--    the current text.
--
-- Notifications and push: nothing. notify_new_message (DM bell row + APNs
-- push) is AFTER INSERT only, round chat has no per-message notification,
-- and no trigger fires on UPDATE OF text except the content filter. So an
-- edit never sends a push and never puts its text in a notification row (the
-- bell row never carried message text anyway). Known limit, same as unsend:
-- a push already delivered keeps its lock-screen preview of the ORIGINAL
-- text (up to 100 chars) until the recipient clears it; fixing that needs an
-- apns-collapse-id per message in send-push (not part of this change).
--
-- Realtime: the UPDATE reaches the other participants through the existing
-- postgres_changes subscriptions (RLS-filtered; the client refetches on any
-- UPDATE of messages / round_messages).
--
-- CHECK: message-edit-check.sql (true once applied).
-- ROLLBACK: message-edit-rollback.sql (keeps the current, edited text).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'round_messages' and column_name = 'unsent_at')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'messages' and column_name = 'media')
     or to_regprocedure('private.purge_expired_unsent_copies()') is null then
    raise exception '20261108120000_chat_message_edit needs 20261107130000, 20261107220000 and 20261107240000 applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. edited_at
-- ---------------------------------------------------------------------------

alter table public.messages add column edited_at timestamptz null;
alter table public.round_messages add column edited_at timestamptz null;

alter table public.messages
  add constraint messages_edited_at_check check (edited_at is null or edited_at >= created_at);
alter table public.round_messages
  add constraint round_messages_edited_at_check check (edited_at is null or edited_at >= created_at);

comment on column public.messages.edited_at is
  'Set by public.edit_message only (within 5 minutes of created_at); the app shows "Edited".';
comment on column public.round_messages.edited_at is
  'Set by public.edit_round_message only (within 5 minutes of created_at); the app shows "Edited".';

-- ---------------------------------------------------------------------------
-- 2. created_at is the server's
-- ---------------------------------------------------------------------------

create function private.stamp_chat_message_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.stamp_chat_message_created_at() from public, anon, authenticated;

create trigger stamp_created_at
  before insert on public.messages
  for each row execute function private.stamp_chat_message_created_at();
create trigger stamp_created_at
  before insert on public.round_messages
  for each row execute function private.stamp_chat_message_created_at();

-- ---------------------------------------------------------------------------
-- 3. Hidden copies of replaced text (admin / SQL editor only)
-- ---------------------------------------------------------------------------

create schema if not exists private;

create table private.message_edit_copies (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references public.messages (id) on delete cascade,
  conversation_id     uuid not null,
  sender_id           uuid not null,
  previous_text       text not null,
  original_created_at timestamptz not null,
  edited_at           timestamptz not null
);
create index message_edit_copies_message_id_idx on private.message_edit_copies (message_id);
create index message_edit_copies_edited_at_idx on private.message_edit_copies (edited_at);
alter table private.message_edit_copies enable row level security;
revoke all on table private.message_edit_copies from public, anon, authenticated;

create table private.round_message_edit_copies (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references public.round_messages (id) on delete cascade,
  round_id            uuid not null,
  sender_id           uuid not null,
  previous_text       text not null,
  original_created_at timestamptz not null,
  edited_at           timestamptz not null
);
create index round_message_edit_copies_message_id_idx on private.round_message_edit_copies (message_id);
create index round_message_edit_copies_edited_at_idx on private.round_message_edit_copies (edited_at);
alter table private.round_message_edit_copies enable row level security;
revoke all on table private.round_message_edit_copies from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The edit RPCs
-- ---------------------------------------------------------------------------

-- Leading/trailing whitespace (incl. no-break space and BOM), like JS trim().
create function private.chat_edit_trim(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_text, ''), '^[\s\u00a0\ufeff\u2028\u2029]+|[\s\u00a0\ufeff\u2028\u2029]+$', '', 'g');
$$;
revoke execute on function private.chat_edit_trim(text) from public, anon, authenticated;

-- True when the moderation migration is applied and p_user_id is suspended.
create function private.chat_edit_caller_suspended(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v boolean := false;
begin
  if to_regprocedure('private.is_suspended(uuid)') is not null then
    execute 'select private.is_suspended($1)' into v using p_user_id;
  end if;
  return coalesce(v, false);
end;
$$;
revoke execute on function private.chat_edit_caller_suspended(uuid) from public, anon, authenticated;

create function public.edit_message(p_message_id uuid, p_text text, p_expected_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.messages%rowtype;
  v_text text;
begin
  -- a. Authorize: no lock, nothing about the message's state decides it.
  if v_uid is not null then
    select * into v_msg from public.messages where id = p_message_id;
  end if;
  if v_uid is null
     or v_msg.id is null
     or v_msg.sender_id <> v_uid
     or not exists (
       select 1 from public.conversation_participants cp
        where cp.conversation_id = v_msg.conversation_id and cp.user_id = v_uid)
     or exists (
       select 1 from public.conversation_participants o
        where o.conversation_id = v_msg.conversation_id
          and o.user_id <> v_uid
          and private.has_block_between(v_uid, o.user_id)) then
    raise exception 'edit_not_allowed: only the sender can edit this message.'
      using errcode = '42501', hint = 'edit_not_allowed';
  end if;

  -- b. Suspended accounts can't post, so they can't edit either.
  if private.chat_edit_caller_suspended(v_uid) then
    raise exception 'account_suspended: Your account is suspended, so you can''t do that right now.'
      using errcode = 'P0001', hint = 'account_suspended', detail = 'messages';
  end if;

  -- c. Lock (a concurrent unsend / edit / retry waits), then re-read.
  select * into v_msg from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'edit_not_allowed: only the sender can edit this message.'
      using errcode = '42501', hint = 'edit_not_allowed';
  end if;
  if v_msg.unsent_at is not null then
    raise exception 'edit_message_unsent: this message was unsent.'
      using errcode = 'P0001', hint = 'edit_message_unsent';
  end if;
  if v_msg.image_path is not null or v_msg.audio_path is not null or v_msg.media is not null then
    raise exception 'edit_not_text: only text messages can be edited.'
      using errcode = 'P0001', hint = 'edit_not_text';
  end if;
  -- The boundary (see the header): from the ORIGINAL created_at, never edited_at.
  if not (v_msg.created_at <= v_now and v_now < v_msg.created_at + interval '5 minutes') then
    raise exception 'edit_window_expired: messages can only be edited within 5 minutes of sending.'
      using errcode = 'P0001', hint = 'edit_window_expired';
  end if;

  -- d. Same validation as a send.
  v_text := private.chat_edit_trim(p_text);
  if v_text = '' then
    raise exception 'edit_empty: a message can''t be empty.'
      using errcode = '22023', hint = 'edit_empty';
  end if;

  -- e. Retry / duplicate: nothing to do.
  if v_text = v_msg.text then
    return jsonb_build_object('status', 'unchanged', 'text', v_msg.text, 'edited_at', v_msg.edited_at);
  end if;

  -- f. Changed meanwhile (another device): don't overwrite blindly.
  if p_expected_text is not null and p_expected_text is distinct from v_msg.text then
    raise exception 'edit_conflict: this message was changed meanwhile.'
      using errcode = 'P0001', hint = 'edit_conflict';
  end if;

  -- g. Copy the replaced text, then write. The content filter runs on this
  --    UPDATE; if it refuses, the copy rolls back with it.
  insert into private.message_edit_copies
    (message_id, conversation_id, sender_id, previous_text, original_created_at, edited_at)
  values
    (v_msg.id, v_msg.conversation_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  update public.messages
     set text = v_text, edited_at = v_now
   where id = p_message_id;

  return jsonb_build_object('status', 'edited', 'text', v_text, 'edited_at', v_now);
end;
$$;

revoke execute on function public.edit_message(uuid, text, text) from public, anon;
grant execute on function public.edit_message(uuid, text, text) to authenticated;

create function public.edit_round_message(p_message_id uuid, p_text text, p_expected_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.round_messages%rowtype;
  v_text text;
begin
  -- a. Authorize: no lock, nothing about the message's state decides it.
  if v_uid is not null then
    select * into v_msg from public.round_messages where id = p_message_id;
  end if;
  if v_uid is null
     or v_msg.id is null
     or v_msg.sender_id <> v_uid
     or not private.is_round_member(v_msg.round_id)
     or not exists (
       select 1 from public.golf_calls gc
        where gc.id = v_msg.round_id
          and gc.status in ('open', 'full')
          and not private.has_block_between(v_uid, gc.host_user_id)) then
    raise exception 'edit_not_allowed: only the sender can edit this message.'
      using errcode = '42501', hint = 'edit_not_allowed';
  end if;

  -- b. Suspended accounts can't post, so they can't edit either.
  if private.chat_edit_caller_suspended(v_uid) then
    raise exception 'account_suspended: Your account is suspended, so you can''t do that right now.'
      using errcode = 'P0001', hint = 'account_suspended', detail = 'round_messages';
  end if;

  -- c. Lock, then re-read.
  select * into v_msg from public.round_messages where id = p_message_id for update;
  if not found then
    raise exception 'edit_not_allowed: only the sender can edit this message.'
      using errcode = '42501', hint = 'edit_not_allowed';
  end if;
  if v_msg.unsent_at is not null then
    raise exception 'edit_message_unsent: this message was unsent.'
      using errcode = 'P0001', hint = 'edit_message_unsent';
  end if;
  if v_msg.image_path is not null or v_msg.audio_path is not null or v_msg.media is not null then
    raise exception 'edit_not_text: only text messages can be edited.'
      using errcode = 'P0001', hint = 'edit_not_text';
  end if;
  if not (v_msg.created_at <= v_now and v_now < v_msg.created_at + interval '5 minutes') then
    raise exception 'edit_window_expired: messages can only be edited within 5 minutes of sending.'
      using errcode = 'P0001', hint = 'edit_window_expired';
  end if;

  -- d. Same validation as a send.
  v_text := private.chat_edit_trim(p_text);
  if v_text = '' then
    raise exception 'edit_empty: a message can''t be empty.'
      using errcode = '22023', hint = 'edit_empty';
  end if;

  -- e. Retry / duplicate.
  if v_text = v_msg.text then
    return jsonb_build_object('status', 'unchanged', 'text', v_msg.text, 'edited_at', v_msg.edited_at);
  end if;

  -- f. Changed meanwhile.
  if p_expected_text is not null and p_expected_text is distinct from v_msg.text then
    raise exception 'edit_conflict: this message was changed meanwhile.'
      using errcode = 'P0001', hint = 'edit_conflict';
  end if;

  -- g. Copy, then write (content filter on the UPDATE).
  insert into private.round_message_edit_copies
    (message_id, round_id, sender_id, previous_text, original_created_at, edited_at)
  values
    (v_msg.id, v_msg.round_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  update public.round_messages
     set text = v_text, edited_at = v_now
   where id = p_message_id;

  return jsonb_build_object('status', 'edited', 'text', v_text, 'edited_at', v_now);
end;
$$;

revoke execute on function public.edit_round_message(uuid, text, text) from public, anon;
grant execute on function public.edit_round_message(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retention: 90 days after the edit, unless an open report holds it
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

create function private.purge_expired_edit_copies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_dm integer;
  v_round integer;
begin
  delete from private.message_edit_copies u
   where u.edited_at < v_cutoff
     and not exists (
       select 1 from public.reports r
        where r.status = 'open'
          and (r.reported_message_id = u.message_id
               or (r.context = 'chat'
                   and r.reported_user_id = u.sender_id
                   and exists (select 1 from public.conversation_participants cp
                                where cp.conversation_id = u.conversation_id
                                  and cp.user_id = r.reporter_id))));
  get diagnostics v_dm = row_count;

  delete from private.round_message_edit_copies u
   where u.edited_at < v_cutoff
     and not exists (
       select 1 from public.reports r
        where r.status = 'open'
          and r.round_id = u.round_id
          and r.reported_user_id = u.sender_id);
  get diagnostics v_round = row_count;

  return jsonb_build_object('dm_deleted', v_dm, 'round_deleted', v_round);
end;
$$;

revoke execute on function private.purge_expired_edit_copies() from public, anon, authenticated;

do $$
declare
  v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname = 'golfme-purge-edit-copies' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('golfme-purge-edit-copies', '19 4 * * *', 'select private.purge_expired_edit_copies()');
end;
$$;
