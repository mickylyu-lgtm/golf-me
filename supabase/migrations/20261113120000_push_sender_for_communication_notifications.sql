-- Sender photo on native pushes (iOS Communication Notifications).
-- Micky 2026-11-13: "for native notifications there should be an icon of the
-- person's profile photo rather than just the name".
--
-- What changes: person-originated pushes now also send the actor's id as
-- `sender_id` to send-push. send-push (deployed separately) looks up that
-- golfer's public avatar / monogram and adds aps.mutable-content, thread-id and
-- a small `sender` block, so the app's Notification Service Extension can show
-- the photo like iMessage. Nothing else changes: same recipients, same block /
-- suspension / push_enabled / cooldown rules, same titles, bodies, links and
-- collapse ids, same bell rows. Every function below is the CURRENT live
-- definition copied verbatim except for its push call
-- (tests/pushSenderMigration.test.ts checks that against the source files).
--
--   DM                     notify_new_message           20261107220000 -> + 'sender_id', new.sender_id
--   someone joined round   notify_round_joined          20261105130000 -> sender = joiner
--   comment / reply        notify_community_comment     20261107200000 -> sender = commenter
--   post liked             notify_post_liked            20261107200000 -> sender = liker
--   new follower           notify_new_follower          20261108150000 -> sender = follower
--   follow request / accepted  private.social_request_notification 20261111082608 -> sender = actor
--
-- Not changed (system notifications, no person shown): round tee-time
-- update / cancel / booking status (private.send_round_push, untouched),
-- Caddie analysis complete, the notify-fanout "new round near you" /
-- "Golf Circle post" pushes.
--
-- Safe in either order with the send-push deploy: today's send-push ignores
-- unknown body fields, and a phone without the new extension ignores
-- mutable-content. No table, column, policy or grant change.
--
-- Rollback: re-run the six function definitions from the migrations listed
-- above, then `drop function private.send_person_push(text, uuid, text, text, text, text, uuid);`.

do $$
begin
  if to_regprocedure('private.send_round_push(text,uuid,text,text,text,text)') is null
     or to_regprocedure('private.has_block_between(uuid,uuid)') is null
     or to_regprocedure('private.fanout_golfer_fallback(text)') is null
     or to_regprocedure('private.fanout_text_preview(text)') is null
     or to_regprocedure('private.chat_media_phrase(jsonb)') is null
     or to_regprocedure('private.round_push_copy(text,text,text,text,text)') is null
     or to_regprocedure('private.community_notification_copy(text,text,text,text)') is null
     or to_regprocedure('private.follow_notification_copy(text,text,text)') is null
     or to_regprocedure('private.follow_notify_skipped(uuid,uuid)') is null
     or to_regprocedure('private.social_request_notification(uuid,uuid,boolean)') is null
     or to_regprocedure('public.notify_post_liked()') is null
     or to_regprocedure('public.notify_new_follower()') is null then
    raise exception 'Required push definitions are missing. Nothing changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. private.send_round_push plus the sender. Same checks, same best effort.
-- ---------------------------------------------------------------------------
create function private.send_person_push(p_secret text, p_user_id uuid, p_title text, p_body text, p_link_to text, p_collapse_id text, p_sender_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null then
    return; -- same "no secret configured -> skip" posture as every push trigger
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.push_enabled)
     or not exists (select 1 from public.device_push_tokens t where t.user_id = p_user_id) then
    return;
  end if;
  begin
    perform net.http_post(
      url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('x-internal-secret', p_secret, 'Content-Type', 'application/json'),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', p_user_id,
        'title', p_title,
        'body', p_body,
        'link_to', p_link_to,
        'collapse_id', p_collapse_id,
        'sender_id', p_sender_id
      )),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'send-push request failed for a person push: %', sqlerrm;
  end;
end;
$$;

revoke execute on function private.send_person_push(text, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. DMs (from 20261107220000_chat_video_albums.sql)
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
          'link_to', '/messages/' || new.sender_id,
          'sender_id', new.sender_id
        ),
        timeout_milliseconds := 5000
      );
    end loop;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Someone joined -> the host (from 20261105130000_add_round_update_pushes.sql)
-- ---------------------------------------------------------------------------
create or replace function public.notify_round_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_course_name text;
  v_date_iso timestamptz;
  v_host_lang text;
  v_joiner_name text;
  v_title text;
  v_text text;
  v_link text := '/golf-calls/' || new.round_id;
  v_push boolean := true;
  v_push_secret text;
