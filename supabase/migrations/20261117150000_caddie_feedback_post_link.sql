-- Apply before the matching client release; additive and transaction-bound.
-- Do not guess links for historical shares from mutable/translated post text.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.caddie_analyses add column feedback_post_id uuid
  references public.community_posts(id) on delete set null;
create unique index caddie_feedback_post_unique on public.caddie_analyses(feedback_post_id)
  where feedback_post_id is not null;

-- Existing table-level grants must not let clients forge a feedback link.
create function private.guard_caddie_feedback_link()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.feedback_post_id is not null
    and (tg_op = 'INSERT' or new.feedback_post_id is distinct from old.feedback_post_id) then
    raise exception 'Feedback links are server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon')
    and old.feedback_post_id is not null and new.feedback_post_id is null then
    raise exception 'Feedback links are server managed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_caddie_feedback_link() from public, anon, authenticated;
create trigger guard_caddie_feedback_link before insert or update on public.caddie_analyses
for each row execute function private.guard_caddie_feedback_link();

-- FK nulling is an UPDATE even when the delete comes from another client.
create function private.reset_deleted_caddie_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.feedback_post_id is not null and new.feedback_post_id is null then
    new.shared_to_community := false;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_deleted_caddie_feedback() from public, anon, authenticated;
create trigger reset_deleted_caddie_feedback before update on public.caddie_analyses
for each row execute function private.reset_deleted_caddie_feedback();

-- Definer is necessary because clients must not be able to forge the link.
-- No user-selected author, post ID, media or source analysis is made public.
create function public.share_caddie_feedback(p_analysis_id uuid, p_text text, p_confirm_legacy boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_analysis public.caddie_analyses%rowtype;
  v_post uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  select * into v_analysis from public.caddie_analyses
    where id = p_analysis_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Analysis not found.' using errcode = '42501'; end if;
  if v_analysis.status <> 'complete' then raise exception 'Analysis is not complete.'; end if;
  -- Serialize all devices, double taps and retries (including lost responses).
  -- Keep moderated posts linked too: this must not circumvent removal.
  if v_analysis.feedback_post_id is not null then
    if exists (select 1 from public.community_posts where id = v_analysis.feedback_post_id and removed_at is null) then
      return jsonb_build_object('post_id', v_analysis.feedback_post_id, 'outcome', 'existing');
    end if;
    return jsonb_build_object('post_id', null, 'outcome', 'unavailable');
  end if;
  if v_analysis.shared_to_community and not coalesce(p_confirm_legacy, false) then
    raise exception 'Previous feedback share cannot be verified.' using hint = 'caddie_legacy_share_confirmation';
  end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 10000 then
    raise exception 'Invalid feedback text.';
  end if;
  insert into public.community_posts(author_id, type, text, category, swing_analysis_status)
    values(auth.uid(), 'text', btrim(p_text), 'General', 'not_applicable') returning id into v_post;
  update public.caddie_analyses set feedback_post_id = v_post, shared_to_community = true
    where id = p_analysis_id;
  return jsonb_build_object('post_id', v_post, 'outcome', 'created');
end;
$$;
revoke all on function public.share_caddie_feedback(uuid, text, boolean) from public, anon;
grant execute on function public.share_caddie_feedback(uuid, text, boolean) to authenticated;
commit;
