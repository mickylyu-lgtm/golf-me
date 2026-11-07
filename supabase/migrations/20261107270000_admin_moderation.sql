-- ---------------------------------------------------------------------------
-- 20261107270000_admin_moderation
--
-- Admin moderation tools (App Store Guideline 1.2: act on reported content).
-- Until now an admin could only mark a report reviewed/actioned; "Hide post"
-- hides a post for the viewer only, so a post that breaks the guidelines
-- stayed up for everyone else until it was deleted by hand in SQL.
--
-- Who is an admin: unchanged. private.has_role(auth.uid(), 'admin'), backed by
-- public.user_roles (20260818040000), the same check every admin_* RPC uses.
--
-- 1. Soft removal of posts and comments
--    community_posts / community_comments get removed_at, removed_by and
--    removed_reason. Nothing is deleted: reports.reported_post_id /
--    reported_comment_id keep their link, the audit log keeps its target, and
--    an admin can restore it. Comments are soft-removed the same way (not hard
--    deleted) for the same reasons: a hard delete would SET NULL the report's
--    reported_comment_id, lose the evidence, and could not be undone.
--    Removed rows are hidden from every client read by the SELECT policies
--    (author included: the author is told by a bell notification). Admins see
--    them only through admin_list_removed_content().
--    A guard trigger stops anyone but an admin (or the service role / SQL
--    editor, where auth.uid() is null) from setting or clearing removed_*,
--    so an author can't restore their own post through community_posts_update_own.
--
-- 2. Suspension: private.user_suspensions, one row per suspended user.
--    A separate private table rather than columns on profiles: profiles rows
--    are updatable by their owner (profiles_update_own) and readable through
--    the public profile RPCs, and a suspension must be neither self-editable
--    nor visible to other golfers. No client access at all; the user reads
--    their own state through my_moderation_status().
--    Enforcement is SERVER-side by BEFORE INSERT (and, where an update is a
--    new action, BEFORE UPDATE) triggers that call the shared
--    private.is_suspended(uid) check. Triggers rather than extra WITH CHECK
--    clauses, because several of these writes go through SECURITY DEFINER
--    RPCs that bypass RLS (host_golf_call, join_golf_call, ...): one trigger
--    per table covers the direct PostgREST insert, every existing RPC and any
--    future one, and leaves every existing policy and RPC body untouched (so
--    nothing has to be copied from migrations that are not yet applied in
--    production, such as 20261107220000's chat media). Same pattern as the
--    objectionable-text filter (private.reject_objectionable_text).
--    Blocked for a suspended user: posts (and post media, and editing a
--    post's content), comments, post/comment likes, DMs, round chat messages,
--    DM and round-chat reactions, hosting a round, joining or re-joining one,
--    and changing their profile name, bio or photo (Micky 2026-11-07: an
--    impersonator mustn't keep editing the impersonation).
--    Still allowed: signing in, reading, leaving rounds, unsending, removing
--    a reaction, deleting their own content, blocking, reporting, every other
--    profile setting/preference, deleting the account.
--    The trigger only fires for rows the caller writes as themselves (the
--    row's author/sender/voter/user column = auth.uid()), so a side effect of
--    an allowed action that writes as someone else (the founder welcome DM)
--    is not caught. auth.uid() null (service role, cron, SQL editor) is never
--    blocked.
--    Optionally the admin hides the user's existing posts and comments while
--    the suspension is active (hide_content): a SELECT-policy filter, not a
--    per-row change, so lifting or expiring the suspension shows them again.
--    The user still sees their own.
--
-- 3. Audit log: private.moderation_actions (admin, action, target, reason,
--    note, at). RLS on, no policies, no grants: the dashboard reads it
--    through admin_list_moderation_actions().
--
-- Notification: the author of removed content gets a bell row ('post_removed'
-- / 'comment_removed', no actor, link /community/guidelines) in their own
-- language (profiles.language, 6 app locales). No push.
--
-- Policies changed (re-created with their current definition, `using (true)`
-- since 20260816143600, plus the removal/hidden filter):
--   community_posts_select_authenticated, community_comments_select_authenticated.
-- No existing INSERT/UPDATE/DELETE policy is changed. Added: two RESTRICTIVE
-- storage.objects policies (avatars bucket only) so a suspended user can't
-- replace their avatar file.
--
-- Removing a post also closes its Golf Circle fan-out job and takes back
-- the "new post" bell rows already sent (notify-fanout re-checks removed_at
-- before each push).
--
-- Needs (all applied in production): 20260818040000 (private.has_role,
-- user_roles), 20261030120000 (private.notification_fanout_jobs), 20261107200000 (dynamic notifications_type_check incl.
-- post_liked). Independent of the unapplied 20261107150000 /
-- 20261107220000: the notification types are read from the catalog, and
-- 20261107150000's own list now includes the two new types.
--
-- CHECK: moderation-check.sql (true once applied).
-- ROLLBACK: moderation-rollback.sql (given with this migration).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0. Reason picklist (shared by removal and suspension)
-- ---------------------------------------------------------------------------
create function private.moderation_reasons()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['impersonation', 'spam', 'harassment', 'hate', 'sexual', 'violence', 'scam', 'other']::text[];
$$;

-- Raises 22023 for an unknown reason, a missing note for 'other', or a note
-- over 500 characters. Returns the trimmed note (null when empty).
create function private.moderation_check_reason(p_reason text, p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_reason is null or not (p_reason = any (private.moderation_reasons())) then
    raise exception 'Pick a reason.' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Add a short note for "Other".' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'The note can be at most 500 characters.' using errcode = '22023';
  end if;
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Soft-removal columns
-- ---------------------------------------------------------------------------
alter table public.community_posts
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null,
  add column removed_reason text;
alter table public.community_posts
  add constraint community_posts_removed_reason_check
    check (removed_reason is null or removed_reason = any (array['impersonation', 'spam', 'harassment', 'hate', 'sexual', 'violence', 'scam', 'other'])),
  -- removed_at and removed_reason go together; removed_by may be null once
  -- that admin's account is gone (on delete set null).
  add constraint community_posts_removed_consistent
    check ((removed_at is null) = (removed_reason is null) and (removed_at is not null or removed_by is null));

alter table public.community_comments
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null,
  add column removed_reason text;
alter table public.community_comments
  add constraint community_comments_removed_reason_check
    check (removed_reason is null or removed_reason = any (array['impersonation', 'spam', 'harassment', 'hate', 'sexual', 'violence', 'scam', 'other'])),
  add constraint community_comments_removed_consistent
    check ((removed_at is null) = (removed_reason is null) and (removed_at is not null or removed_by is null));

-- The dashboard's "removed" list, newest first.
create index community_posts_removed_at_idx on public.community_posts (removed_at desc) where removed_at is not null;
create index community_comments_removed_at_idx on public.community_comments (removed_at desc) where removed_at is not null;

-- Only an admin (or auth.uid() null: service role / SQL editor / cascades)
-- may set or clear removed_*; on insert they must be empty.
create function private.guard_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.has_role(v_uid, 'admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by is not null or new.removed_reason is not null then
      raise exception 'Only moderators can remove content.' using errcode = '42501';
    end if;
  elsif (new.removed_at, new.removed_by, new.removed_reason) is distinct from (old.removed_at, old.removed_by, old.removed_reason) then
    raise exception 'Only moderators can remove content.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_moderation_columns() from public, anon, authenticated;

create trigger guard_moderation_columns
  before insert or update of removed_at, removed_by, removed_reason on public.community_posts
  for each row execute function private.guard_moderation_columns();
create trigger guard_moderation_columns
  before insert or update of removed_at, removed_by, removed_reason on public.community_comments
  for each row execute function private.guard_moderation_columns();

-- ---------------------------------------------------------------------------
-- 2. Suspensions
-- ---------------------------------------------------------------------------
create table private.user_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  -- null = until an admin lifts it
  suspended_until timestamptz,
  reason text not null check (reason = any (array['impersonation', 'spam', 'harassment', 'hate', 'sexual', 'violence', 'scam', 'other'])),
  -- hide the user's existing posts and comments from others while active
  hide_content boolean not null default false,
  suspended_by uuid references auth.users (id) on delete set null,
  constraint user_suspensions_until_after_start check (suspended_until is null or suspended_until > suspended_at)
);
alter table private.user_suspensions enable row level security;
revoke all on table private.user_suspensions from public, anon, authenticated;

-- The shared check. Active = a row whose end is null or still ahead.
-- Not callable by clients (it would tell anyone who is suspended); the
-- triggers and RPCs below run as the owner.
create function private.is_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_suspensions s
    where s.user_id = p_user_id
      and (s.suspended_until is null or s.suspended_until > now())
  );
$$;
revoke execute on function private.is_suspended(uuid) from public, anon, authenticated;

-- Users whose content is hidden right now (active suspension with
-- hide_content). Used by the SELECT policies, evaluated once per query.
create function private.content_hidden_author_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.user_id), '{}'::uuid[])
  from private.user_suspensions s
  where s.hide_content
    and (s.suspended_until is null or s.suspended_until > now());
$$;
revoke execute on function private.content_hidden_author_ids() from public, anon;
grant execute on function private.content_hidden_author_ids() to authenticated;

-- BEFORE trigger. tg_argv[0] (optional) names the row's actor column: the
-- write is refused only when that column is the caller. Without it the
-- caller is checked (community_post_media: RLS already ties it to the post's
-- author = caller).
create function private.reject_suspended_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;
  if tg_nargs > 0 and (to_jsonb(new) ->> tg_argv[0]) is distinct from v_uid::text then
    return new;
  end if;
  if private.is_suspended(v_uid) then
    raise exception 'account_suspended: Your account is suspended, so you can''t do that right now.'
      using errcode = 'P0001',
            hint    = 'account_suspended',
            detail  = tg_table_name;
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_suspended_write() from public, anon, authenticated;

create trigger reject_suspended_write before insert on public.community_posts
  for each row execute function private.reject_suspended_write('author_id');
-- Editing a post's content is new content too (removed_* and the counters
-- other features touch are not in the list).
create trigger reject_suspended_edit before update of text, course_tag, image_url, video_url, video_thumbnail_url, category, type on public.community_posts
  for each row execute function private.reject_suspended_write('author_id');
create trigger reject_suspended_write before insert on public.community_post_media
  for each row execute function private.reject_suspended_write();
create trigger reject_suspended_write before insert on public.community_comments
  for each row execute function private.reject_suspended_write('author_id');
create trigger reject_suspended_write before insert on public.community_post_votes
  for each row execute function private.reject_suspended_write('voter_id');
create trigger reject_suspended_write before insert on public.community_comment_votes
  for each row execute function private.reject_suspended_write('voter_id');
create trigger reject_suspended_write before insert on public.messages
  for each row execute function private.reject_suspended_write('sender_id');
create trigger reject_suspended_write before insert on public.round_messages
  for each row execute function private.reject_suspended_write('sender_id');
-- Reactions: adding one or switching its emoji (update); removing is allowed.
create trigger reject_suspended_write before insert or update on public.message_reactions
  for each row execute function private.reject_suspended_write('user_id');
create trigger reject_suspended_write before insert or update on public.round_message_reactions
  for each row execute function private.reject_suspended_write('user_id');
-- Hosting (host_golf_call or a direct insert).
create trigger reject_suspended_write before insert on public.golf_calls
  for each row execute function private.reject_suspended_write('host_user_id');
-- Joining: join_golf_call inserts (on conflict do update: the BEFORE INSERT
-- trigger still fires first); a direct status flip back to 'joined' too.
-- Leaving ('left') stays allowed.
create trigger reject_suspended_write before insert on public.round_participants
  for each row execute function private.reject_suspended_write('user_id');
create trigger reject_suspended_rejoin before update of participant_status on public.round_participants
  for each row
  when (new.participant_status = 'joined' and old.participant_status is distinct from 'joined')
  execute function private.reject_suspended_write('user_id');
-- Profile name, bio and photo (only these columns; language, preferences,
-- notification switches, location etc. stay editable). Compared old vs new,
-- so a save that resends the unchanged name with a new setting still works.
create trigger reject_suspended_profile_edit before update of name, bio, photo_url on public.profiles
  for each row
  when (
    old.id = new.id
    and (new.name, new.bio, new.photo_url) is distinct from (old.name, old.bio, old.photo_url)
  )
  execute function private.reject_suspended_write('id');

-- The avatar FILE too: AvatarUpload upserts the fixed path
-- avatars/<uid>/avatar.jpg before it saves photo_url, so without this a
-- suspended user could replace the picture behind an unchanged photo_url.
-- RESTRICTIVE policies (ANDed with the existing avatar_images_*_own ones,
-- which stay as they are), limited to the avatars bucket. Deleting stays
-- allowed. The helper only answers for the caller.
create function private.caller_is_suspended()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_suspended((select auth.uid()));
$$;
revoke execute on function private.caller_is_suspended() from public, anon;
grant execute on function private.caller_is_suspended() to authenticated;

create policy avatar_images_insert_not_suspended on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'avatars' or not (select private.caller_is_suspended()));
create policy avatar_images_update_not_suspended on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'avatars' or not (select private.caller_is_suspended()))
  with check (bucket_id <> 'avatars' or not (select private.caller_is_suspended()));

