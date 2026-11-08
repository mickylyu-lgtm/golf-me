-- New follower: a bell row and a phone push to the golfer who was followed
-- (Micky 2026-11-08: "there should also be a native notifications when
-- someone follows you").
--
-- Before this migration a follow (a row in public.follows, 20260816130657)
-- wrote nothing for the followed golfer. The client already knew the
-- 'new_follower' type (demo path, UserPlus icon, "follow" badge) but the
-- database never allowed or wrote it.
--
-- After: AFTER INSERT on public.follows -> to the followed golfer
--   bell: "<name> followed you." in the recipient's language (profiles.language,
--         6 app locales, null/unknown -> English), actor = the follower,
--         link /golfer/<follower id> (tapping opens the follower's profile).
--   push: title = the follower's name, body = "Followed you", same link, via
--         the live private.send_round_push helper (20261105130000): it sends
--         only when the recipient has push_enabled and a registered device,
--         and skips when the push secret is not configured. No new payload
--         fields: user_id / title / body / link_to, exactly like a like.
--   No new Settings switch (same reasoning as likes, 20261107200000):
--   push_enabled still turns every push off.
--
-- Never notified:
--   * yourself (also impossible: follows_no_self);
--   * across a block, either way (private.has_block_between);
--   * either side suspended right now (private.is_suspended from
--     20261107270000, looked up dynamically so this file applies with or
--     without it);
--   * either side banned (auth.users.banned_until in the future), as the
--     fan-out does;
--   * either side in private.notification_fanout_muted_users (App Store
--     reviewer / internal test accounts Micky lists by hand; the fan-out
--     pushes already exclude them both ways; guarded the same way);
--   * a follow BY an account with an active 'seeded', 'bot' or
--     'app_reviewer' role (public.user_roles): a seeded/bot follow would be
--     fabricated activity reaching a real golfer, and a reviewer's follow
--     would page a real stranger. 'test' is NOT excluded, so two internal
--     test accounts can still check this end to end.
--
-- Anti-spam: one 'new_follower' row per (follower, followed), EVER. As with
-- likes, the notifications table is the ledger: a follow only notifies when
-- the followed golfer has no earlier 'new_follower' row from that follower.
-- Unfollow + re-follow (any number of times, any time later) never notifies
-- again, and unfollowing leaves the bell row alone. Clients can't delete
-- notifications (no DELETE policy) and can't insert them (no INSERT
-- policy). A follow that was skipped (block, suspension...) writes no row,
-- so it does not use up the one notification. Two inserts of the same follow
-- can't race: the primary key (follower_id, following_id) makes the second
-- wait and fail.
--
-- notifications_type_check: rebuilt as (the types the live constraint allows
-- right now) + 'new_follower', read from the catalog (same as 20261107200000
-- and 20261107270000), so earlier types are kept in their order whichever
-- of the unapplied migrations are live. 20261107150000 (booking, not
-- applied in production) lists 'new_follower' too, so applying it later
-- keeps this type.
--
-- RLS: unchanged. No new tables. public.follows keeps its policies
-- (select all authenticated, insert/delete own); notifications still has
-- only select-own / update-own. The new functions have a fixed search_path
-- and no client EXECUTE.
--
-- Client: harmless in any order. An old client already renders
-- 'new_follower' (server text, UserPlus icon); a push tap navigates to
-- link_to.
--
-- ---------------------------------------------------------------------------
-- Needs (all applied in production): 20260816130657 (public.follows),
-- 20260924100300 (private.has_block_between), 20261030120000
-- (private.fanout_golfer_fallback), 20261105130000 (private.send_round_push).
-- ROLLBACK: follow-notify-rollback.sql (given with this migration).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Notification type (dynamic: whatever is allowed now + 'new_follower')
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
  if not ('new_follower' = any (v_types)) then
    v_types := v_types || 'new_follower'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type = any (array['
    || (select string_agg(quote_literal(u.x), ', ' order by u.i) from unnest(v_types) with ordinality as u(x, i))
    || ']))';
end $$;

-- The de-dupe lookup.
create index if not exists notifications_new_follower_dedupe_idx
  on public.notifications (user_id, actor_id)
  where type = 'new_follower';

-- ---------------------------------------------------------------------------
-- 2. Copy (private, never callable by clients)
-- ---------------------------------------------------------------------------
-- p_part: 'bell' = full sentence with the name; 'push' = the line under the
-- name in the push (the push title is the follower's name).
create function private.follow_notification_copy(p_lang text, p_name text, p_part text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if p_part = 'bell' then
    return case coalesce(p_lang, 'en')
      when 'es' then n || ' empezó a seguirte.'
      when 'ja' then n || 'さんがあなたをフォローしました。'
      when 'ko' then n || '님이 회원님을 팔로우했어요.'
      when 'zh-CN' then n || ' 关注了你。'
      when 'zh-TW' then n || ' 關注了你。'
      else n || ' followed you.'
    end;
  end if;
  return case coalesce(p_lang, 'en')
    when 'es' then 'Empezó a seguirte'
    when 'ja' then 'あなたをフォローしました'
    when 'ko' then '회원님을 팔로우했어요'
    when 'zh-CN' then '关注了你'
    when 'zh-TW' then '關注了你'
    else 'Followed you'
  end;
end;
$$;

revoke execute on function private.follow_notification_copy(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who is never notified (see the header). Optional pieces from other
--    migrations are looked up at call time, so a missing one just doesn't
--    apply instead of breaking every follow.
-- ---------------------------------------------------------------------------
create function private.follow_notify_skipped(p_follower uuid, p_followed uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v boolean := false;
begin
  if p_follower is null or p_followed is null or p_follower = p_followed then
    return true;
  end if;
  if private.has_block_between(p_followed, p_follower) then
    return true;
  end if;
  if exists (
    select 1 from auth.users u
    where u.id in (p_follower, p_followed) and u.banned_until is not null and u.banned_until > now()
  ) then
    return true;
  end if;
  if exists (
    select 1 from public.user_roles r
    where r.user_id = p_follower and r.active and r.role in ('seeded', 'bot', 'app_reviewer')
  ) then
    return true;
  end if;
  if to_regclass('private.notification_fanout_muted_users') is not null then
    execute 'select exists (select 1 from private.notification_fanout_muted_users m where m.user_id = $1 or m.user_id = $2)'
      into v using p_follower, p_followed;
    if v then
      return true;
    end if;
  end if;
  if to_regprocedure('private.is_suspended(uuid)') is not null then
    execute 'select private.is_suspended($1) or private.is_suspended($2)'
      into v using p_follower, p_followed;
    if v then
      return true;
    end if;
  end if;
  return false;
end;
$$;

revoke execute on function private.follow_notify_skipped(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trigger
-- ---------------------------------------------------------------------------
create function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_lang text;
  v_name text;
  v_link text := '/golfer/' || new.follower_id;
  v_push_secret text;
begin
  if private.follow_notify_skipped(new.follower_id, new.following_id) then
    return new;
  end if;

  -- One notification per (follower, followed), ever (see the header).
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.following_id and n.type = 'new_follower' and n.actor_id = new.follower_id
  ) then
    return new;
  end if;

  select name into v_actor_name from public.profiles where id = new.follower_id;
  select language into v_lang from public.profiles where id = new.following_id;
  v_name := coalesce(nullif(btrim(v_actor_name), ''), private.fanout_golfer_fallback(v_lang));

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (new.following_id, 'new_follower', new.follower_id, private.follow_notification_copy(v_lang, v_name, 'bell'), v_link);

  -- Push: best effort, never fails the follow.
  begin
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    perform private.send_round_push(
      v_push_secret, new.following_id, v_name,
      private.follow_notification_copy(v_lang, v_name, 'push'),
      v_link, null
    );
  exception when others then
    raise warning 'follow push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.notify_new_follower() from public, anon, authenticated;

create trigger trg_notify_new_follower
  after insert on public.follows
  for each row execute function public.notify_new_follower();
