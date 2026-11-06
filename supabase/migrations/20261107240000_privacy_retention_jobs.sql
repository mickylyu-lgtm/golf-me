-- Privacy retention jobs (Micky's picks, 2026-11-06): make two Privacy Policy
-- promises true on the server instead of relying on the app. PREPARED, NOT
-- APPLIED: designed by golfme-architect; apply only after Micky's sign-off.
-- Requires 20261107180000_chat_voice (audio_path, chat_image_in_use with
-- audio) and 20261107130000_round_chat_parity (round copies); the guard below
-- refuses to run without them.
--
-- Scheduler: pg_cron. Nothing in our migrations scheduled anything before
-- this (pg_net + Vault are used for triggers only, no Vercel cron, no GitHub
-- schedule). pg_cron is the Supabase-native scheduler (Dashboard ->
-- Integrations -> Cron), runs inside Postgres, needs no new secret and no
-- outside service, and its run history is in cron.job_run_details. Enabling
-- it is the only new moving part.
--
-- 1. Unsent text copies (private.unsent_message_copies,
--    private.unsent_round_message_copies): job 'golfme-purge-unsent-copies',
--    daily 04:17 UTC, runs private.purge_expired_unsent_copies():
--    deletes copies whose unsent_at is more than 90 days ago, EXCEPT copies
--    held by an OPEN report. reports.status is open | reviewed | actioned |
--    dismissed (admin_set_report_status moves a report out of 'open'), so
--    "resolved or closed" = status <> 'open'. Once every holding report is
--    closed, a copy older than 90 days goes at the next daily run. A copy is
--    held by an open report with the same scope that already lets admins see
--    a reported chat's photos (private.chat_image_reported):
--      DM copy:    a report naming that message (reported_message_id), or a
--                  'chat' report against the sender filed by a participant
--                  of that conversation;
--      round copy: a report against the sender on that round (round_id).
--    No hard cap while a report stays open (Micky: "keep until resolved or
--    closed"); the admin dashboard's Reports list is where open reports are
--    closed.
--
-- 2. Orphaned chat-media files (photos / voice messages whose message row no
--    longer points at them: unsent, a deleted row, or an upload whose row
--    never got inserted). SQL can't delete Storage files (storage.protect_delete
--    refuses; a storage.objects row is not the file), so:
--      * public.chat_media_orphans(p_limit) (service_role only) lists objects
--        in chat-media older than 24 hours that no messages / round_messages
--        row references (private.chat_image_in_use: image_path or
--        audio_path). The 24 h grace covers the app's upload-then-insert send
--        and its in-memory "Not sent - Retry" (the file is uploaded first and
--        a retry reuses it). A file a row still points at is never listed, so
--        reported photos and voice messages are kept exactly as before: the
--        reported-chat helper (private.chat_image_reported) only ever covers
--        files a row points at; an unsent photo / voice message is not kept
--        for reports (20261107170000, Micky's "no copy" default).
--      * the new Edge Function chat-media-sweep (verify_jwt off, checks the
--        same x-internal-secret header as send-push: Vault
--        'push_internal_secret' = function secret PUSH_INTERNAL_SECRET, both
--        already set; no new secret) calls it and removes the files through
--        the Storage API with the service role, at most 1000 per run.
--      * job 'golfme-sweep-chat-media', hourly at :23, POSTs to the function
--        via pg_net. With no Vault secret the job does nothing.
--    The app still deletes the file right after an unsend; this is the
--    backstop when that delete fails (offline, app killed).
--
-- Deploy order: chat-media-sweep function (--no-verify-jwt) FIRST, then this
-- file (until the function exists the hourly POST just gets a 404).
-- Verify: privacy-purge-check.sql. Rollback: privacy-purge-rollback.sql
-- (unschedules both jobs, drops the two functions; leaves pg_cron enabled).
--
-- Manual run (SQL editor):
--   select private.purge_expired_unsent_copies();
--   select * from public.chat_media_orphans(50);
--   select * from cron.job_run_details order by start_time desc limit 20;

do $$
begin
  if to_regclass('private.unsent_message_copies') is null
     or to_regclass('private.unsent_round_message_copies') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'messages' and column_name = 'audio_path')
     or to_regprocedure('private.chat_image_in_use(text)') is null then
    raise exception '20261107240000_privacy_retention_jobs needs 20261107130000_round_chat_parity and 20261107180000_chat_voice applied first.';
  end if;
end;
$$;

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1. Unsent text copies: 90 days, unless an open report holds them
-- ---------------------------------------------------------------------------

create or replace function private.purge_expired_unsent_copies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_dm integer;
  v_round integer;
begin
  delete from private.unsent_message_copies u
   where u.unsent_at < v_cutoff
     and not exists (
       select 1 from public.reports r
        where r.status = 'open'
          and (r.reported_message_id = u.message_id
               or (r.context = 'chat'
                   and r.reported_user_id = u.sender_id
                   and exists (select 1 from public.conversation_participants cp
                                where cp.conversation_id = u.conversation_id
                                  and cp.user_id = r.reporter_id))));
  get diagnostics v_dm = row_count;

  delete from private.unsent_round_message_copies u
   where u.unsent_at < v_cutoff
     and not exists (
       select 1 from public.reports r
        where r.status = 'open'
          and r.round_id = u.round_id
          and r.reported_user_id = u.sender_id);
  get diagnostics v_round = row_count;

  return jsonb_build_object('dm_deleted', v_dm, 'round_deleted', v_round);
end;
$$;

revoke execute on function private.purge_expired_unsent_copies() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Orphaned chat-media files: listed here, removed by chat-media-sweep
-- ---------------------------------------------------------------------------

create or replace function public.chat_media_orphans(p_limit integer default 1000)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'chat-media'
     and o.created_at < now() - interval '24 hours'
     and not private.chat_image_in_use(o.name)
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

revoke execute on function public.chat_media_orphans(integer) from public, anon, authenticated;
grant execute on function public.chat_media_orphans(integer) to service_role;

create or replace function private.trigger_chat_media_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/chat-media-sweep',
    headers := jsonb_build_object('x-internal-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function private.trigger_chat_media_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Schedules (idempotent: re-running replaces the jobs)
-- ---------------------------------------------------------------------------

do $$
declare
  v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname in ('golfme-purge-unsent-copies', 'golfme-sweep-chat-media') loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('golfme-purge-unsent-copies', '17 4 * * *', 'select private.purge_expired_unsent_copies()');
  perform cron.schedule('golfme-sweep-chat-media', '23 * * * *', 'select private.trigger_chat_media_sweep()');
end;
$$;
