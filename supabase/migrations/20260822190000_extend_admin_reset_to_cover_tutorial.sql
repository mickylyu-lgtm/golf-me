-- The tutorial (Part A) shipped after this RPC did -- extend the existing
-- "full first-time-flow" test reset to also re-arm onboarding_tutorial_
-- completed, so a reset test account sees both the founder welcome AND the
-- tutorial again, not just the former.
create or replace function public.admin_reset_test_account_onboarding(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_founder uuid := '11be6983-7cd6-434d-bb52-6bfaf1d6e309'::uuid;
  v_conversation_id uuid;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Admin role required.';
  end if;
  if p_user_id = v_founder then
    raise exception 'Cannot reset the founder account.';
  end if;

  select cp1.conversation_id into v_conversation_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = v_founder and cp2.user_id = p_user_id;

  if v_conversation_id is not null then
    delete from public.conversations where id = v_conversation_id; -- cascades to participants + messages
  end if;

  update public.profiles
  set has_onboarded = false, onboarding_tutorial_completed = false
  where id = p_user_id;
end;
$$;
