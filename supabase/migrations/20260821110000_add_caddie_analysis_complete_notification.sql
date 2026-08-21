-- Caddie's Roboflow+Gemini pipeline now runs as a background job that can
-- take up to a minute or two (see analyze-swing's EdgeRuntime.waitUntil
-- rewrite) — a golfer who leaves the Caddie screen while it's still
-- running had no way to know when it finished. This adds a real
-- notification (and, via the existing NotificationPopupHost, an in-app
-- popup) the moment a caddie_analyses row reaches status='complete',
-- matching the same trigger-generated pattern already used for
-- tee_time_updated/booking_proof_attached.
--
-- Only 'complete' is covered — a failed analysis deletes its own row
-- (shipped earlier today) rather than reaching a 'failed' status a
-- trigger could observe, and that's an intentional, already-covered case:
-- the golfer is shown the failure directly if they're still on the page,
-- and there's no lingering row to notify about if they're not.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type = any (array[
      'round_joined', 'round_left', 'round_cancelled', 'new_message',
      'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round',
      'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed',
      'caddie_analysis_complete'
    ])
  );

create or replace function public.notify_caddie_analysis_complete()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (new.owner_id, 'caddie_analysis_complete', null, 'Caddie finished analyzing your swing.', '/caddie/' || new.id);
  end if;
  return new;
end;
$$;

create trigger trg_notify_caddie_analysis_complete
  after update of status on public.caddie_analyses
  for each row execute function public.notify_caddie_analysis_complete();

-- Trigger execution doesn't need this — only a direct RPC call would, and
-- this function reads NEW/OLD trigger record fields that don't exist
-- outside trigger context anyway. Revoked to match the same closed-off
-- posture as every other SECURITY DEFINER trigger function here (see
-- handle_new_user).
revoke execute on function public.notify_caddie_analysis_complete() from public, anon, authenticated;
