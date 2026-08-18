-- Whether a given profile currently holds the coach_reviewer role -- open
-- to any authenticated caller (not admin-gated) since this is public-facing
-- profile info, the same visibility level as profiles.verified_golfer.
-- Used to show the "Coach Reviewer" badge on both a reviewer's own profile
-- and when another user views it.
create function public.is_coach_reviewer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'coach_reviewer' and active = true
  );
$$;
revoke execute on function public.is_coach_reviewer(uuid) from public, anon;
grant execute on function public.is_coach_reviewer(uuid) to authenticated;
