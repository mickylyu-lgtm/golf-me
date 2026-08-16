-- Extends the existing real notifications system (built in Phase 5) to
-- cover Community events, matching exactly what the old local
-- pushNotification() calls did for post replies/comment replies/round-
-- from-post -- a real event now guarantees a real notification via a
-- trigger, the same discipline as round_joined/new_message.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('round_joined', 'round_left', 'round_cancelled', 'new_message', 'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round'));

create function public.notify_community_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_name text;
  v_parent_author_id uuid;
  v_post_author_id uuid;
begin
  select name into v_author_name from public.profiles where id = new.author_id;

  if new.parent_comment_id is not null then
    select author_id into v_parent_author_id from public.community_comments where id = new.parent_comment_id;
    if v_parent_author_id is not null and v_parent_author_id <> new.author_id then
      insert into public.notifications (user_id, type, actor_id, text, link_to)
      values (v_parent_author_id, 'comment_reply', new.author_id, coalesce(v_author_name, 'A golfer') || ' replied to your comment.', '/community/' || new.post_id);
    end if;
  else
    select author_id into v_post_author_id from public.community_posts where id = new.post_id;
    if v_post_author_id is not null and v_post_author_id <> new.author_id then
      insert into public.notifications (user_id, type, actor_id, text, link_to)
      values (v_post_author_id, 'post_reply', new.author_id, coalesce(v_author_name, 'A golfer') || ' commented on your post.', '/community/' || new.post_id);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_notify_community_comment
  after insert on public.community_comments
  for each row execute function public.notify_community_comment();

-- Fires only on the transition into "attached" (golf_call_id null -> set),
-- never on every update -- matches the old attachGolfCallToPost()'s one-time
-- fan-out exactly, not a notification on every future edit to the post.
create function public.notify_round_created_from_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_name text;
  v_round_text text;
  v_follower_id uuid;
  v_participant_id uuid;
begin
  if new.golf_call_id is null or old.golf_call_id is not null then
    return new;
  end if;

  select name into v_author_name from public.profiles where id = new.author_id;
  select course_name into v_round_text from public.golf_calls where id = new.golf_call_id;

  for v_follower_id in select follower_id from public.follows where following_id = new.author_id loop
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (v_follower_id, 'round_created_from_post', new.author_id, coalesce(v_author_name, 'A golfer') || ' created a Golf Call at ' || coalesce(v_round_text, 'a round') || ' from a post.', '/community/' || new.id);
  end loop;

  for v_participant_id in
    select distinct author_id from public.community_comments where post_id = new.id
    union
    select new.author_id
  loop
    if v_participant_id <> new.author_id then
      insert into public.notifications (user_id, type, actor_id, text, link_to)
      values (v_participant_id, 'post_became_round', new.author_id, 'A post you were part of turned into a real Golf Call.', '/community/' || new.id);
    end if;
  end loop;

  return new;
end;
$$;

create trigger trg_notify_round_created_from_post
  after update on public.community_posts
  for each row execute function public.notify_round_created_from_post();

revoke execute on function public.notify_community_comment() from public, anon, authenticated;
revoke execute on function public.notify_round_created_from_post() from public, anon, authenticated;
