-- Admin dashboard: read access to waitlist_signups (which otherwise has
-- zero select policy for anyone, including admins -- reading it was
-- previously "a founder-only operation via the Supabase dashboard/SQL",
-- now surfaced in-app instead) and a roster of registered users. Both
-- admin-only, same private.has_role() check as every other admin RPC.
create function public.admin_list_waitlist_signups()
returns table (
  id uuid,
  email text,
  home_region text,
  referral_source text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select w.id, w.email, w.home_region, w.referral_source, w.status, w.created_at
  from public.waitlist_signups w
  order by w.created_at desc
  limit 1000;
end;
$$;
revoke execute on function public.admin_list_waitlist_signups() from public, anon;
grant execute on function public.admin_list_waitlist_signups() to authenticated;

-- Registered users roster -- profiles itself already has an open
-- "select true for authenticated" policy (any real account can already
-- read every profile), so this isn't exposing anything newly sensitive
-- except the email address, which is why it's still admin-gated rather
-- than a second, broader search RPC.
create function public.admin_list_users()
returns table (
  id uuid,
  name text,
  username text,
  email text,
  photo_url text,
  avatar_color text,
  avatar_initials text,
  has_onboarded boolean,
  verified_golfer boolean,
  is_admin boolean,
  is_coach_reviewer boolean,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.name, p.username, u.email::text, p.photo_url, p.avatar_color, p.avatar_initials,
    p.has_onboarded, p.verified_golfer,
    exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin' and r.active) as is_admin,
    exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'coach_reviewer' and r.active) as is_coach_reviewer,
    p.member_since
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.member_since desc
  limit 1000;
end;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