-- ---------------------------------------------------------------------------
-- 3. Audit log
-- ---------------------------------------------------------------------------
create table private.moderation_actions (
  id bigint generated always as identity primary key,
  -- the admin; kept as null if that account is deleted
  admin_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('remove_post', 'restore_post', 'remove_comment', 'restore_comment', 'suspend_user', 'lift_suspension')),
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  -- no FK: the log outlives the content and the account (ids only)
  target_id uuid not null,
  target_user_id uuid,
  reason text,
  note text check (note is null or char_length(note) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index moderation_actions_created_at_idx on private.moderation_actions (created_at desc);
create index moderation_actions_target_idx on private.moderation_actions (target_id);
alter table private.moderation_actions enable row level security;
revoke all on table private.moderation_actions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Hide removed / hidden-author content (SELECT policies)
-- ---------------------------------------------------------------------------
drop policy community_posts_select_authenticated on public.community_posts;
create policy community_posts_select_authenticated on public.community_posts
  for select to authenticated
  using (
    removed_at is null
    and (author_id = (select auth.uid()) or author_id <> all (coalesce((select private.content_hidden_author_ids()), '{}'::uuid[])))
  );

drop policy community_comments_select_authenticated on public.community_comments;
create policy community_comments_select_authenticated on public.community_comments
  for select to authenticated
  using (
    removed_at is null
    and (author_id = (select auth.uid()) or author_id <> all (coalesce((select private.content_hidden_author_ids()), '{}'::uuid[])))
  );

-- ---------------------------------------------------------------------------
-- 5. Notification types (dynamic, same approach as 20261107200000)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_types text[];
  v_required text[] := array[
    'round_joined', 'round_left', 'round_cancelled', 'new_message',
    'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round',
    'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed',
    'caddie_analysis_complete', 'new_round_nearby', 'circle_post', 'post_liked'
  ];
  v_new text;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if v_def is null then
    raise exception 'notifications_type_check not found; nothing was changed';
  end if;
  select array_agg(m.t[1] order by m.ord) into v_types
  from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as m(t, ord);
  if v_types is null or not (v_types @> v_required) then
    raise exception 'unexpected notifications_type_check (%); nothing was changed', v_def;
  end if;
  foreach v_new in array array['post_removed', 'comment_removed'] loop
    if not (v_new = any (v_types)) then
      v_types := v_types || v_new;
    end if;
  end loop;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type = any (array['
    || (select string_agg(quote_literal(u.x), ', ' order by u.i) from unnest(v_types) with ordinality as u(x, i))
    || ']))';
end $$;

-- Bell copy in the recipient's language (6 app locales).
create function private.moderation_copy(p_lang text, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'comment_removed' then
      case coalesce(p_lang, 'en')
        when 'es' then 'Tu comentario se eliminó por incumplir las normas de la comunidad.'
        when 'ja' then 'コミュニティガイドラインに違反しているため、あなたのコメントは削除されました。'
        when 'ko' then '커뮤니티 가이드라인 위반으로 회원님의 댓글이 삭제되었어요.'
        when 'zh-CN' then '你的评论因违反社区准则已被移除。'
        when 'zh-TW' then '你的留言因違反社群準則已被移除。'
        else 'Your comment was removed for breaking the community guidelines.'
      end
    else
      case coalesce(p_lang, 'en')
        when 'es' then 'Tu publicación se eliminó por incumplir las normas de la comunidad.'
        when 'ja' then 'コミュニティガイドラインに違反しているため、あなたの投稿は削除されました。'
        when 'ko' then '커뮤니티 가이드라인 위반으로 회원님의 게시물이 삭제되었어요.'
        when 'zh-CN' then '你的帖子因违反社区准则已被移除。'
        when 'zh-TW' then '你的貼文因違反社群準則已被移除。'
        else 'Your post was removed for breaking the community guidelines.'
      end
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs (SECURITY DEFINER, search_path '', private.has_role admin)
-- ---------------------------------------------------------------------------

-- Returns false when the post was already removed (no second notification).
create function public.admin_remove_post(p_post_id uuid, p_reason text, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text;
  v_author uuid;
  v_removed timestamptz;
  v_lang text;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  v_note := private.moderation_check_reason(p_reason, p_note);

  select author_id, removed_at into v_author, v_removed
  from public.community_posts where id = p_post_id for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_removed is not null then
    return false;
  end if;

  update public.community_posts
     set removed_at = now(), removed_by = v_admin, removed_reason = p_reason
   where id = p_post_id;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
  values (v_admin, 'remove_post', 'post', p_post_id, v_author, p_reason, v_note);

  -- Golf Circle fan-out for this post (20261030120000): a job not sent yet
  -- is closed (claim_notification_fanout returns nothing for 'skipped'),
  -- and bell rows already written are taken back. The job update runs
  -- first: it waits for a claim in progress, so the delete then also sees
  -- that claim's rows. A push already in flight is dropped by notify-fanout,
  -- which re-checks removed_at just before sending.
  update private.notification_fanout_jobs
     set status = 'skipped', result = 'post removed', finished_at = now()
   where kind = 'circle_post' and source_id = p_post_id and status in ('pending', 'processing');
  delete from public.notifications
   where type = 'circle_post' and link_to = '/community/' || p_post_id::text;

  if v_author <> v_admin then
    select language into v_lang from public.profiles where id = v_author;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (v_author, 'post_removed', null, private.moderation_copy(v_lang, 'post_removed'), '/community/guidelines');
  end if;
  return true;
end;
$$;

create function public.admin_restore_post(p_post_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_author uuid;
  v_removed timestamptz;
  v_reason text;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'The note can be at most 500 characters.' using errcode = '22023';
  end if;

  select author_id, removed_at, removed_reason into v_author, v_removed, v_reason
  from public.community_posts where id = p_post_id for update;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  if v_removed is null then
    return false;
  end if;

  update public.community_posts
     set removed_at = null, removed_by = null, removed_reason = null
   where id = p_post_id;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, details)
  values (v_admin, 'restore_post', 'post', p_post_id, v_author, v_reason, v_note, jsonb_build_object('removed_at', v_removed));
  return true;
end;
$$;

create function public.admin_remove_comment(p_comment_id uuid, p_reason text, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text;
  v_author uuid;
  v_post uuid;
  v_removed timestamptz;
  v_lang text;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  v_note := private.moderation_check_reason(p_reason, p_note);

  select author_id, post_id, removed_at into v_author, v_post, v_removed
  from public.community_comments where id = p_comment_id for update;
  if not found then
    raise exception 'Comment not found.' using errcode = 'P0002';
  end if;
  if v_removed is not null then
    return false;
  end if;

  update public.community_comments
     set removed_at = now(), removed_by = v_admin, removed_reason = p_reason
   where id = p_comment_id;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, details)
  values (v_admin, 'remove_comment', 'comment', p_comment_id, v_author, p_reason, v_note, jsonb_build_object('post_id', v_post));

  if v_author <> v_admin then
    select language into v_lang from public.profiles where id = v_author;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (v_author, 'comment_removed', null, private.moderation_copy(v_lang, 'comment_removed'), '/community/guidelines');
  end if;
  return true;
end;
$$;

create function public.admin_restore_comment(p_comment_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_author uuid;
  v_post uuid;
  v_removed timestamptz;
  v_reason text;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'The note can be at most 500 characters.' using errcode = '22023';
  end if;

  select author_id, post_id, removed_at, removed_reason into v_author, v_post, v_removed, v_reason
  from public.community_comments where id = p_comment_id for update;
  if not found then
    raise exception 'Comment not found.' using errcode = 'P0002';
  end if;
  if v_removed is null then
    return false;
  end if;

  update public.community_comments
     set removed_at = null, removed_by = null, removed_reason = null
   where id = p_comment_id;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, details)
  values (v_admin, 'restore_comment', 'comment', p_comment_id, v_author, v_reason, v_note, jsonb_build_object('post_id', v_post, 'removed_at', v_removed));
  return true;
end;
$$;

-- p_until null = until lifted. Re-suspending replaces the current row.
create function public.admin_suspend_user(
  p_user_id uuid,
  p_until timestamptz,
  p_reason text,
  p_note text default null,
  p_hide_content boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  v_note := private.moderation_check_reason(p_reason, p_note);
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  if p_user_id = v_admin or private.has_role(p_user_id, 'admin') then
    raise exception 'Admins can''t be suspended.' using errcode = '22023';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'The end of the suspension must be in the future.' using errcode = '22023';
  end if;

  insert into private.user_suspensions (user_id, suspended_at, suspended_until, reason, hide_content, suspended_by)
  values (p_user_id, now(), p_until, p_reason, coalesce(p_hide_content, false), v_admin)
  on conflict (user_id) do update
    set suspended_at = excluded.suspended_at,
        suspended_until = excluded.suspended_until,
        reason = excluded.reason,
        hide_content = excluded.hide_content,
        suspended_by = excluded.suspended_by;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, details)
  values (v_admin, 'suspend_user', 'user', p_user_id, p_user_id, p_reason, v_note,
          jsonb_build_object('until', p_until, 'hide_content', coalesce(p_hide_content, false)));
end;
$$;

-- Returns false when there was nothing to lift.
create function public.admin_lift_suspension(p_user_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row private.user_suspensions%rowtype;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'The note can be at most 500 characters.' using errcode = '22023';
  end if;

  delete from private.user_suspensions where user_id = p_user_id returning * into v_row;
  if not found then
    return false;
  end if;

  insert into private.moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, details)
  values (v_admin, 'lift_suspension', 'user', p_user_id, p_user_id, v_row.reason, v_note,
          jsonb_build_object('suspended_at', v_row.suspended_at, 'until', v_row.suspended_until, 'hide_content', v_row.hide_content));
  return true;
end;
$$;

-- Removed posts and comments, newest removal first (admins only).
create function public.admin_list_removed_content(p_limit integer default 100)
returns table (
  kind text,
  id uuid,
  post_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  text text,
  created_at timestamptz,
  removed_at timestamptz,
  removed_reason text,
  removed_by uuid,
  removed_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select x.kind, x.id, x.post_id, x.author_id, ap.name, ap.username, x.text, x.created_at,
         x.removed_at, x.removed_reason, x.removed_by, rp.name
  from (
    select 'post'::text as kind, p.id, p.id as post_id, p.author_id, left(p.text, 1000) as text, p.created_at,
           p.removed_at, p.removed_reason, p.removed_by
    from public.community_posts p where p.removed_at is not null
    union all
    select 'comment'::text, c.id, c.post_id, c.author_id, left(c.text, 1000), c.created_at,
           c.removed_at, c.removed_reason, c.removed_by
    from public.community_comments c where c.removed_at is not null
  ) x
  left join public.profiles ap on ap.id = x.author_id
  left join public.profiles rp on rp.id = x.removed_by
  order by x.removed_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Every suspension row, active first (expired rows stay until lifted or replaced).
create function public.admin_list_suspensions()
returns table (
  user_id uuid,
  name text,
  username text,
  suspended_at timestamptz,
  suspended_until timestamptz,
  reason text,
  hide_content boolean,
  active boolean,
  suspended_by uuid,
  suspended_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select s.user_id, p.name, p.username, s.suspended_at, s.suspended_until, s.reason, s.hide_content,
         (s.suspended_until is null or s.suspended_until > now()), s.suspended_by, b.name
  from private.user_suspensions s
  left join public.profiles p on p.id = s.user_id
  left join public.profiles b on b.id = s.suspended_by
  order by (s.suspended_until is null or s.suspended_until > now()) desc, s.suspended_at desc;
end;
$$;

create function public.admin_list_moderation_actions(p_limit integer default 100)
returns table (
  id bigint,
  created_at timestamptz,
  admin_id uuid,
  admin_name text,
  action text,
  target_type text,
  target_id uuid,
  target_user_id uuid,
  target_name text,
  target_username text,
  reason text,
  note text,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select a.id, a.created_at, a.admin_id, ap.name, a.action, a.target_type, a.target_id, a.target_user_id,
         tp.name, tp.username, a.reason, a.note, a.details
  from private.moderation_actions a
  left join public.profiles ap on ap.id = a.admin_id
  left join public.profiles tp on tp.id = a.target_user_id
  -- Insertion order (identity), not created_at: two actions in the same
  -- clock tick must still list in the order they happened.
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- The caller's own state: drives the client's feature detection (a missing
-- function = this migration isn't applied), the admin tools and the
-- suspension banner. Never another user's.
create function public.my_moderation_status()
returns table (is_admin boolean, suspended boolean, suspended_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_role((select auth.uid()), 'admin'),
    s.user_id is not null,
    s.suspended_until
  -- One row always; the join only matches an active suspension (user_id is
  -- the primary key). suspended_until null with suspended true = until lifted.
  from (select 1) one
  left join private.user_suspensions s
    on s.user_id = (select auth.uid())
   and (s.suspended_until is null or s.suspended_until > now());
$$;

revoke execute on function public.admin_remove_post(uuid, text, text) from public, anon;
revoke execute on function public.admin_restore_post(uuid, text) from public, anon;
revoke execute on function public.admin_remove_comment(uuid, text, text) from public, anon;
revoke execute on function public.admin_restore_comment(uuid, text) from public, anon;
revoke execute on function public.admin_suspend_user(uuid, timestamptz, text, text, boolean) from public, anon;
revoke execute on function public.admin_lift_suspension(uuid, text) from public, anon;
revoke execute on function public.admin_list_removed_content(integer) from public, anon;
revoke execute on function public.admin_list_suspensions() from public, anon;
revoke execute on function public.admin_list_moderation_actions(integer) from public, anon;
revoke execute on function public.my_moderation_status() from public, anon;
grant execute on function public.admin_remove_post(uuid, text, text) to authenticated;
grant execute on function public.admin_restore_post(uuid, text) to authenticated;
grant execute on function public.admin_remove_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_restore_comment(uuid, text) to authenticated;
grant execute on function public.admin_suspend_user(uuid, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.admin_lift_suspension(uuid, text) to authenticated;
grant execute on function public.admin_list_removed_content(integer) to authenticated;
grant execute on function public.admin_list_suspensions() to authenticated;
grant execute on function public.admin_list_moderation_actions(integer) to authenticated;
grant execute on function public.my_moderation_status() to authenticated;

-- Helpers: owner-only.
revoke execute on function private.moderation_reasons() from public, anon, authenticated;
revoke execute on function private.moderation_check_reason(text, text) from public, anon, authenticated;
revoke execute on function private.moderation_copy(text, text) from public, anon, authenticated;
