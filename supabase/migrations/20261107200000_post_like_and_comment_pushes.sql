-- Community notifications: likes, plus phone pushes for comments
-- (Micky 2026-11-06: "when someone commented or liked someone's post they
-- should receive the notification").
--
-- Before this migration:
--   * A top-level comment wrote a 'post_reply' bell row to the post's author
--     and a reply wrote 'comment_reply' to the parent comment's author
--     (20260816143618). Neither ever sent a phone push: only DMs, joins,
--     round updates, Caddie results and the fan-out pushed.
--   * The bell row was written even when the two golfers had blocked each
--     other, and its text was English for everyone.
--   * A like (a row in community_post_votes; there are no downvotes) wrote
--     nothing at all.
--
-- After:
--   1. notify_community_comment(): same recipients and links as before (never
--      yourself), plus: nothing when either side blocked the other; bell text
--      in the recipient's language (profiles.language, 6 app locales, null or
--      unknown -> English; the English sentences are unchanged); a push to the
--      same recipient (profiles.push_enabled + a registered device, via the
--      live private.send_round_push helper from 20261105130000): title = the
--      commenter's name, body = "Commented on your post: <preview>".
--   2. New 'post_liked' type and trigger on community_post_votes INSERT:
--      "<name> liked your post." to the post's author, link /community/<id>.
--      Not for your own post, not across a block. Push: title = the liker's
--      name, body = "Liked your post", APNs collapse id 'post-like-<post id>'
--      so several likes on one post replace each other's banner instead of
--      stacking.
--   No new Settings switch: like DMs and round updates these are about the
--   golfer's own content; the per-category switches (notify_new_rounds /
--   notify_circle_posts) exist only for broadcast fan-outs. push_enabled
--   still turns every push off.
--
-- Anti-spam (likes): one bell row per (liker, post), ever. The existing
-- notifications row IS the ledger: a like only notifies when that golfer has
-- no earlier 'post_liked' row for that post. Unlike + re-like (any number of
-- times, any time later) never notifies again, and unliking leaves the bell
-- row alone (deleting it would make the next re-like notify again). Clients
-- can't delete notifications (no DELETE policy), so the ledger can't be
-- reset from the app. Two inserts of the same like can't race: the vote's
-- primary key (post_id, voter_id) makes the second one wait and fail.
-- Aggregation ("X and 3 others liked your post") was not chosen: it means
-- rewriting a row's text and unread state on every like, with realtime and
-- popup side effects, for little gain at GolfMe's volume.
--
-- notifications_type_check: rebuilt as (the types the live constraint
-- allows right now) + 'post_liked', read from the catalog, so this file does
-- not depend on 20261107150000_booking_status_and_evidence (not applied in
-- production) and never drops its two types if it was applied first. That
-- migration's own list now includes 'post_liked' too, so applying it later
-- keeps this type.
--
-- RLS: unchanged. No new tables. notifications still has no INSERT/DELETE
-- policy (rows come only from SECURITY DEFINER triggers); the new trigger
-- function has a fixed search_path and no client EXECUTE.
--
-- Client: harmless in any order. An old client shows a 'post_liked' row with
-- its server text and a generic badge; the new client only adds its icon.
--
-- ---------------------------------------------------------------------------
-- BEFORE APPLYING (keep for the exact rollback):
--   select pg_get_functiondef('public.notify_community_comment()'::regprocedure);
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check';
-- Needs (all applied in production): 20260924100300 (private.has_block_between),
-- 20261030120000 (private.fanout_text_preview / fanout_golfer_fallback),
-- 20261105130000 (private.send_round_push).
-- ROLLBACK: post-likes-notify-rollback.sql (given with this migration).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Notification type (dynamic: whatever is allowed now + 'post_liked')
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_types text[];
  v_required text[] := array[
    'round_joined', 'round_left', 'round_cancelled', 'new_message',
    'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round',
    'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed',
    'caddie_analysis_complete', 'new_round_nearby', 'circle_post'
  ];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if v_def is null then
    raise exception 'notifications_type_check not found; nothing was changed';
  end if;
  -- Kept in their current order, new type last (same shape as every
  -- earlier definition: type = any (array['...', ...])).
  select array_agg(m.t[1] order by m.ord) into v_types
  from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as m(t, ord);
  -- A parse that lost a known type would drop it: refuse instead.
  if v_types is null or not (v_types @> v_required) then
    raise exception 'unexpected notifications_type_check (%); nothing was changed', v_def;
  end if;
  if not ('post_liked' = any (v_types)) then
    v_types := v_types || 'post_liked'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type = any (array['
    || (select string_agg(quote_literal(u.x), ', ' order by u.i) from unnest(v_types) with ordinality as u(x, i))
    || ']))';
end $$;

-- The like de-dupe lookup (the table has no other index besides its key).
create index if not exists notifications_post_liked_dedupe_idx
  on public.notifications (user_id, actor_id, link_to)
  where type = 'post_liked';

-- ---------------------------------------------------------------------------
-- 2. Copy (private, never callable by clients)
-- ---------------------------------------------------------------------------
-- p_kind: 'post_liked' | 'post_reply' | 'comment_reply'
-- p_part: 'bell' = full sentence with the name; 'push' = the line under the
-- name in the push (the push title is the actor's name).
create function private.community_notification_copy(p_lang text, p_kind text, p_name text, p_part text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if p_part = 'bell' then
    case coalesce(p_lang, 'en')
      when 'es' then
        return case p_kind
          when 'post_liked' then 'A ' || n || ' le gustó tu publicación.'
          when 'post_reply' then n || ' comentó tu publicación.'
          else n || ' respondió a tu comentario.'
        end;
      when 'ja' then
        return case p_kind
          when 'post_liked' then n || 'さんがあなたの投稿にいいねしました。'
          when 'post_reply' then n || 'さんがあなたの投稿にコメントしました。'
          else n || 'さんがあなたのコメントに返信しました。'
        end;
      when 'ko' then
        return case p_kind
          when 'post_liked' then n || '님이 회원님의 게시물에 좋아요를 눌렀어요.'
          when 'post_reply' then n || '님이 회원님의 게시물에 댓글을 남겼어요.'
          else n || '님이 회원님의 댓글에 답글을 남겼어요.'
        end;
      when 'zh-CN' then
        return case p_kind
          when 'post_liked' then n || ' 赞了你的帖子。'
          when 'post_reply' then n || ' 评论了你的帖子。'
          else n || ' 回复了你的评论。'
        end;
      when 'zh-TW' then
        return case p_kind
          when 'post_liked' then n || ' 對你的貼文按讚。'
          when 'post_reply' then n || ' 在你的貼文留言。'
          else n || ' 回覆了你的留言。'
        end;
      else
        -- English comment sentences are exactly the pre-existing ones.
        return case p_kind
          when 'post_liked' then n || ' liked your post.'
          when 'post_reply' then n || ' commented on your post.'
          else n || ' replied to your comment.'
        end;
    end case;
  end if;

  case coalesce(p_lang, 'en')
    when 'es' then
      return case p_kind when 'post_liked' then 'Le gustó tu publicación' when 'post_reply' then 'Comentó tu publicación' else 'Respondió a tu comentario' end;
    when 'ja' then
      return case p_kind when 'post_liked' then 'あなたの投稿にいいねしました' when 'post_reply' then 'あなたの投稿にコメントしました' else 'あなたのコメントに返信しました' end;
    when 'ko' then
      return case p_kind when 'post_liked' then '회원님의 게시물에 좋아요를 눌렀어요' when 'post_reply' then '회원님의 게시물에 댓글을 남겼어요' else '회원님의 댓글에 답글을 남겼어요' end;
    when 'zh-CN' then
      return case p_kind when 'post_liked' then '赞了你的帖子' when 'post_reply' then '评论了你的帖子' else '回复了你的评论' end;
    when 'zh-TW' then
      return case p_kind when 'post_liked' then '對你的貼文按讚' when 'post_reply' then '在你的貼文留言' else '回覆了你的留言' end;
    else
      return case p_kind when 'post_liked' then 'Liked your post' when 'post_reply' then 'Commented on your post' else 'Replied to your comment' end;
  end case;
end;
$$;

revoke execute on function private.community_notification_copy(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Comments: block check, localized bell row, push
-- ---------------------------------------------------------------------------
create or replace function public.notify_community_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_recipient uuid;
  v_actor_name text;
  v_lang text;
  v_name text;
  v_line text;
  v_preview text;
  v_link text := '/community/' || new.post_id;
  v_push_secret text;
begin
  if new.parent_comment_id is not null then
    v_kind := 'comment_reply';
    select author_id into v_recipient from public.community_comments where id = new.parent_comment_id;
  else
    v_kind := 'post_reply';
    select author_id into v_recipient from public.community_posts where id = new.post_id;
  end if;

  if v_recipient is null or v_recipient = new.author_id or private.has_block_between(v_recipient, new.author_id) then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = new.author_id;
  select language into v_lang from public.profiles where id = v_recipient;
  v_name := coalesce(nullif(btrim(v_actor_name), ''), private.fanout_golfer_fallback(v_lang));

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_recipient, v_kind, new.author_id, private.community_notification_copy(v_lang, v_kind, v_name, 'bell'), v_link);

  -- Push: best effort, never fails the comment.
  begin
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    v_line := private.community_notification_copy(v_lang, v_kind, v_name, 'push');
    v_preview := private.fanout_text_preview(new.text);
    if v_preview <> '' then
      v_line := v_line || case when v_lang in ('ja', 'zh-CN', 'zh-TW') then '：' else ': ' end || v_preview;
    end if;
    perform private.send_round_push(v_push_secret, v_recipient, v_name, v_line, v_link, null);
  exception when others then
    raise warning 'comment push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Likes
-- ---------------------------------------------------------------------------
create function public.notify_post_liked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_actor_name text;
  v_lang text;
  v_name text;
  v_link text := '/community/' || new.post_id;
  v_push_secret text;
begin
  select author_id into v_author from public.community_posts where id = new.post_id;
  if v_author is null or v_author = new.voter_id or private.has_block_between(v_author, new.voter_id) then
    return new;
  end if;

  -- One notification per (liker, post), ever (see the header).
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_author and n.type = 'post_liked' and n.actor_id = new.voter_id and n.link_to = v_link
  ) then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = new.voter_id;
  select language into v_lang from public.profiles where id = v_author;
  v_name := coalesce(nullif(btrim(v_actor_name), ''), private.fanout_golfer_fallback(v_lang));

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_author, 'post_liked', new.voter_id, private.community_notification_copy(v_lang, 'post_liked', v_name, 'bell'), v_link);

  begin
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    perform private.send_round_push(
      v_push_secret, v_author, v_name,
      private.community_notification_copy(v_lang, 'post_liked', v_name, 'push'),
      v_link, 'post-like-' || new.post_id
    );
  exception when others then
    raise warning 'like push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.notify_post_liked() from public, anon, authenticated;

create trigger trg_notify_post_liked
  after insert on public.community_post_votes
  for each row execute function public.notify_post_liked();
