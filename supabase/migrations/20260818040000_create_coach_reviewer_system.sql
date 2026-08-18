-- Coach Reviewer access system: lets an admin (initially just the founder
-- account, see the bootstrap insert below) grant selected users a
-- coach_reviewer role, either directly (they already have a GolfMe
-- account) or via a single-use invite link (they don't yet). Reviewers can
-- then leave structured "Coach Review" feedback on swing posts, kept
-- separate from ordinary community_comments.
--
-- Deliberately its own generic user_roles table rather than a boolean
-- column per capability -- the brief explicitly asks this to support more
-- roles later (Verified Coach, Golf Professional, etc.) without a schema
-- change each time; only the CHECK constraint's allowed values needs a
-- follow-up migration to grow that list, everything else (grant/revoke/
-- who-granted-it history) already generalizes.
--
-- Every privileged mutation (granting/revoking a role, creating/revoking an
-- invite, redeeming one) goes through a SECURITY DEFINER RPC that checks
-- the caller's role itself -- never a client-facing insert/update policy --
-- mirroring the existing join_golf_call()/host_golf_call() convention so a
-- membership-shaped change can never happen as two separate, raceable
-- client round trips, and so a normal user calling the REST API directly
-- can't self-grant a role or replay someone else's invite token.
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('coach_reviewer', 'admin')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean not null default true,
  unique (user_id, role)
);
create index user_roles_user_id_idx on public.user_roles (user_id);
alter table public.user_roles enable row level security;

-- RLS-callable helper, kept in `private` (never exposed as a
-- /rest/v1/rpc/... endpoint, see move_conversation_helpers_to_private_schema
-- for why) but SECURITY DEFINER so it can read user_roles regardless of the
-- calling user's own RLS visibility.
create or replace function private.has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = p_role and active = true
  );
$$;
grant execute on function private.has_role(uuid, text) to authenticated;

create policy user_roles_select_own_or_admin on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role((select auth.uid()), 'admin'));

-- No insert/update/delete policy on purpose -- every role change goes
-- through grant_coach_reviewer()/revoke_coach_reviewer()/
-- redeem_reviewer_invite() below.

-- Invite tokens: 24 random bytes (48 hex chars) via pgcrypto, effectively
-- unguessable. No select/insert/update policy at all -- RLS is enabled with
-- zero policies, so this table (including tokens) is completely
-- unreachable through the REST API; every interaction goes through the
-- admin-gated or token-gated RPCs below, all SECURITY DEFINER.
create table public.reviewer_invites (
  id uuid primary key default gen_random_uuid(),
  invite_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'redeemed', 'revoked'))
);
create index reviewer_invites_token_idx on public.reviewer_invites (invite_token);
create index reviewer_invites_status_idx on public.reviewer_invites (status);
alter table public.reviewer_invites enable row level security;

-- Coach Review feedback on swing posts -- select is open the same way
-- community_comments is (anyone who can see the post can see reviews on
-- it); insert is restricted to the review's own author, an active
-- coach_reviewer, on an actual swing post, with author_user_id verified
-- against the post's real author rather than trusted from the client. No
-- update/delete policy: reviews are immutable once submitted and must
-- survive a later revoke of the reviewer's access (the brief is explicit
-- that revoking access must not delete prior feedback).
create table public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  reviewer_user_id uuid not null references auth.users (id) on delete cascade,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  strengths text not null default '',
  improvements text not null default '',
  suggested_drill text not null default '',
  additional_comments text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, reviewer_user_id)
);
create index coach_reviews_post_id_idx on public.coach_reviews (post_id);
alter table public.coach_reviews enable row level security;

create trigger set_coach_reviews_updated_at
  before update on public.coach_reviews
  for each row execute function public.set_updated_at();

create policy coach_reviews_select_authenticated on public.coach_reviews
  for select to authenticated using (true);

create policy coach_reviews_insert_reviewer on public.coach_reviews
  for insert to authenticated
  with check (
    reviewer_user_id = (select auth.uid())
    and private.has_role((select auth.uid()), 'coach_reviewer')
    and exists (select 1 from public.community_posts cp where cp.id = post_id and cp.type = 'swing')
    and author_user_id = (select cp2.author_id from public.community_posts cp2 where cp2.id = post_id)
  );

-- Bootstrap the first admin from a known, already-existing account rather
-- than a hardcoded id -- this is the founder's own account (earliest
-- profiles row), looked up by email so the migration stays meaningful if
-- ever replayed against a different environment's data.
insert into public.user_roles (user_id, role, granted_by, granted_at, active)
select u.id, 'admin', u.id, now(), true
from auth.users u
where u.email = 'mickylyu@gmail.com'
on conflict (user_id, role) do nothing;

-- Own-status check, used by the frontend to gate UI (Leave Coach Review
-- button, admin dashboard link) -- never trusting a client-cached flag, the
-- client re-derives this from the server on load.
create function public.my_active_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(role), '{}')
  from public.user_roles
  where user_id = (select auth.uid()) and active = true;
$$;
revoke execute on function public.my_active_roles() from public, anon;
grant execute on function public.my_active_roles() to authenticated;

create function public.grant_coach_reviewer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at, active, revoked_at)
  values (p_user_id, 'coach_reviewer', (select auth.uid()), now(), true, null)
  on conflict (user_id, role) do update
    set granted_by = excluded.granted_by, granted_at = now(), active = true, revoked_at = null;
