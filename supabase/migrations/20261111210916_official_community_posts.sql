-- LOCAL ONLY: apply separately after review; no content is published by this migration.
-- Existing posts remain ordinary. The designation is immutable: personal posts
-- cannot be relabelled as official, nor can an official post shed its guard.
alter table public.community_posts
  add column is_official boolean not null default false;

create function private.can_post_official()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (select 1 from auth.users u where u.id = (select auth.uid())
      and not coalesce(u.is_anonymous, false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now()))
    and private.has_role((select auth.uid()), 'admin')
    and not private.is_suspended((select auth.uid()));
$$;
revoke all on function private.can_post_official() from public, anon, authenticated, service_role;

create function public.community_post_capabilities()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('version', 1, 'can_post_official', private.can_post_official());
$$;
revoke all on function public.community_post_capabilities() from public, anon, authenticated, service_role;
grant execute on function public.community_post_capabilities() to authenticated;

create function private.guard_official_community_post()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_official and
       (new.author_id is distinct from (select auth.uid()) or not private.can_post_official()) then
      raise exception 'official_post_not_allowed' using errcode = '42501';
    end if;
  else
    if new.is_official is distinct from old.is_official then
      raise exception 'official_post_immutable' using errcode = '42501';
    end if;
    if old.is_official then
      if (new.id, new.author_id) is distinct from (old.id, old.author_id) then
        raise exception 'official_post_immutable' using errcode = '42501';
      end if;
      -- Preserve the existing service analysis and moderation lifecycle. Any
      -- other field (including future content columns) is guarded by default.
      if (to_jsonb(new) - array['swing_analysis_status','removed_at','removed_by','removed_reason'])
         is distinct from
         (to_jsonb(old) - array['swing_analysis_status','removed_at','removed_by','removed_reason'])
         and not private.can_post_official() then
        raise exception 'official_post_not_allowed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_official_community_post() from public, anon, authenticated, service_role;
create trigger guard_official_community_post
  before insert or update on public.community_posts
  for each row execute function private.guard_official_community_post();

create function private.guard_official_post_media()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old_id uuid;
  v_new_id uuid;
begin
  if tg_op <> 'INSERT' then v_old_id := old.post_id; end if;
  if tg_op <> 'DELETE' then v_new_id := new.post_id; end if;
  -- A parent-post/account deletion has already removed the parent before its
  -- FK cascade deletes media. With no remaining official parent, cleanup is
  -- allowed. Existing RLS still determines who may delete a whole post.
  if exists (select 1 from public.community_posts p
             where p.id in (v_old_id, v_new_id) and p.is_official)
     and not private.can_post_official() then
    raise exception 'official_post_not_allowed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_official_post_media() from public, anon, authenticated, service_role;
create trigger guard_official_post_media
  before insert or update or delete on public.community_post_media
  for each row execute function private.guard_official_post_media();

comment on column public.community_posts.is_official is
  'Opt-in GolfMe announcement, authorized at creation; does not change author, audience, rank, or notifications.';
