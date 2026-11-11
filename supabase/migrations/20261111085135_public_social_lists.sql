-- LOCAL REVIEW ONLY: no production execution without explicit approval.
-- Additive public graph reads. No relationship/request/privacy/role data changes.
-- Raw follows RLS, direct-write revocation, and request lifecycle stay untouched.
create or replace function private.can_view_profile_connections(p_viewer uuid,p_owner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_viewer is not null and p_viewer=(select auth.uid())
 and private.social_account_active(p_viewer) and private.social_account_active(p_owner)
 and private.social_role_visible(p_viewer,p_owner)
 and not private.has_block_between(p_viewer,p_owner);
$$;
comment on function private.can_view_profile_connections(uuid,uuid) is
 'Authenticated active viewers may read public profile connections without following. Existing owner role/account/block safety still applies; candidate eligibility remains separate.';

-- Indexes support the immutable keyset order in both directions.
create index follows_incoming_page_idx on public.follows(following_id,created_at desc,follower_id);
create index follows_outgoing_page_idx on public.follows(follower_id,created_at desc,following_id);

create function public.golfer_profile_connections_page(
 p_profile_id uuid,p_kind text default 'followers',p_limit integer default 30,
 p_search text default '',p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_viewer uuid:=(select auth.uid());
 v_search text:=lower(btrim(coalesce(p_search,'')));
 v_as_of timestamptz:=statement_timestamp();
 v_after_at timestamptz; v_after_id uuid; v_result jsonb;
begin
 if not private.can_view_profile_connections(v_viewer,p_profile_id) then
  raise exception 'Followers unavailable.' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('followers','following')
 or p_limit is null or p_limit<1 or p_limit>100 or char_length(v_search)>100 then
  raise exception 'Invalid connection page.' using errcode='22023';
 end if;
 if p_cursor is not null then
  begin
   if octet_length(p_cursor::text)>4096 or jsonb_typeof(p_cursor)<>'object'
    or (p_cursor->>'version') is distinct from '1'
    or (p_cursor->>'viewer') is distinct from v_viewer::text
    or (p_cursor->>'owner') is distinct from p_profile_id::text
    or (p_cursor->>'kind') is distinct from p_kind
    or (p_cursor->>'search') is distinct from v_search then
    raise exception 'Invalid cursor';
   end if;
   v_as_of:=(p_cursor->>'as_of')::timestamptz;
   v_after_at:=(p_cursor->>'created_at')::timestamptz;
   v_after_id:=(p_cursor->>'id')::uuid;
   if v_as_of is null or v_after_at is null or v_after_id is null
    or not isfinite(v_as_of) or not isfinite(v_after_at)
    or v_as_of>statement_timestamp() or v_as_of<statement_timestamp()-interval '24 hours'
    or v_after_at>v_as_of then raise exception 'Invalid cursor'; end if;
  exception when others then
   raise exception 'Invalid or expired connection cursor. Refresh the list.' using errcode='22023';
  end;
 end if;
 with edges as materialized (
  select f.follower_id id,f.created_at,'followers'::text kind
  from public.follows f where f.following_id=p_profile_id
  union all
  select f.following_id,f.created_at,'following'::text
  from public.follows f where f.follower_id=p_profile_id
 ), eligible as materialized (
  select e.*,p.name,p.username,
   exists(select 1 from public.follows mine where mine.follower_id=v_viewer and mine.following_id=e.id) viewer_following,
   exists(select 1 from public.follows mine where mine.follower_id=v_viewer and mine.following_id=e.id)
    and (e.kind='followers' or exists(select 1 from public.follows back where back.follower_id=e.id and back.following_id=p_profile_id)) is_mutual
  from edges e join public.profiles p on p.id=e.id
  where private.can_list_follower_profile(v_viewer,e.id)
   and not private.has_block_between(p_profile_id,e.id)
 ), matching as materialized (
  -- strpos is literal: %, _ and backslash are not wildcards.
  select * from eligible where kind=p_kind
   and (v_search='' or strpos(lower(coalesce(name,'')),v_search)>0
    or strpos(lower(coalesce(username,'')),v_search)>0)
 ), window_rows as materialized (
  select * from matching where created_at<=v_as_of
   and (v_after_at is null or created_at<v_after_at or (created_at=v_after_at and id>v_after_id))
  order by created_at desc,id limit p_limit+1
 ), page as materialized (
  select * from window_rows order by created_at desc,id limit p_limit
 ), rows as (
  -- Fixed allowlist even if the existing public projection grows later.
  select (select jsonb_object_agg(j.key,j.value) from jsonb_each(to_jsonb(p)) j
    where j.key=any(array['id','name','username','avatar_color','avatar_initials','photo_url',
      'age_range','gender','bio','area_label','handicap','skill_level','favorite_courses',
      'walk_or_cart','vibes','budget_min','budget_max','no_budget_preference','availability',
      'verified_golfer','completed_rounds','show_up_rate_pct','would_play_again_pct',
      'on_time_pct','respectful_pct','good_pace_pct','circle_size','member_since',
      'founding_member_number','distance_bucket']))
    ||jsonb_build_object('is_mutual',page.is_mutual,'viewer_following',page.viewer_following,
      'viewer_requested',not page.viewer_following and exists(select 1 from private.follow_requests r
       where r.requester_id=v_viewer and r.target_id=page.id and r.status='pending')) payload,page.created_at,page.id
  from public.golfer_public_profiles(array(select id from page)) p join page on page.id=p.id
 ), last_row as (select * from page order by created_at asc,id desc limit 1)
 select jsonb_build_object('version',2,'kind',p_kind,
  'total',(select count(*) from eligible where kind=p_kind),
  'matched_total',(select count(*) from matching),
  'mutual_total',(select count(*) from eligible where kind='followers' and is_mutual),
  'profiles',coalesce((select jsonb_agg(payload order by created_at desc,id) from rows),'[]'::jsonb),
  'next_cursor',case when (select count(*) from window_rows)>p_limit then
   (select jsonb_build_object('version',1,'viewer',v_viewer,'owner',p_profile_id,'kind',p_kind,
    'search',v_search,'as_of',v_as_of,'created_at',created_at,'id',id) from last_row)
   else null end) into v_result;
 return v_result;
end $$;
comment on function public.golfer_profile_connections_page(uuid,text,integer,text,jsonb) is
 'Authenticated public profile lists; bounded literal name/username search and descending time/ascending UUID keyset. Counts include only eligible accounts. Mutual total is unsearched incoming intersection. Cursor expires after 24h; refresh after mutations. No snapshot across requests.';
comment on function public.golfer_profile_connections(uuid,text,integer,integer) is
 'Legacy offset/count-only public profile connections. Active authenticated viewers need not follow owner. Candidate safety and filtered counts preserved.';
comment on function public.golfer_profile_followers(uuid,integer,integer) is
 'Compatibility followers wrapper with authenticated public owner access and unchanged candidate filtering.';
revoke all on function private.can_view_profile_connections(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.golfer_profile_connections_page(uuid,text,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.golfer_profile_connections_page(uuid,text,integer,text,jsonb) to authenticated;
