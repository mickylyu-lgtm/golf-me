-- name search already does substring matching ('%query%'); username only
-- matched by PREFIX ('query%'), which is inconsistent and less forgiving.
-- Widen username to substring too, so "ck" can find username "stanck" not
-- just "ckstan" -- matches the "more sensitive" search request. Exact-match
-- and prefix-match still rank first via the existing ORDER BY, substring
-- matches just rank last instead of being excluded entirely.
create or replace function public.search_golfer_profiles(p_query text, p_limit integer default 10)
returns table (
  id uuid,
  name text,
  username text,
  avatar_color text,
  avatar_initials text,
  photo_url text,
  handicap integer,
  area_label text,
  completed_rounds integer,
  would_play_again_pct integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct
  from public.profiles p
  where p.id <> (select auth.uid())
    and trim(coalesce(p_query, '')) <> ''
    and (p.username ilike '%' || trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
  order by
    case
      when lower(p.username) = lower(trim(p_query)) then 0
      when p.username ilike trim(p_query) || '%' then 1
      when lower(p.name) = lower(trim(p_query)) then 2
      when p.name ilike trim(p_query) || '%' then 3
      else 4
    end,
    p.name
  limit least(coalesce(p_limit, 10), 25);
$function$;

revoke execute on function public.search_golfer_profiles(text, integer) from public, anon;
grant execute on function public.search_golfer_profiles(text, integer) to authenticated;
