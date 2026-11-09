-- ---------------------------------------------------------------------------
-- 20261108180000_safety_review
--
-- Behaviour-based Safety Review (shadow mode). Admin-only, explainable flags
-- for a human to review. Nothing here enforces anything: no removal, no
-- suspension, no rate limit, no label, no change to what any user sees.
-- Confirmed violations are acted on with the existing reversible moderation
-- tools (20261107270000), by a person.
--
-- Signals (behaviour only; no profile attribute is ever read -- not gender,
-- photo, name, email/relay address, language, rounds or account age):
--   new_recipients    distinct DM conversations whose FIRST message from the
--                     sender falls inside the window (metadata only: sender,
--                     conversation, timestamp; never a message body). Retries
--                     and edits don't multiply: it counts conversations.
--   duplicate_public  the largest group of identical public posts/comments
--                     (normalised text, at least 10 characters) by one
--                     author inside the window. Public content only.
--   distinct_reporters distinct reporters with a VALIDATED report
--                     (20261108170000) against the user inside the window,
--                     not counting dismissed reports.
-- Thresholds are hypotheses for evaluation (Micky 2026-11-08): 10 / 10 min,
-- 5 / 10 min, 3 / 24 h. They live in private.safety_rules, versioned: a
-- change adds a new version, and every flag records the version it was
-- raised under.
--
-- Data separation:
--   facts      = the existing tables (messages metadata, public posts and
--                comments, reports); nothing is copied out of them;
--   signals    = private.safety_flags (counts and times only, no content,
--                no recipient ids);
--   outcomes   = safety_flags.status + private.safety_flag_events (who,
--                when, previous and new state, reason);
--   enforcement= the existing moderation RPCs and their audit log.
--
-- Processing: private.safety_run() evaluates only actors active inside each
-- rule's window (indexed, bounded), upserts at most one open flag per user
-- and signal (no duplicate cases for unchanged evidence; a closed flag is
-- only followed by a new one for events after it), records the run, then
-- applies retention. pg_cron runs it every 5 minutes; it does nothing while
-- the detector is off. The detector ships OFF (safety_settings.detector_enabled
-- = false): turning it on is an admin action, logged.
--
-- Retention (proposal, configurable in safety_settings): flags that were
-- never confirmed (new / in_review / dismissed / appealed) are deleted
-- 30 days after their last observation; confirmed (actioned) flags after
-- 365 days. Flags and their events cascade with the subject's account.
--
-- RLS: every new table is in the private schema, RLS enabled, no policies,
-- no grants. Admin RPCs (SECURITY DEFINER, search_path '', admin role checked
-- on every call): admin_safety_status, admin_safety_list_flags,
-- admin_safety_flag_evidence, admin_safety_review, admin_safety_set_detector,
-- admin_safety_set_rule, admin_safety_run_now.
--
-- Needs: 20261108170000_report_integrity (reports.validated_at),
-- 20261107270000 (private.has_role is older). pg_cron (enabled in
-- production by 20261107240000).
-- CHECK: safety-review-check.sql. ROLLBACK: safety-review-rollback.sql.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'reports' and column_name = 'validated_at') then
    raise exception '20261108170000_report_integrity is not applied. Nothing was changed.';
  end if;
  if to_regprocedure('private.is_suspended(uuid)') is null then
    raise exception '20261107270000_admin_moderation is not applied. Nothing was changed.';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not enabled (20261107240000). Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Settings (one row) and versioned rules
