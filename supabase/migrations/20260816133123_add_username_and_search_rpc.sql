-- Real "Find Friends" support. profiles.username is nullable (existing
-- real accounts don't have one yet -- prompted for it in Profile edit, per
-- explicit instruction not to block the app on this) but unique
-- case-insensitively once set, enforced by a partial unique index on
-- lower(username) rather than a plain unique constraint so multiple NULLs
-- (users who haven't picked one) are allowed. Format is checked at the
-- database level, not just client-side validation.
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-zA-Z0-9_.]{3,30}$');
create unique index profiles_username_unique_idx on public.profiles (lower(username)) where username is not null;

-- Find Friends search must never expose the full profiles row the way
-- profiles_select_authenticated already does elsewhere in the app (that
-- policy is broad by design for round rosters etc., already flagged as a
-- known, accepted risk in BACKEND_STATUS.md) -- a *search* feature is a much
-- more casual, exploratory surface, so it gets its own narrower field list:
-- no email/phone (never in profiles anyway), no exact
-- playing_area_lat/lng, no OAuth internals. Only what a search result card
-- legitimately needs to display.
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
    and (p.username ilike trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
  order by
    case
      when lower(p.username) = lower(trim(p_query)) then 0
      when p.username ilike trim(p_query) || '%' then 1
      else 2
    end,
    p.name
  limit least(coalesce(p_limit, 10), 25);
$function$;

revoke execute on function public.search_golfer_profiles(text, integer) from public, anon;
grant execute on function public.search_golfer_profiles(text, integer) to authenticated;