begin
  if new.participant_status <> 'joined' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.participant_status = 'joined' then
    return new; -- not a re-join
  end if;
  select g.host_user_id, g.course_name, g.date_iso into v_host, v_course_name, v_date_iso
  from public.golf_calls g where g.id = new.round_id;
  if v_host is null or v_host = new.user_id then
    return new; -- the host's own seat at hosting time, not a real "someone joined" event
  end if;

  select p.language into v_host_lang from public.profiles p where p.id = v_host;
  select nullif(btrim(p.name), '') into v_joiner_name from public.profiles p where p.id = new.user_id;
  v_title := coalesce(v_joiner_name, private.fanout_golfer_fallback(v_host_lang));
  v_text := private.round_push_copy(v_host_lang, 'joined', v_title, v_course_name, null);

  if tg_op = 'UPDATE' then
    -- Re-join: one push per golfer per round per 2 hours (checked before this
    -- row's own bell insert).
    v_push := not exists (
      select 1 from public.notifications n
      where n.user_id = v_host and n.type = 'round_joined' and n.actor_id = new.user_id
        and n.link_to = v_link and n.created_at > now() - interval '2 hours'
    );
  end if;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_host, 'round_joined', new.user_id, v_text, v_link);

  if v_push and now() <= v_date_iso + interval '12 hours' then
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    perform private.send_person_push(v_push_secret, v_host, v_title, v_text, v_link, null, new.user_id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Comments (from 20261107200000_post_like_and_comment_pushes.sql)
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
    perform private.send_person_push(v_push_secret, v_recipient, v_name, v_line, v_link, null, new.author_id);
  exception when others then
    raise warning 'comment push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Likes (from 20261107200000_post_like_and_comment_pushes.sql)
-- ---------------------------------------------------------------------------
create or replace function public.notify_post_liked()
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
    perform private.send_person_push(
      v_push_secret, v_author, v_name,
      private.community_notification_copy(v_lang, 'post_liked', v_name, 'push'),
      v_link, 'post-like-' || new.post_id, new.voter_id
    );
  exception when others then
    raise warning 'like push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. New follower (from 20261108150000_follow_notifications.sql)
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_follower()
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
    perform private.send_person_push(
      v_push_secret, new.following_id, v_name,
      private.follow_notification_copy(v_lang, v_name, 'push'),
      v_link, null, new.follower_id
    );
  exception when others then
    raise warning 'follow push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Follow request / accepted (from 20261111082608_private_social_controls.sql)
-- ---------------------------------------------------------------------------
create or replace function private.social_request_notification(p_recipient uuid,p_actor uuid,p_accepted boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v_name text; v_lang text; v_text text; v_type text; v_link text; v_secret text;
begin
 if private.follow_notify_skipped(p_actor,p_recipient) then return; end if;
 select language into v_lang from public.profiles where id=p_recipient;
 select coalesce(nullif(btrim(name),''),private.fanout_golfer_fallback(v_lang)) into v_name from public.profiles where id=p_actor;
 v_type:=case when p_accepted then 'follow_request_accepted' else 'new_follow_request' end;
 v_link:=case when p_accepted then '/golfer/'||p_actor else '/profile' end;
 -- Cooldown survives request cancellation/recreation. Actual pending state
 -- always comes from my_follow_requests, not an old notification.
 if exists(select 1 from public.notifications where user_id=p_recipient and actor_id=p_actor and type=v_type and created_at>now()-interval '24 hours') then return; end if;
 v_text:=case coalesce(v_lang,'en')
 when 'es' then v_name||case when p_accepted then ' aceptó tu solicitud de seguimiento.' else ' quiere seguirte.' end
 when 'ja' then v_name||case when p_accepted then 'さんがフォローリクエストを承認しました。' else 'さんからフォローリクエストが届きました。' end
 when 'ko' then v_name||case when p_accepted then '님이 팔로우 요청을 수락했어요.' else '님이 팔로우를 요청했어요.' end
 when 'zh-CN' then v_name||case when p_accepted then ' 接受了你的关注请求。' else ' 请求关注你。' end
 when 'zh-TW' then v_name||case when p_accepted then ' 接受了你的追蹤請求。' else ' 請求追蹤你。' end
 else v_name||case when p_accepted then ' accepted your follow request.' else ' requested to follow you.' end end;
 insert into public.notifications(user_id,type,actor_id,text,link_to) values(p_recipient,v_type,p_actor,v_text,v_link);
 begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='push_internal_secret' limit 1;
 perform private.send_person_push(v_secret,p_recipient,v_name,v_text,v_link,null,p_actor);
 exception when others then raise warning 'follow request push skipped: %',sqlerrm; end;
end $$;

-- ---------------------------------------------------------------------------
-- Check (expect every column true):
--   select to_regprocedure('private.send_person_push(text,uuid,text,text,text,text,uuid)') is not null as helper,
--          not has_function_privilege('authenticated', 'private.send_person_push(text,uuid,text,text,text,text,uuid)', 'execute') as helper_locked,
--          pg_get_functiondef('public.notify_new_message()'::regprocedure) like '%''sender_id'', new.sender_id%' as dm,
--          pg_get_functiondef('public.notify_round_joined()'::regprocedure) like '%send_person_push%' as joined,
--          pg_get_functiondef('public.notify_community_comment()'::regprocedure) like '%send_person_push%' as comment,
--          pg_get_functiondef('public.notify_post_liked()'::regprocedure) like '%send_person_push%' as liked,
--          pg_get_functiondef('public.notify_new_follower()'::regprocedure) like '%send_person_push%' as follower,
--          pg_get_functiondef('private.social_request_notification(uuid,uuid,boolean)'::regprocedure) like '%send_person_push%' as request;
-- ---------------------------------------------------------------------------
