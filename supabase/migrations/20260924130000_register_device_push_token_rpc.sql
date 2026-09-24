-- Batch D (P1-9 follow-up): let a device's APNs token move to whichever
-- account is currently signed in on it.
--
-- device_push_tokens is keyed on token alone so one phone belongs to at most
-- one account (see 20260904230000_add_push_notifications). But the client
-- wrote it with a plain upsert, and the update policy's USING clause
-- (auth.uid() = user_id) is checked against the EXISTING row. So when a row
-- still belonged to account A (A's logout cleanup failed, or A never signed
-- out cleanly) and account B signed in on the same phone, B's upsert failed
-- with 42501 "new row violates row-level security policy (USING expression)"
-- (checked with a rolled-back simulation as the authenticated role).
-- B got no push, and A kept getting pushes on a phone it had signed out of.
--
-- This SECURITY DEFINER function always writes auth.uid() as the owner, so
-- a caller can only ever claim a token for themselves. It cannot read or
-- list anyone else's tokens, and table RLS stays as it is. Claiming a token
-- requires knowing it, and a token is a 32-byte device secret that no
-- client-readable path exposes (select_own only).

create or replace function public.register_device_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- APNs device tokens are hex strings (64 chars today). Loose bounds only,
  -- so a future token length never breaks registration.
  if p_token is null or length(p_token) not between 32 and 512 or p_token !~ '^[0-9A-Fa-f]+$' then
    raise exception 'Invalid push token.' using errcode = '22023';
  end if;

  insert into public.device_push_tokens (token, user_id, platform, updated_at)
  values (p_token, v_uid, 'ios', now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.register_device_push_token(text) from public, anon;
grant execute on function public.register_device_push_token(text) to authenticated;
