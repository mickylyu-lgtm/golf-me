-- ---------------------------------------------------------------------------
-- 20261108170000_report_integrity
--
-- Problem (confirmed in the code, 2026-11-08): public.reports accepts
-- whatever the client sends. reports_insert_own only checks
-- reporter_id = auth.uid(); nothing ties reported_post_id /
-- reported_comment_id / reported_message_id / round_id to reported_user_id,
-- or checks that the reporter can see the target. Consequences:
--   * a report can name user X while pointing at Y's post: the admin sees X
--     as "reported" next to Y's content (a wrong suspension risk), and any
--     count of reports per user can be inflated with forged pairs;
--   * reported_message_id is a foreign key, so a client can probe whether an
--     arbitrary message id exists (FK error vs success), and a report naming
--     a message's sender makes the admin chat-evidence view
--     (admin_list_report_chat_media, 20261107220000) show that message's
--     media even when the reporter was never in that conversation; the same
--     for round_id + any participant (round chat media);
--   * the same person can file the same report again and again (each one
--     emails the founder).
--
-- Fix: one BEFORE INSERT trigger on public.reports (SECURITY DEFINER,
-- search_path '') that, for a signed-in reporter:
--   * post / comment: the target must exist and be readable by the reporter
--     (not removed); reported_user_id is DERIVED from its author (the
--     submitted value is ignored), and a comment's post id is filled in;
--   * chat: with a message id, the reporter must be a participant of that
--     message's conversation, and the reported user is the message's sender;
--     without one, reporter and reported user must share a conversation;
--   * round: the round must exist and the reported user must be its host or
--     a participant (rounds are readable by every signed-in user);
--   * profile: the reported user must be an existing, not deleted account;
--   * self-reports are refused;
-- every mismatch raises the same error (P0001 'report_target_invalid'),
-- whether the target is missing, deleted or not the reporter's to see, so
-- nothing about other people's content leaks. It runs before the foreign-key
-- checks, which closes the existence oracle.
-- Dedupe: an equivalent report (same reporter, context and target) that is
-- still open and less than 24 h old makes the new insert a silent no-op
-- (no second row, no second founder email). A different message/post, or a
-- report after the earlier one was closed, is a new incident.
-- Rate limit: at most 20 reports per reporter per hour ('report_rate_limited').
-- Both are race-safe: a per-reporter advisory transaction lock serializes a
-- reporter's concurrent submissions (two devices, double taps).
-- Validated reports get reports.validated_at; rows from before this
-- migration stay NULL and are never counted as validated (they could be
-- forged). Admin views of old rows are unchanged.
--
-- Inserts with no auth.uid() (service role / SQL editor) are not checked.
-- RLS: unchanged (reports_insert_own / reports_select_own); no new table.
-- Needs (applied in production): 20261104120000, 20261107270000
-- (community_*.removed_at).
-- CHECK: report-integrity-check.sql. ROLLBACK: report-integrity-rollback.sql.
-- ---------------------------------------------------------------------------

alter table public.reports add column validated_at timestamptz;

-- Dedupe lookups and the per-user distinct-reporter count.
create index reports_reporter_created_idx on public.reports (reporter_id, created_at desc);
create index reports_reported_user_created_idx on public.reports (reported_user_id, created_at desc)
  where reported_user_id is not null;

create function private.validate_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_post uuid;
  v_conv uuid;
  v_ok boolean := false;
begin
  if v_uid is null then
    return new;
  end if;
  if new.reporter_id is distinct from v_uid then
    -- reports_insert_own refuses this too; same answer either way.
    raise exception 'report_target_invalid' using errcode = 'P0001', hint = 'report_target_invalid';
  end if;

  -- One reporter at a time (dedupe + rate limit are race-safe).
  perform pg_advisory_xact_lock(hashtext('golfme_report:' || v_uid::text));

  if (select count(*) from public.reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'report_rate_limited' using errcode = 'P0001', hint = 'report_rate_limited';
  end if;

  if new.context = 'post' then
    select p.author_id into v_owner from public.community_posts p
     where p.id = new.reported_post_id and p.removed_at is null;
    v_ok := found;
    new.reported_comment_id := null;
    new.reported_message_id := null;
  elsif new.context = 'comment' then
    select c.author_id, c.post_id into v_owner, v_post
      from public.community_comments c
      join public.community_posts p on p.id = c.post_id and p.removed_at is null
     where c.id = new.reported_comment_id and c.removed_at is null;
    v_ok := found;
    new.reported_post_id := v_post;
    new.reported_message_id := null;
  elsif new.context = 'chat' then
    if new.reported_message_id is not null then
      select m.sender_id, m.conversation_id into v_owner, v_conv
        from public.messages m
       where m.id = new.reported_message_id
         and exists (select 1 from public.conversation_participants cp
                      where cp.conversation_id = m.conversation_id and cp.user_id = v_uid);
      v_ok := found;
    else
      v_owner := new.reported_user_id;
      v_ok := v_owner is not null and exists (
        select 1 from public.conversation_participants a
          join public.conversation_participants b on b.conversation_id = a.conversation_id
         where a.user_id = v_uid and b.user_id = v_owner);
    end if;
    new.reported_post_id := null;
    new.reported_comment_id := null;
  elsif new.context = 'round' then
    v_owner := new.reported_user_id;
    v_ok := new.round_id is not null and v_owner is not null and exists (
      select 1 from public.golf_calls g
       where g.id = new.round_id
         and (g.host_user_id = v_owner
              or exists (select 1 from public.round_participants rp
                          where rp.round_id = g.id and rp.user_id = v_owner)));
    new.reported_post_id := null;
    new.reported_comment_id := null;
    new.reported_message_id := null;
  elsif new.context = 'profile' then
    v_owner := new.reported_user_id;
    v_ok := v_owner is not null and exists (
      select 1 from auth.users u where u.id = v_owner and u.deleted_at is null);
    new.reported_post_id := null;
    new.reported_comment_id := null;
    new.reported_message_id := null;
  end if;

  if not v_ok or v_owner is null or v_owner = v_uid then
    raise exception 'report_target_invalid' using errcode = 'P0001', hint = 'report_target_invalid';
  end if;
  new.reported_user_id := v_owner;
  if new.context <> 'round' then
    new.round_id := null;
  end if;

  -- Same incident already reported and still open (last 24 h): no new row.
  if exists (
    select 1 from public.reports r
     where r.reporter_id = v_uid
       and r.status = 'open'
       and r.created_at > now() - interval '24 hours'
       and r.validated_at is not null
       and r.context = new.context
       and r.reported_user_id = new.reported_user_id
       and r.reported_post_id is not distinct from new.reported_post_id
       and r.reported_comment_id is not distinct from new.reported_comment_id
       and r.reported_message_id is not distinct from new.reported_message_id
       and r.round_id is not distinct from new.round_id
  ) then
    return null;
  end if;

  new.validated_at := now();
  new.status := 'open';
  return new;
end;
$$;
revoke execute on function private.validate_report() from public, anon, authenticated;

-- "a_" so it runs before any other BEFORE INSERT trigger on reports.
create trigger a_validate_report
  before insert on public.reports
  for each row execute function private.validate_report();

-- Clients may not set validated_at themselves (only the trigger does; it
-- overwrites the value on insert). No UPDATE policy exists for clients.