-- ---------------------------------------------------------------------------
create table private.safety_settings (
  id smallint primary key default 1 check (id = 1),
  detector_enabled boolean not null default false,
  unconfirmed_retention_days integer not null default 30 check (unconfirmed_retention_days between 1 and 3650),
  confirmed_retention_days integer not null default 365 check (confirmed_retention_days between 1 and 3650),
  last_run_at timestamptz,
  last_run_ok boolean,
  last_run_error text,
  last_run_flags integer,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into private.safety_settings (id) values (1);
alter table private.safety_settings enable row level security;
revoke all on table private.safety_settings from public, anon, authenticated;

create table private.safety_rules (
  id bigint generated always as identity primary key,
  signal text not null check (signal in ('new_recipients', 'duplicate_public', 'distinct_reporters')),
  version integer not null check (version >= 1),
  threshold integer not null check (threshold between 2 and 1000),
  window_seconds integer not null check (window_seconds between 60 and 604800),
  active boolean not null default true,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (signal, version)
);
create unique index safety_rules_one_active on private.safety_rules (signal) where active;
alter table private.safety_rules enable row level security;
revoke all on table private.safety_rules from public, anon, authenticated;

insert into private.safety_rules (signal, version, threshold, window_seconds, note) values
  ('new_recipients', 1, 10, 600, 'Hypothesis for evaluation (Micky 2026-11-08)'),
  ('duplicate_public', 1, 5, 600, 'Hypothesis for evaluation (Micky 2026-11-08)'),
  ('distinct_reporters', 1, 3, 86400, 'Hypothesis for evaluation (Micky 2026-11-08)');

-- ---------------------------------------------------------------------------
-- 2. Flags and review events
-- ---------------------------------------------------------------------------
create table private.safety_flags (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references auth.users (id) on delete cascade,
  signal text not null check (signal in ('new_recipients', 'duplicate_public', 'distinct_reporters')),
  rule_id bigint not null references private.safety_rules (id),
  rule_version integer not null,
  threshold integer not null,
  window_seconds integer not null,
  observed_count integer not null check (observed_count >= 0),
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'in_review', 'dismissed', 'actioned', 'appealed')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  -- optimistic concurrency for reviewers (two admins, two tabs)
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
-- At most one open case per user and signal.
create unique index safety_flags_one_open on private.safety_flags (subject_user_id, signal)
  where status in ('new', 'in_review', 'appealed');
create index safety_flags_status_created on private.safety_flags (status, created_at desc);
create index safety_flags_subject on private.safety_flags (subject_user_id, signal, last_observed_at desc);
alter table private.safety_flags enable row level security;
revoke all on table private.safety_flags from public, anon, authenticated;

create table private.safety_flag_events (
  id bigint generated always as identity primary key,
  flag_id uuid not null references private.safety_flags (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('raised', 'updated', 'review')),
  previous_status text,
  new_status text,
  reason text check (reason is null or char_length(reason) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index safety_flag_events_flag on private.safety_flag_events (flag_id, id);
alter table private.safety_flag_events enable row level security;
revoke all on table private.safety_flag_events from public, anon, authenticated;

-- Settings/rule changes (admin, what, before/after).
create table private.safety_config_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  change text not null,
  reason text check (reason is null or char_length(reason) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table private.safety_config_events enable row level security;
revoke all on table private.safety_config_events from public, anon, authenticated;

-- Bounded scans for the detector (metadata columns only).
create index if not exists messages_created_at_idx on public.messages (created_at);
create index if not exists messages_sender_conversation_created_idx on public.messages (sender_id, conversation_id, created_at);
create index if not exists community_comments_created_at_idx on public.community_comments (created_at);

-- ---------------------------------------------------------------------------
-- 3. Detector
-- ---------------------------------------------------------------------------

-- Normalised public text for duplicate detection (lower case, whitespace
-- collapsed). Short texts (< 10 characters, e.g. "Nice shot!") never count.
create function private.safety_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(t) >= 10 then t end
    from (select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'))) as t) s;
$$;

-- Candidate counts for one rule at p_now: (user, count, first, last) for
-- users at or above the threshold, counting only events after the user's
-- last closed flag for this signal (no repeat case for the same evidence).
create function private.safety_observe(p_signal text, p_window integer, p_threshold integer, p_now timestamptz)
returns table (subject_user_id uuid, observed_count integer, first_at timestamptz, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := p_now - make_interval(secs => p_window);
begin
  if p_signal = 'new_recipients' then
    return query
    with recent as (
      select m.sender_id, m.conversation_id, min(m.created_at) as first_in_window
        from public.messages m
       where m.created_at > v_from and m.created_at <= p_now
       group by m.sender_id, m.conversation_id
    ),
    firsts as (
      select r.sender_id, r.conversation_id, r.first_in_window
        from recent r
       where not exists (
               select 1 from public.messages e
                where e.sender_id = r.sender_id and e.conversation_id = r.conversation_id
                  and e.created_at < r.first_in_window)
    ),
    since as (
      select f.*, (select max(sf.last_observed_at) from private.safety_flags sf
                    where sf.subject_user_id = f.sender_id and sf.signal = p_signal
                      and sf.status in ('dismissed', 'actioned')) as closed_until
        from firsts f
    )
    select s.sender_id, count(*)::integer, min(s.first_in_window), max(s.first_in_window)
      from since s
     where s.closed_until is null or s.first_in_window > s.closed_until
     group by s.sender_id
    having count(*) >= p_threshold;

  elsif p_signal = 'duplicate_public' then
    return query
    with items as (
      select p.author_id as uid, private.safety_norm(p.text) as k, p.created_at as at
        from public.community_posts p
       where p.created_at > v_from and p.created_at <= p_now
      union all
      select c.author_id, private.safety_norm(c.text), c.created_at
        from public.community_comments c
       where c.created_at > v_from and c.created_at <= p_now
    ),
    since as (
      select i.*, (select max(sf.last_observed_at) from private.safety_flags sf
                    where sf.subject_user_id = i.uid and sf.signal = p_signal
                      and sf.status in ('dismissed', 'actioned')) as closed_until
        from items i where i.k is not null
    ),
    groups as (
      select s.uid, s.k, count(*)::integer as n, min(s.at) as f, max(s.at) as l
        from since s
       where s.closed_until is null or s.at > s.closed_until
       group by s.uid, s.k
    )
    select distinct on (g.uid) g.uid, g.n, g.f, g.l
      from groups g
     where g.n >= p_threshold
     order by g.uid, g.n desc, g.l desc;

  elsif p_signal = 'distinct_reporters' then
    return query
    with v as (
      select r.reported_user_id as uid, r.reporter_id, r.created_at as at,
             (select max(sf.last_observed_at) from private.safety_flags sf
               where sf.subject_user_id = r.reported_user_id and sf.signal = p_signal
                 and sf.status in ('dismissed', 'actioned')) as closed_until
        from public.reports r
       where r.created_at > v_from and r.created_at <= p_now
         and r.validated_at is not null
         and r.status <> 'dismissed'
         and r.reported_user_id is not null
    )
    select v.uid, count(distinct v.reporter_id)::integer, min(v.at), max(v.at)
      from v
     where v.closed_until is null or v.at > v.closed_until
     group by v.uid
    having count(distinct v.reporter_id) >= p_threshold;
  end if;
end;
$$;
revoke execute on function private.safety_observe(text, integer, integer, timestamptz) from public, anon, authenticated;

-- One evaluation pass. Returns the number of flags raised or updated.
-- Never enforces anything. Only called through safety_run (which checks the
-- off switch).
create function private.safety_evaluate(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule private.safety_rules%rowtype;
  v_obs record;
  v_flag private.safety_flags%rowtype;
  v_touched integer := 0;
begin
  for v_rule in select * from private.safety_rules where active order by signal loop
    for v_obs in select * from private.safety_observe(v_rule.signal, v_rule.window_seconds, v_rule.threshold, p_now) loop
      -- Admin accounts (system/founder messages, e.g. the welcome DM) are
      -- not evaluated: role-based, not attribute-based.
      continue when private.has_role(v_obs.subject_user_id, 'admin');
      select * into v_flag from private.safety_flags f
       where f.subject_user_id = v_obs.subject_user_id and f.signal = v_rule.signal
         and f.status in ('new', 'in_review', 'appealed')
       for update;
      if found then
        if v_obs.observed_count > v_flag.observed_count or v_obs.last_at > v_flag.last_observed_at then
          update private.safety_flags
             set observed_count = greatest(observed_count, v_obs.observed_count),
                 last_observed_at = greatest(last_observed_at, v_obs.last_at),
                 first_observed_at = least(first_observed_at, v_obs.first_at)
           where id = v_flag.id;
          insert into private.safety_flag_events (flag_id, kind, details)
          values (v_flag.id, 'updated', jsonb_build_object('observed_count', v_obs.observed_count, 'rule_version', v_rule.version));
          v_touched := v_touched + 1;
        end if;
      else
        insert into private.safety_flags (subject_user_id, signal, rule_id, rule_version, threshold, window_seconds,
                                          observed_count, first_observed_at, last_observed_at)
        values (v_obs.subject_user_id, v_rule.signal, v_rule.id, v_rule.version, v_rule.threshold, v_rule.window_seconds,
                v_obs.observed_count, v_obs.first_at, v_obs.last_at)
        on conflict do nothing
        returning * into v_flag;
        if v_flag.id is not null then
          insert into private.safety_flag_events (flag_id, kind, new_status, details)
          values (v_flag.id, 'raised', 'new', jsonb_build_object('observed_count', v_obs.observed_count, 'rule_version', v_rule.version));
          v_touched := v_touched + 1;
        end if;
      end if;
      v_flag := null;
    end loop;
  end loop;
  return v_touched;
end;
$$;
revoke execute on function private.safety_evaluate(timestamptz) from public, anon, authenticated;

-- Retention: unconfirmed flags after N days, confirmed after M days.
create function private.safety_retention(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s private.safety_settings%rowtype;
  v_n integer;
begin
  select * into v_s from private.safety_settings where id = 1;
  delete from private.safety_flags f
   where (f.status <> 'actioned' and f.last_observed_at < p_now - make_interval(days => v_s.unconfirmed_retention_days))
      or (f.status = 'actioned' and coalesce(f.reviewed_at, f.last_observed_at) < p_now - make_interval(days => v_s.confirmed_retention_days));
  get diagnostics v_n = row_count;
  delete from private.safety_config_events where created_at < p_now - make_interval(days => v_s.confirmed_retention_days);
  return v_n;
end;
$$;
revoke execute on function private.safety_retention(timestamptz) from public, anon, authenticated;

-- The scheduled job. Off = no evaluation (retention still runs, so turning
-- the detector off never keeps signal metadata longer). A failure is
-- recorded (last_run_ok = false) so the dashboard never shows it as "no flags".
create function private.safety_run(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_n integer;
begin
  select detector_enabled into v_enabled from private.safety_settings where id = 1;
  perform private.safety_retention(p_now);
  if not coalesce(v_enabled, false) then
    return;
  end if;
  begin
    v_n := private.safety_evaluate(p_now);
    update private.safety_settings set last_run_at = p_now, last_run_ok = true, last_run_error = null, last_run_flags = v_n where id = 1;
  exception when others then
    update private.safety_settings set last_run_at = p_now, last_run_ok = false, last_run_error = left(sqlerrm, 300), last_run_flags = null where id = 1;
  end;
end;
$$;
revoke execute on function private.safety_run(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin RPCs
-- ---------------------------------------------------------------------------
create function public.admin_safety_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s private.safety_settings%rowtype;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into v_s from private.safety_settings where id = 1;
  return jsonb_build_object(
    'detector_enabled', v_s.detector_enabled,
    'last_run_at', v_s.last_run_at,
    'last_run_ok', v_s.last_run_ok,
    'last_run_error', v_s.last_run_error,
    'unconfirmed_retention_days', v_s.unconfirmed_retention_days,
    'confirmed_retention_days', v_s.confirmed_retention_days,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('signal', r.signal, 'version', r.version, 'threshold', r.threshold,
                                                          'window_seconds', r.window_seconds, 'note', r.note) order by r.signal), '[]'::jsonb)
                from private.safety_rules r where r.active),
    'open_counts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                      from (select f.status, count(*) as n from private.safety_flags f group by f.status) x)
  );
end;
$$;

create function public.admin_safety_list_flags(
  p_status text default null,
  p_signal text default null,
  p_since timestamptz default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  subject_user_id uuid,
  subject_name text,
  subject_username text,
  account_age_days integer,
  signal text,
  rule_version integer,
  threshold integer,
  window_seconds integer,
  observed_count integer,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  status text,
  status_reason text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  revision integer,
  created_at timestamptz,
  subject_suspended boolean
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
  select f.id, f.subject_user_id, p.name, p.username,
         (extract(epoch from (now() - u.created_at)) / 86400)::integer,
         f.signal, f.rule_version, f.threshold, f.window_seconds, f.observed_count,
         f.first_observed_at, f.last_observed_at, f.status, f.status_reason, rp.name, f.reviewed_at, f.revision, f.created_at,
         private.is_suspended(f.subject_user_id)
    from private.safety_flags f
    left join public.profiles p on p.id = f.subject_user_id
    left join auth.users u on u.id = f.subject_user_id
    left join public.profiles rp on rp.id = f.reviewed_by
   where (p_status is null or f.status = p_status)
     and (p_signal is null or f.signal = p_signal)
     and (p_since is null or f.last_observed_at >= p_since)
   order by f.last_observed_at desc, f.id
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- What a reviewer may open for one flag. Public items only for duplicate
-- content; for reports, validated report ids (the Reports section has the
-- details); for new recipients, per-minute counts only (no recipient ids,
-- no conversation ids, no message content).
create function public.admin_safety_flag_evidence(p_flag_id uuid)
returns table (kind text, item_id uuid, post_id uuid, at timestamptz, count integer, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_f private.safety_flags%rowtype;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into v_f from private.safety_flags where id = p_flag_id;
  if not found then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  if v_f.signal = 'duplicate_public' then
    return query
    select x.kind, x.id, x.post_id, x.at, null::integer, null::text from (
      select 'post'::text as kind, p.id, p.id as post_id, p.created_at as at
        from public.community_posts p
       where p.author_id = v_f.subject_user_id and p.created_at between v_f.first_observed_at and v_f.last_observed_at
      union all
      select 'comment', c.id, c.post_id, c.created_at
        from public.community_comments c
       where c.author_id = v_f.subject_user_id and c.created_at between v_f.first_observed_at and v_f.last_observed_at
    ) x order by x.at limit 50;
  elsif v_f.signal = 'distinct_reporters' then
    return query
    select 'report'::text, r.id, r.reported_post_id, r.created_at, null::integer, r.category
      from public.reports r
     where r.reported_user_id = v_f.subject_user_id and r.validated_at is not null
       and r.created_at between v_f.first_observed_at and v_f.last_observed_at
     order by r.created_at limit 50;
  else
    return query
    select 'minute'::text, null::uuid, null::uuid, b.minute, b.n::integer, null::text
      from (
        select date_trunc('minute', r.first_at) as minute, count(*) as n
          from (select m.conversation_id, min(m.created_at) as first_at
                  from public.messages m
                 where m.sender_id = v_f.subject_user_id
                 group by m.conversation_id) r
         where r.first_at between v_f.first_observed_at and v_f.last_observed_at
         group by 1
      ) b order by b.minute limit 120;
  end if;
end;
$$;

-- Review: new -> in_review | dismissed | actioned; in_review -> new |
-- dismissed | actioned; actioned -> appealed; appealed -> dismissed |
-- actioned; dismissed -> in_review (reopen). Reason required except for
-- in_review/new. p_revision must match (concurrent reviewers). Records the
-- event; never enforces.
create function public.admin_safety_review(p_flag_id uuid, p_status text, p_reason text, p_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_f private.safety_flags%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into v_f from private.safety_flags where id = p_flag_id for update;
  if not found then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  if v_f.revision <> coalesce(p_revision, -1) then
    raise exception 'This flag was changed by someone else. Reload and try again.' using errcode = '40001', hint = 'safety_stale';
  end if;
  if not ((v_f.status = 'new' and p_status in ('in_review', 'dismissed', 'actioned'))
       or (v_f.status = 'in_review' and p_status in ('new', 'dismissed', 'actioned'))
       or (v_f.status = 'actioned' and p_status = 'appealed')
       or (v_f.status = 'appealed' and p_status in ('dismissed', 'actioned'))
       or (v_f.status = 'dismissed' and p_status = 'in_review')) then
    raise exception 'That change isn''t allowed from "%".', v_f.status using errcode = '22023';
  end if;
  if p_status in ('dismissed', 'actioned', 'appealed') and v_reason is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'The reason can be at most 500 characters.' using errcode = '22023';
  end if;
  -- Reopening a dismissed flag while another open one exists would break
  -- the one-open-case rule.
  if p_status = 'in_review' and v_f.status = 'dismissed' and exists (
       select 1 from private.safety_flags o where o.subject_user_id = v_f.subject_user_id and o.signal = v_f.signal
          and o.status in ('new', 'in_review', 'appealed') and o.id <> v_f.id) then
    raise exception 'There is already an open case for this user and signal.' using errcode = '22023';
  end if;

  update private.safety_flags
     set status = p_status, status_reason = v_reason, reviewed_by = v_admin, reviewed_at = now(), revision = revision + 1
   where id = v_f.id;
  insert into private.safety_flag_events (flag_id, actor_id, kind, previous_status, new_status, reason)
  values (v_f.id, v_admin, 'review', v_f.status, p_status, v_reason);
  return v_f.revision + 1;
end;
$$;

create function public.admin_safety_set_detector(p_enabled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_old boolean;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_enabled is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  select detector_enabled into v_old from private.safety_settings where id = 1 for update;
  update private.safety_settings set detector_enabled = p_enabled, updated_by = v_admin, updated_at = now() where id = 1;
  insert into private.safety_config_events (actor_id, change, reason, details)
  values (v_admin, 'detector', left(btrim(p_reason), 500), jsonb_build_object('from', v_old, 'to', p_enabled));
end;
$$;

-- A new rule version (the old one stays, inactive, for flags raised under it).
create function public.admin_safety_set_rule(p_signal text, p_threshold integer, p_window_seconds integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_old private.safety_rules%rowtype;
  v_version integer;
begin
  if not private.has_role(v_admin, 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  select * into v_old from private.safety_rules where signal = p_signal and active for update;
  if not found then
    raise exception 'Unknown signal.' using errcode = '22023';
  end if;
  update private.safety_rules set active = false where id = v_old.id;
  v_version := v_old.version + 1;
  insert into private.safety_rules (signal, version, threshold, window_seconds, note, created_by)
  values (p_signal, v_version, p_threshold, p_window_seconds, left(btrim(p_reason), 500), v_admin);
  insert into private.safety_config_events (actor_id, change, reason, details)
  values (v_admin, 'rule', left(btrim(p_reason), 500), jsonb_build_object('signal', p_signal,
          'from', jsonb_build_object('version', v_old.version, 'threshold', v_old.threshold, 'window_seconds', v_old.window_seconds),
          'to', jsonb_build_object('version', v_version, 'threshold', p_threshold, 'window_seconds', p_window_seconds)));
  return v_version;
end;
$$;

-- Runs one pass now (admin testing). Refused while the detector is off, so
-- "off" really means off.
create function public.admin_safety_run_now()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select detector_enabled into v_enabled from private.safety_settings where id = 1;
  if not v_enabled then
    raise exception 'The detector is off.' using errcode = '22023';
  end if;
  perform private.safety_run(now());
  return (select last_run_flags from private.safety_settings where id = 1);
end;
$$;

revoke execute on function public.admin_safety_status() from public, anon;
revoke execute on function public.admin_safety_list_flags(text, text, timestamptz, integer) from public, anon;
revoke execute on function public.admin_safety_flag_evidence(uuid) from public, anon;
revoke execute on function public.admin_safety_review(uuid, text, text, integer) from public, anon;
revoke execute on function public.admin_safety_set_detector(boolean, text) from public, anon;
revoke execute on function public.admin_safety_set_rule(text, integer, integer, text) from public, anon;
revoke execute on function public.admin_safety_run_now() from public, anon;
grant execute on function public.admin_safety_status() to authenticated;
grant execute on function public.admin_safety_list_flags(text, text, timestamptz, integer) to authenticated;
grant execute on function public.admin_safety_flag_evidence(uuid) to authenticated;
grant execute on function public.admin_safety_review(uuid, text, text, integer) to authenticated;
grant execute on function public.admin_safety_set_detector(boolean, text) to authenticated;
grant execute on function public.admin_safety_set_rule(text, integer, integer, text) to authenticated;
grant execute on function public.admin_safety_run_now() to authenticated;
revoke execute on function private.safety_norm(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Schedule (no-op while the detector is off)
-- ---------------------------------------------------------------------------
select cron.schedule('safety-review-run', '*/5 * * * *', 'select private.safety_run()');
