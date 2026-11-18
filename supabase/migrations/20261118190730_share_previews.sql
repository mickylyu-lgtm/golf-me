-- Public, bearer-link thumbnails without opening existing tables to anon.
-- Only an authenticated eligible sharer can mint a random token. Resolution
-- re-checks current content and moderation; no copied post text or identities.
-- Rollback: drop functions resolve_share_preview(text), create_share_preview(text,uuid),
-- private.share_preview_payload(text,uuid,uuid); drop table private.share_previews.
create table private.share_previews (
  token text primary key default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')) check (token ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('post', 'round')),
  target_id uuid not null,
  creator_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  unique (creator_id, kind, target_id)
);
alter table private.share_previews enable row level security;
revoke all on private.share_previews from public, anon, authenticated;

create function private.share_preview_payload(p_kind text, p_id uuid, p_creator uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  p public.community_posts%rowtype;
  r public.golf_calls%rowtype;
  v_image text;
begin
  if not exists (select 1 from auth.users u where u.id=p_creator
    and (u.banned_until is null or u.banned_until <= now()))
    or private.is_suspended(p_creator) then return null; end if;
  if p_kind='post' then
    select * into p from public.community_posts where id=p_id and removed_at is null;
    if not found then return null; end if;
    if private.is_suspended(p.author_id)
      or not exists (select 1 from auth.users u where u.id=p.author_id
        and (u.banned_until is null or u.banned_until <= now()))
      or exists (select 1 from public.blocks b
        where (b.blocker_id=p_creator and b.blocked_id=p.author_id)
           or (b.blocker_id=p.author_id and b.blocked_id=p_creator))
      or exists (select 1 from public.hidden_posts h where h.owner_id=p_creator and h.post_id=p.id)
      then return null; end if;
    -- Same first-item ordering as the feed; never choose a later photo.
    select case when m.media_type='image' then m.media_url else m.thumbnail_url end
      into v_image from public.community_post_media m
      where m.post_id=p.id order by m.position,m.id limit 1;
    if not found then
      v_image := case when p.video_url is not null then p.video_thumbnail_url else p.image_url end;
    end if;
    -- Only the public Community bucket is eligible; never private/signed Caddie
    -- URLs or a video's original bytes. The rendering API additionally checks
    -- the exact configured Supabase origin before fetching this image.
    if v_image is not null and (v_image !~ '^https://adokdenbmpshqgjbzshb\.supabase\.co/storage/v1/object/public/community-media/[^?#]+$'
      or v_image ~* '\.(mp4|mov|webm|m4v)([?#]|$)') then v_image := null; end if;
    return jsonb_build_object('kind','post','id',p.id,'image_url',v_image);
  elsif p_kind='round' then
    select * into r from public.golf_calls where id=p_id and host_user_id=p_creator
      and status in ('open','full');
    if not found then return null; end if;
    return jsonb_build_object('kind','round','id',r.id,
      'course',left(r.course_name,160),'place',left(r.course_area_label,160),
      'date_iso',r.date_iso,'time',left(r.tee_time_label,80));
  end if;
  return null;
end;
$$;
revoke all on function private.share_preview_payload(text,uuid,uuid) from public,anon,authenticated;

create function public.create_share_preview(p_kind text,p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_creator uuid := auth.uid(); v_token text;
begin
  if v_creator is null or private.share_preview_payload(p_kind,p_id,v_creator) is null then
    raise exception 'This item cannot be shared.' using errcode='42501';
  end if;
  insert into private.share_previews as s(kind,target_id,creator_id)
    values(p_kind,p_id,v_creator)
    on conflict(creator_id,kind,target_id) do update
    set token=case when s.expires_at<=now() or s.revoked_at is not null then replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','') else s.token end,
        expires_at=now()+interval '30 days',revoked_at=null
    returning token into v_token;
  return v_token;
end;
$$;
revoke all on function public.create_share_preview(text,uuid) from public,anon;
grant execute on function public.create_share_preview(text,uuid) to authenticated;

create function public.resolve_share_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s private.share_previews%rowtype; v_viewer uuid := auth.uid(); v_payload jsonb; v_author uuid;
begin
  if p_token is null or p_token !~* '^[0-9a-f]{64}$' then return null; end if;
  if v_viewer is not null and (private.is_suspended(v_viewer)
    or not exists (select 1 from auth.users u where u.id=v_viewer
      and (u.banned_until is null or u.banned_until<=now()))) then return null; end if;
  select * into s from private.share_previews
    where token=p_token and expires_at>now() and revoked_at is null;
  if not found then return null; end if;
  v_payload := private.share_preview_payload(s.kind,s.target_id,s.creator_id);
  -- Known authenticated viewers retain their own block/hide filters too.
  -- An anonymous external crawler has no recipient identity.
  if v_viewer is not null and s.kind='post' then
    select author_id into v_author from public.community_posts where id=s.target_id;
    if exists (select 1 from public.blocks b where
      (b.blocker_id=v_viewer and b.blocked_id=v_author) or (b.blocker_id=v_author and b.blocked_id=v_viewer))
      or exists (select 1 from public.hidden_posts h where h.owner_id=v_viewer and h.post_id=s.target_id)
      then return null; end if;
  end if;
  return v_payload;
end;
$$;
revoke all on function public.resolve_share_preview(text) from public;
grant execute on function public.resolve_share_preview(text) to anon,authenticated;
