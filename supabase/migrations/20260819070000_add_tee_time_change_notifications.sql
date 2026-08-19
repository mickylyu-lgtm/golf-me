-- Two gaps in Phase 14's tee-time verification: edit_golf_call_tee_time()
-- already returns proof_invalidated specifically so something could act on
-- it, but nothing did at the trigger level -- joined participants were
-- told when proof is ADDED (trg_notify_booking_proof_attached) but never
-- when the tee time itself changes, or when proof is removed/invalidated.
-- Both new triggers follow the exact same shape as the existing ones in
-- this file's family (SECURITY DEFINER function + AFTER UPDATE trigger,
-- plain hardcoded-English text -- matching every other notification row in
-- this table, not a new localization scheme for just these two types).

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('round_joined', 'round_left', 'round_cancelled', 'new_message', 'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round', 'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed'));

-- Fires whenever course/date/tee-time actually changes -- guarded inside
-- the function body (not just by the trigger's "of column" list) because
-- edit_golf_call_tee_time() always includes these columns in its UPDATE's
-- SET list even when a given call leaves them unchanged, and "update of
-- column" fires on any UPDATE that targets the column, not just one that
-- actually changes its value.
create function public.notify_tee_time_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
begin
  if old.course_name is distinct from new.course_name
     or old.date_iso is distinct from new.date_iso
     or old.tee_time_label is distinct from new.tee_time_label then
    select name into v_host_name from public.profiles where id = new.host_user_id;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    select rp.user_id, 'tee_time_updated', new.host_user_id,
      coalesce(v_host_name, 'Your host') || ' updated the tee time for your round at ' || new.course_name || '.',
      '/golf-calls/' || new.id
    from public.round_participants rp
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
  end if;
  return new;
end;
$$;

create trigger trg_notify_tee_time_updated
  after update of course_name, date_iso, tee_time_label on public.golf_calls
  for each row execute function public.notify_tee_time_updated();

revoke execute on function public.notify_tee_time_updated() from public, anon, authenticated;

-- Opposite direction of trg_notify_booking_proof_attached, same column
-- watch -- catches both remove_booking_proof() (an explicit host removal)
-- and edit_golf_call_tee_time()'s own invalidation-on-change path, since
-- both revert tee_time_source to 'manual' the same way.
create function public.notify_booking_proof_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
begin
  if old.tee_time_source = 'user_verified' and new.tee_time_source is distinct from 'user_verified' then
    select name into v_host_name from public.profiles where id = new.host_user_id;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    select rp.user_id, 'booking_proof_removed', new.host_user_id,
      coalesce(v_host_name, 'Your host') || ' removed the booking proof for your round at ' || new.course_name || '.',
      '/golf-calls/' || new.id
    from public.round_participants rp
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
  end if;
  return new;
end;
$$;

create trigger trg_notify_booking_proof_removed
  after update of tee_time_source on public.golf_calls
  for each row execute function public.notify_booking_proof_removed();

revoke execute on function public.notify_booking_proof_removed() from public, anon, authenticated;