end;
$$;
revoke execute on function public.grant_coach_reviewer(uuid) from public, anon;
grant execute on function public.grant_coach_reviewer(uuid) to authenticated;

create function public.revoke_coach_reviewer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update public.user_roles
  set active = false, revoked_at = now()
  where user_id = p_user_id and role = 'coach_reviewer';
end;
$$;
revoke execute on function public.revoke_coach_reviewer(uuid) from public, anon;
grant execute on function public.revoke_coach_reviewer(uuid) to authenticated;

-- Admin-only user search for the Grant Coach Reviewer flow -- deliberately
-- separate from search_golfer_profiles (that one excludes self, requires a
-- non-empty query, and is scoped for casual social search; this one is
-- admin tooling, includes email, and returns a small unfiltered page when
-- the query is blank so the dashboard can show "recent users" by default).
create function public.admin_search_users(p_query text default '')
returns table (
  id uuid,
  name text,
  username text,
  photo_url text,
  avatar_color text,
  avatar_initials text,
  email text,
  is_coach_reviewer boolean,
  is_admin boolean
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
    p.id, p.name, p.username, p.photo_url, p.avatar_color, p.avatar_initials,
    u.email::text,
    exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'coach_reviewer' and r.active) as is_coach_reviewer,
    exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin' and r.active) as is_admin
  from public.profiles p
  join auth.users u on u.id = p.id
  where trim(coalesce(p_query, '')) = ''
     or p.name ilike '%' || trim(p_query) || '%'
     or p.username ilike '%' || trim(p_query) || '%'
     or u.email ilike '%' || trim(p_query) || '%'
  order by p.name nulls last
  limit 20;
end;
$$;
revoke execute on function public.admin_search_users(text) from public, anon;
grant execute on function public.admin_search_users(text) to authenticated;

create function public.admin_list_coach_reviewers()
returns table (
  user_id uuid,
  name text,
  username text,
  photo_url text,
  avatar_color text,
  avatar_initials text,
  active boolean,
  granted_at timestamptz,
  granted_by_name text,
  revoked_at timestamptz
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
    r.user_id, p.name, p.username, p.photo_url, p.avatar_color, p.avatar_initials,
    r.active, r.granted_at, gp.name as granted_by_name, r.revoked_at
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  left join public.profiles gp on gp.id = r.granted_by
  where r.role = 'coach_reviewer'
  order by r.granted_at desc;
end;
$$;
revoke execute on function public.admin_list_coach_reviewers() from public, anon;
grant execute on function public.admin_list_coach_reviewers() to authenticated;

create function public.create_reviewer_invite(p_expires_in_days integer default 14)
returns public.reviewer_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.reviewer_invites%rowtype;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  insert into public.reviewer_invites (created_by, expires_at)
  values ((select auth.uid()), now() + make_interval(days => greatest(coalesce(p_expires_in_days, 14), 1)))
  returning * into v_invite;

  return v_invite;
end;
$$;
revoke execute on function public.create_reviewer_invite(integer) from public, anon;
grant execute on function public.create_reviewer_invite(integer) to authenticated;

create function public.admin_list_reviewer_invites()
returns table (
  id uuid,
  invite_token text,
  created_by_name text,
  created_at timestamptz,
  expires_at timestamptz,
  redeemed_by_name text,
  redeemed_at timestamptz,
  status text
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
    i.id, i.invite_token, cp.name as created_by_name, i.created_at, i.expires_at,
    rp.name as redeemed_by_name, i.redeemed_at,
    case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end as status
  from public.reviewer_invites i
  left join public.profiles cp on cp.id = i.created_by
  left join public.profiles rp on rp.id = i.redeemed_by
  order by i.created_at desc;
end;
$$;
revoke execute on function public.admin_list_reviewer_invites() from public, anon;
grant execute on function public.admin_list_reviewer_invites() to authenticated;

create function public.revoke_reviewer_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  update public.reviewer_invites
  set status = 'revoked'
  where id = p_invite_id and status = 'pending';
end;
$$;
revoke execute on function public.revoke_reviewer_invite(uuid) from public, anon;
grant execute on function public.revoke_reviewer_invite(uuid) to authenticated;

-- Redemption is intentionally NOT admin-gated (any authenticated user needs
-- to call this) -- its safety comes from the atomic
-- "where status = 'pending' and expires_at > now()" claim below, which
-- under Postgres row-level locking lets only one concurrent caller ever
-- win a given token, preventing reuse/replay even under a race.
create function public.redeem_reviewer_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.reviewer_invites%rowtype;
begin
  update public.reviewer_invites
  set status = 'redeemed', redeemed_by = (select auth.uid()), redeemed_at = now()
  where invite_token = p_token and status = 'pending' and expires_at > now()
  returning * into v_invite;

  if v_invite.id is null then
    raise exception 'This invite link is invalid, expired, or already used.' using errcode = 'P0001';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at, active, revoked_at)
  values ((select auth.uid()), 'coach_reviewer', v_invite.created_by, now(), true, null)
  on conflict (user_id, role) do update
    set granted_by = excluded.granted_by, granted_at = now(), active = true, revoked_at = null;
end;
$$;
revoke execute on function public.redeem_reviewer_invite(text) from public, anon;
grant execute on function public.redeem_reviewer_invite(text) to authenticated;

alter publication supabase_realtime add table public.coach_reviews;
