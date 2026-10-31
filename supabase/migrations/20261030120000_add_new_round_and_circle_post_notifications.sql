-- New-round-nearby and Golf-Circle-post notifications (approved by Micky
-- 2026-10-30, "go with your recommendations").
--
-- 1. A new open real round notifies golfers who could actually join it:
--    course inside the recipient's saved travel radius (recipients and
--    rounds without coordinates are skipped, never guessed), skill and
--    availability respected only where both sides are known, never the
--    host / either side of a block / a banned or deleted account / anyone
--    not onboarded / anyone already in the round. At most 3 per recipient
--    per rolling 24 hours.
-- 2. A new community post (swing posts included) notifies the poster's
--    followers only, at most once per poster -> recipient per 2 hours.
-- 3. Two per-account switches, default ON, server-side:
--    profiles.notify_new_rounds / profiles.notify_circle_posts. Same place
--    and shape as profiles.push_enabled (which still separately gates the
--    phone push; the bell row is written either way).
--
-- Asynchronous fan-out, so hosting/posting never waits on it:
--   AFTER INSERT trigger -> one row in private.notification_fanout_jobs
--   (unique per (kind, source_id), so a re-fired trigger can't enqueue
--   twice) -> pg_net POST {job_id} to the notify-fanout Edge Function, which
--   is queued inside the transaction and only sent after commit -> the
--   function calls claim_notification_fanout() with the service role, which
--   picks recipients in ONE set-based statement, records each in
--   private.notification_fanout_deliveries (primary key (job_id,
--   recipient_id) -- the idempotency ledger AND the rate-limit source),
--   writes the bell rows for newly recorded recipients only, and hands back
--   the pushes still owed. The function batches APNs for all of them and
--   calls finish_notification_fanout(). A retried claim never re-inserts a
--   delivery or a bell row; it only re-returns pushes not yet marked sent.
--   A job stuck pending/processing is retried by the next notify-fanout run
--   (list_stale_notification_fanout_jobs), and expires after 6 hours so a
--   late retry never announces an old event.
--
-- Bell decision: the in-app row and the push are one unit. A recipient over
-- a cap, or with the category switched off, gets neither -- the rounds list
-- and the feed already show everything, and an uncapped bell feed of nearby
-- rounds would bury the personal ones (joins, messages, replies). A
-- recipient with push_enabled off or no registered phone still gets the
-- bell row (that's how web/PWA users see it) and it still counts toward the
-- cap.
--
-- Rollback: see the paired rollback file Micky was given (drops the two
-- triggers, the functions, the private tables, the two columns, and
-- restores the previous notifications_type_check).

-- ---------------------------------------------------------------------------
-- 1. Per-account switches
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column notify_new_rounds boolean not null default true,
  add column notify_circle_posts boolean not null default true;

comment on column public.profiles.notify_new_rounds is
  'Settings -> Notifications -> "New rounds near me". Read by claim_notification_fanout(); false = no bell row and no push for new nearby rounds.';
comment on column public.profiles.notify_circle_posts is
  'Settings -> Notifications -> "Posts from my Golf Circle". Read by claim_notification_fanout(); false = no bell row and no push for posts from people this golfer follows.';

-- Bounding-box prefilter for the radius query (lat range scan, then exact
-- haversine). Partial: golfers without a saved area are never candidates.
create index if not exists profiles_playing_area_lat_idx
  on public.profiles (playing_area_lat)
  where playing_area_lat is not null and playing_area_lng is not null;

-- ---------------------------------------------------------------------------
-- 2. Two new notification types (existing 12 kept verbatim)
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type = any (array[
      'round_joined', 'round_left', 'round_cancelled', 'new_message',
      'comment_reply', 'post_reply', 'round_created_from_post', 'post_became_round',
      'booking_proof_attached', 'tee_time_updated', 'booking_proof_removed',
      'caddie_analysis_complete',
      'new_round_nearby', 'circle_post'
    ])
  );

-- ---------------------------------------------------------------------------
-- 3. Queue + ledger (private schema: not exposed through the API at all;
--    RLS on with no policies and client grants revoked as well)
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table private.notification_fanout_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_round', 'circle_post')),
  source_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'skipped', 'failed')),
  attempts integer not null default 0,
  result text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  unique (kind, source_id)
);
create index notification_fanout_jobs_open_idx
  on private.notification_fanout_jobs (created_at)
  where status in ('pending', 'processing');
create index notification_fanout_jobs_created_at_idx
  on private.notification_fanout_jobs (created_at);

create table private.notification_fanout_deliveries (
  job_id uuid not null references private.notification_fanout_jobs (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('new_round', 'circle_post')),
  actor_id uuid not null,
  source_id uuid not null,
  push_title text not null,
  push_body text not null,
  link_to text not null,
  push_wanted boolean not null,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (job_id, recipient_id)
);
-- "3 new-round pushes per recipient per day"
create index notification_fanout_deliveries_rate_idx
  on private.notification_fanout_deliveries (recipient_id, kind, created_at);
-- "1 post push per poster -> recipient per 2 hours"
create index notification_fanout_deliveries_pair_idx
  on private.notification_fanout_deliveries (actor_id, recipient_id, created_at)
  where kind = 'circle_post';
-- post linked to a round the recipient was already told about
create index notification_fanout_deliveries_source_idx
  on private.notification_fanout_deliveries (source_id, recipient_id);

-- Accounts whose activity never fans out and who never receive fan-out
-- (App Store reviewer, internal test accounts). Empty by default; Micky
-- fills it by hand (see the go-live README).
create table private.notification_fanout_muted_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table private.notification_fanout_jobs enable row level security;
alter table private.notification_fanout_deliveries enable row level security;
alter table private.notification_fanout_muted_users enable row level security;
revoke all on table private.notification_fanout_jobs from public, anon, authenticated;
revoke all on table private.notification_fanout_deliveries from public, anon, authenticated;
revoke all on table private.notification_fanout_muted_users from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Copy (6 locales; profiles.language holds the app's Locale codes, null
--    or unknown -> English)
-- ---------------------------------------------------------------------------
-- A round's date_iso is noon on the host's chosen day converted to UTC, so
-- its UTC calendar date IS the host's day (same rule as the client's
-- roundCalendarDay in src/lib/golfCall.ts). The tee time is the host's own
-- free-text label, shown as typed.
create function private.fanout_round_copy(p_lang text, p_course text, p_date_iso timestamptz, p_time text, p_spots integer)
returns text
language plpgsql
stable -- reads now() for the "within a week -> weekday only" rule
set search_path = ''
as $$
declare
  v_day date := (p_date_iso at time zone 'UTC')::date;
  v_dow integer := extract(dow from v_day)::integer; -- 0 = Sunday
  v_soon boolean := v_day - (now() at time zone 'UTC')::date between -1 and 6;
  v_md text := extract(month from v_day)::integer || '/' || extract(day from v_day)::integer;
  v_dm text := extract(day from v_day)::integer || '/' || extract(month from v_day)::integer;
  v_course text := left(btrim(coalesce(p_course, '')), 60);
  v_time text := left(btrim(coalesce(p_time, '')), 20);
  v_when text;
begin
  case coalesce(p_lang, 'en')
    when 'es' then
      v_when := (array['dom','lun','mar','mié','jue','vie','sáb'])[v_dow + 1] || case when v_soon then '' else ' ' || v_dm end;
      return 'Nueva ronda en ' || v_course || ' · ' || btrim(v_when || ' ' || v_time) || ' · '
        || case when p_spots = 1 then 'Queda 1 plaza' else 'Quedan ' || p_spots || ' plazas' end;
    when 'ja' then
      v_when := case when v_soon then (array['日','月','火','水','木','金','土'])[v_dow + 1] || '曜'
                     else v_md || '(' || (array['日','月','火','水','木','金','土'])[v_dow + 1] || ')' end;
      return v_course || 'で新しいラウンド · ' || btrim(v_when || ' ' || v_time) || ' · ' || p_spots || '枠空きあり';
    when 'ko' then
      v_when := case when v_soon then (array['일','월','화','수','목','금','토'])[v_dow + 1] || '요일'
                     else v_md || '(' || (array['일','월','화','수','목','금','토'])[v_dow + 1] || ')' end;
      return v_course || ' 새 라운드 · ' || btrim(v_when || ' ' || v_time) || ' · ' || p_spots || '자리 남음';
    when 'zh-CN' then
      v_when := case when v_soon then '' else v_md || ' ' end || (array['周日','周一','周二','周三','周四','周五','周六'])[v_dow + 1];
      return v_course || ' 有新球局 · ' || btrim(v_when || ' ' || v_time) || ' · 剩' || p_spots || '个名额';
    when 'zh-TW' then
      v_when := case when v_soon then '' else v_md || ' ' end || (array['週日','週一','週二','週三','週四','週五','週六'])[v_dow + 1];
      return v_course || ' 有新球局 · ' || btrim(v_when || ' ' || v_time) || ' · 剩' || p_spots || '個名額';
    else
      v_when := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[v_dow + 1] || case when v_soon then '' else ' ' || v_md end;
      return 'New round at ' || v_course || ' · ' || btrim(v_when || ' ' || v_time) || ' · '
        || p_spots || case when p_spots = 1 then ' spot open' else ' spots open' end;
  end case;
end;
$$;
create function private.fanout_round_title(p_lang text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_lang, 'en')
    when 'es' then 'Nueva ronda cerca de ti'
    when 'ja' then '近くで新しいラウンド'
    when 'ko' then '근처에 새 라운드'
    when 'zh-CN' then '附近有新球局'
    when 'zh-TW' then '附近有新球局'
    else 'New round near you'
  end;
$$;

-- kind 'bell' = full sentence with the name; 'push' = the line under the
-- name in the push (the push title is the poster's name).
create function private.fanout_post_copy(p_lang text, p_name text, p_is_swing boolean, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'bell' then
      case coalesce(p_lang, 'en')
        when 'es' then p_name || case when p_is_swing then ' compartió un nuevo video de swing.' else ' compartió una nueva publicación.' end
        when 'ja' then p_name || case when p_is_swing then 'さんが新しいスイング動画を投稿しました。' else 'さんが新しい投稿をシェアしました。' end
        when 'ko' then p_name || case when p_is_swing then '님이 새 스윙 영상을 올렸어요.' else '님이 새 게시물을 올렸어요.' end
        when 'zh-CN' then p_name || case when p_is_swing then ' 发布了新的挥杆视频。' else ' 发布了新帖子。' end
        when 'zh-TW' then p_name || case when p_is_swing then ' 發布了新的揮桿影片。' else ' 發布了新貼文。' end
        else p_name || case when p_is_swing then ' shared a new swing video.' else ' shared a new post.' end
      end
    else
      case coalesce(p_lang, 'en')
        when 'es' then case when p_is_swing then 'Compartió un nuevo video de swing' else 'Compartió una nueva publicación' end
        when 'ja' then case when p_is_swing then '新しいスイング動画を投稿しました' else '新しい投稿をシェアしました' end
        when 'ko' then case when p_is_swing then '새 스윙 영상을 올렸어요' else '새 게시물을 올렸어요' end
        when 'zh-CN' then case when p_is_swing then '发布了新的挥杆视频' else '发布了新帖子' end
        when 'zh-TW' then case when p_is_swing then '發布了新的揮桿影片' else '發布了新貼文' end
        else case when p_is_swing then 'Shared a new swing video' else 'Shared a new post' end
      end
  end;
$$;

create function private.fanout_golfer_fallback(p_lang text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_lang, 'en')
    when 'es' then 'Un golfista'
    when 'ja' then 'ゴルファー'
    when 'ko' then '골퍼'
    when 'zh-CN' then '一位球友'
    when 'zh-TW' then '一位球友'
    else 'A golfer'
  end;
$$;

-- Same preview rule as the DM push (20260929120000): whitespace collapsed,
-- over 100 chars cut at a word break after 60 (or hard at 99) plus "…".
create function private.fanout_text_preview(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) > 100 then
    v := left(v, 99);
    v := rtrim(coalesce(substring(v from '^(.{60,}) '), v)) || '…';
  end if;
  return v;
end;
$$;

-- Round day-part slot, same buckets as the client's callToAvailabilitySlot
-- (src/lib/availability.ts). Null when the free-text time can't be read
-- ("Morning", "TBD") -- the caller then matches on weekday/weekend only.
create function private.fanout_round_slot(p_date_iso timestamptz, p_time text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day date := (p_date_iso at time zone 'UTC')::date;
  v_daytype text := case when extract(isodow from v_day) in (6, 7) then 'Weekend' else 'Weekday' end;
  m text[];
  v_hour integer;
begin
  m := regexp_match(coalesce(p_time, ''), '^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]');
  if m is not null then
    v_hour := m[1]::integer;
    if v_hour < 1 or v_hour > 12 then return null; end if;
    v_hour := v_hour % 12 + case when lower(m[3]) = 'p' then 12 else 0 end;
  else
    m := regexp_match(coalesce(p_time, ''), '^\s*(\d{1,2}):(\d{2})\M');
    if m is null then return null; end if;
    v_hour := m[1]::integer;
    if v_hour > 23 then return null; end if;
  end if;
  return v_daytype || ' ' || case when v_hour < 12 then 'Mornings' when v_hour < 17 then 'Afternoons' else 'Evenings' end;
end;
$$;

revoke execute on function private.fanout_round_copy(text, text, timestamptz, text, integer) from public, anon, authenticated;
revoke execute on function private.fanout_round_title(text) from public, anon, authenticated;
revoke execute on function private.fanout_post_copy(text, text, boolean, text) from public, anon, authenticated;
revoke execute on function private.fanout_golfer_fallback(text) from public, anon, authenticated;
revoke execute on function private.fanout_text_preview(text) from public, anon, authenticated;
revoke execute on function private.fanout_round_slot(timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Enqueue triggers (cheap: one insert + one queued pg_net request)
-- ---------------------------------------------------------------------------
create function private.enqueue_notification_fanout(p_kind text, p_source_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_push_secret text;
begin
  insert into private.notification_fanout_jobs (kind, source_id, actor_id)
  values (p_kind, p_source_id, p_actor_id)
  on conflict (kind, source_id) do nothing
  returning id into v_job_id;
  if v_job_id is null then
    return;
  end if;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is null then
    return; -- same "no secret configured -> skip" posture as every push trigger
  end if;

  -- Never let a notification problem fail the round/post insert itself.
  begin
    perform net.http_post(
      url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/notify-fanout',
      headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('job_id', v_job_id),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'notify-fanout enqueue request failed for job %: %', v_job_id, sqlerrm;
  end;
end;
$$;

create function public.enqueue_new_round_fanout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'open' and new.course_lat is not null and new.course_lng is not null then
    perform private.enqueue_notification_fanout('new_round', new.id, new.host_user_id);
  end if;
  return new;
end;
$$;

create function public.enqueue_circle_post_fanout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_notification_fanout('circle_post', new.id, new.author_id);
  return new;
end;
$$;

revoke execute on function private.enqueue_notification_fanout(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.enqueue_new_round_fanout() from public, anon, authenticated;
revoke execute on function public.enqueue_circle_post_fanout() from public, anon, authenticated;

create trigger trg_enqueue_new_round_fanout
  after insert on public.golf_calls
  for each row execute function public.enqueue_new_round_fanout();

create trigger trg_enqueue_circle_post_fanout
  after insert on public.community_posts
  for each row execute function public.enqueue_circle_post_fanout();

-- ---------------------------------------------------------------------------
-- 6. Worker RPCs (service_role only -- called by the notify-fanout function)
-- ---------------------------------------------------------------------------
create function public.claim_notification_fanout(p_job_id uuid)
returns table (recipient_id uuid, title text, body text, link_to text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job private.notification_fanout_jobs%rowtype;
  v_call public.golf_calls%rowtype;
  v_post public.community_posts%rowtype;
  v_spots integer;
  v_slot text;
  v_daytype text;
  v_round_skill integer;
  v_actor_name text;
  v_preview text;
  v_skip text;
  v_count integer;
begin
  -- One claim at a time, globally: makes the "count earlier deliveries,
  -- then insert" rate limit exact under concurrent jobs. Each claim is a
  -- single set-based statement, so the lock is held briefly.
  perform pg_advisory_xact_lock(hashtext('golfme_notification_fanout'));

  select * into v_job from private.notification_fanout_jobs j where j.id = p_job_id for update;
  if not found or v_job.status in ('done', 'skipped', 'failed') then
    return;
  end if;

  if v_job.status = 'processing' then
    -- A previous claim committed its deliveries but never finished sending.
    if v_job.attempts >= 5 then
      update private.notification_fanout_jobs set status = 'failed', result = 'too many attempts', finished_at = now() where id = v_job.id;
      return;
    end if;
    update private.notification_fanout_jobs set attempts = attempts + 1, claimed_at = now() where id = v_job.id;
    return query
      select d.recipient_id, d.push_title, d.push_body, d.link_to
      from private.notification_fanout_deliveries d
      where d.job_id = v_job.id and d.push_wanted and d.pushed_at is null;
    return;
  end if;

  -- status = 'pending': pick recipients now.
  if v_job.created_at < now() - interval '6 hours' then
    v_skip := 'expired';
  elsif exists (select 1 from private.notification_fanout_muted_users m where m.user_id = v_job.actor_id) then
    v_skip := 'actor muted';
  elsif exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = v_job.actor_id
      and p.has_onboarded
      and (u.banned_until is null or u.banned_until <= now())
      and u.deleted_at is null
  ) is not true then
    v_skip := 'actor not eligible';
  end if;

  select coalesce(nullif(btrim(p.name), ''), null) into v_actor_name from public.profiles p where p.id = v_job.actor_id;

  if v_skip is null and v_job.kind = 'new_round' then
    select * into v_call from public.golf_calls g where g.id = v_job.source_id;
    if not found then
      v_skip := 'round gone';
    elsif v_call.status <> 'open' then
      v_skip := 'round not open';
    elsif v_call.course_lat is null or v_call.course_lng is null then
      v_skip := 'round has no coordinates';
    elsif now() > v_call.date_iso + interval '12 hours' then
      v_skip := 'round in the past';
    else
      select v_call.total_spots - count(*) into v_spots
      from public.round_participants rp
      where rp.round_id = v_call.id and rp.participant_status = 'joined';
      if v_spots <= 0 then
        v_skip := 'round full';
      end if;
    end if;

    if v_skip is null then
      v_slot := private.fanout_round_slot(v_call.date_iso, v_call.tee_time_label);
      v_daytype := case when extract(isodow from (v_call.date_iso at time zone 'UTC')::date) in (6, 7) then 'Weekend' else 'Weekday' end;
      v_round_skill := array_position(array['Beginner', 'Intermediate', 'Advanced'], v_call.skill_level);

      with candidates as (
        select p.id, p.language, p.push_enabled
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.has_onboarded
          and p.notify_new_rounds
          and p.id <> v_call.host_user_id
          and (u.banned_until is null or u.banned_until <= now())
          and u.deleted_at is null
          and p.playing_area_lat is not null and p.playing_area_lng is not null
          -- 100 mi = the radius slider's max; ~69 mi per degree of latitude
          and p.playing_area_lat between v_call.course_lat - 1.46 and v_call.course_lat + 1.46
          and 3958.8 * 2 * asin(least(1, sqrt(
                power(sin(radians(v_call.course_lat - p.playing_area_lat) / 2), 2)
                + cos(radians(p.playing_area_lat)) * cos(radians(v_call.course_lat))
                  * power(sin(radians(v_call.course_lng - p.playing_area_lng) / 2), 2)
              ))) <= least(100, case when p.travel_radius_miles > 0 then p.travel_radius_miles else 25 end)
          and not exists (
            select 1 from public.blocks b
            where (b.blocker_id = v_call.host_user_id and b.blocked_id = p.id)
               or (b.blocker_id = p.id and b.blocked_id = v_call.host_user_id)
          )
          and not exists (
            select 1 from public.round_participants rp
            where rp.round_id = v_call.id and rp.user_id = p.id and rp.participant_status = 'joined'
          )
          and not exists (select 1 from private.notification_fanout_muted_users m where m.user_id = p.id)
          -- Skill: exclude only a two-tier gap where both sides are known
          -- (explicit skill_level first, else handicap tiers as in
          -- src/lib/format.ts skillTierFromHandicap; no handicap = unknown).
          and (
            v_round_skill is null
            or coalesce(
                 array_position(array['Beginner', 'Intermediate', 'Advanced'], p.skill_level),
                 case when p.handicap is null then null when p.handicap > 20 then 1 when p.handicap > 10 then 2 else 3 end
               ) is null
            or abs(v_round_skill - coalesce(
                 array_position(array['Beginner', 'Intermediate', 'Advanced'], p.skill_level),
                 case when p.handicap > 20 then 1 when p.handicap > 10 then 2 else 3 end
               )) < 2
          )
          -- Availability: only when the golfer saved at least one real slot.
          and (
            not (p.availability && array['Weekday Mornings', 'Weekday Afternoons', 'Weekday Evenings',
                                         'Weekend Mornings', 'Weekend Afternoons', 'Weekend Evenings'])
            or (v_slot is not null and v_slot = any (p.availability))
            or (v_slot is null and exists (select 1 from unnest(p.availability) a where a like v_daytype || ' %'))
          )
          -- Max 3 per recipient per rolling 24 hours.
          and (
            select count(*) from private.notification_fanout_deliveries d
            where d.recipient_id = p.id and d.kind = 'new_round' and d.created_at > now() - interval '24 hours'
          ) < 3
      ),
      inserted as (
        insert into private.notification_fanout_deliveries
          (job_id, recipient_id, kind, actor_id, source_id, push_title, push_body, link_to, push_wanted)
        select v_job.id, c.id, 'new_round', v_job.actor_id, v_call.id,
               private.fanout_round_title(c.language),
               private.fanout_round_copy(c.language, v_call.course_name, v_call.date_iso, v_call.tee_time_label, v_spots),
               '/golf-calls/' || v_call.id,
               c.push_enabled and exists (select 1 from public.device_push_tokens t where t.user_id = c.id)
        from candidates c
        on conflict (job_id, recipient_id) do nothing
        returning recipient_id, push_body, link_to
      )
      insert into public.notifications (user_id, type, actor_id, text, link_to)
      select i.recipient_id, 'new_round_nearby', v_job.actor_id, i.push_body, i.link_to
      from inserted i;
      get diagnostics v_count = row_count;
    end if;

  elsif v_skip is null and v_job.kind = 'circle_post' then
    select * into v_post from public.community_posts cp where cp.id = v_job.source_id;
    if not found then
      v_skip := 'post gone';
    else
      v_preview := private.fanout_text_preview(v_post.text);

      with candidates as (
        select p.id, p.language, p.push_enabled
        from public.follows f
        join public.profiles p on p.id = f.follower_id
        join auth.users u on u.id = p.id
        where f.following_id = v_post.author_id
          and p.has_onboarded
          and p.notify_circle_posts
          and (u.banned_until is null or u.banned_until <= now())
          and u.deleted_at is null
          and not exists (
            select 1 from public.blocks b
            where (b.blocker_id = v_post.author_id and b.blocked_id = p.id)
               or (b.blocker_id = p.id and b.blocked_id = v_post.author_id)
          )
          and not exists (select 1 from private.notification_fanout_muted_users m where m.user_id = p.id)
          -- Max 1 per poster -> recipient per 2 hours.
          and not exists (
            select 1 from private.notification_fanout_deliveries d
            where d.kind = 'circle_post' and d.actor_id = v_post.author_id and d.recipient_id = p.id
              and d.created_at > now() - interval '2 hours'
          )
          -- A post sharing a round this golfer was already told about.
          and (v_post.golf_call_id is null or not exists (
            select 1 from private.notification_fanout_deliveries d
            where d.source_id = v_post.golf_call_id and d.recipient_id = p.id and d.kind = 'new_round'
          ))
      ),
      inserted as (
        insert into private.notification_fanout_deliveries
          (job_id, recipient_id, kind, actor_id, source_id, push_title, push_body, link_to, push_wanted)
        select v_job.id, c.id, 'circle_post', v_job.actor_id, v_post.id,
               coalesce(v_actor_name, private.fanout_golfer_fallback(c.language)),
               case when v_preview <> '' then v_preview
                    else private.fanout_post_copy(c.language, '', v_post.type = 'swing', 'push') end,
               '/community/' || v_post.id,
               c.push_enabled and exists (select 1 from public.device_push_tokens t where t.user_id = c.id)
        from candidates c
        on conflict (job_id, recipient_id) do nothing
        returning recipient_id, link_to
      )
      insert into public.notifications (user_id, type, actor_id, text, link_to)
      select i.recipient_id, 'circle_post', v_job.actor_id,
             private.fanout_post_copy(p.language, coalesce(v_actor_name, private.fanout_golfer_fallback(p.language)), v_post.type = 'swing', 'bell'),
             i.link_to
      from inserted i
      join public.profiles p on p.id = i.recipient_id;
      get diagnostics v_count = row_count;
    end if;
  end if;

  if v_skip is not null then
    update private.notification_fanout_jobs
      set status = 'skipped', result = v_skip, attempts = attempts + 1, claimed_at = now(), finished_at = now()
      where id = v_job.id;
    return;
  end if;

  update private.notification_fanout_jobs
    set status = 'processing', attempts = attempts + 1, claimed_at = now(), result = coalesce(v_count, 0) || ' recipients'
    where id = v_job.id;

  return query
    select d.recipient_id, d.push_title, d.push_body, d.link_to
    from private.notification_fanout_deliveries d
    where d.job_id = v_job.id and d.push_wanted and d.pushed_at is null;
end;
$$;

-- Marks this job's owed pushes as sent (best effort, same as every other
-- GolfMe push: an APNs rejection is logged, never retried) and closes the
-- job. Also prunes jobs older than 30 days (cascades their ledger rows).
create function public.finish_notification_fanout(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.notification_fanout_deliveries
    set pushed_at = now()
    where job_id = p_job_id and push_wanted and pushed_at is null;
  update private.notification_fanout_jobs
    set status = 'done', finished_at = now()
    where id = p_job_id and status = 'processing';
  delete from private.notification_fanout_jobs where created_at < now() - interval '30 days';
end;
$$;

-- Jobs whose own pg_net call was lost (edge cold-start failure, timeout) or
-- whose sender died mid-way. Expired ones are closed by the next claim.
create function public.list_stale_notification_fanout_jobs(p_limit integer default 10)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select j.id
  from private.notification_fanout_jobs j
  where (j.status = 'pending' and j.created_at < now() - interval '2 minutes')
     or (j.status = 'processing' and j.claimed_at < now() - interval '5 minutes')
  order by j.created_at
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke execute on function public.claim_notification_fanout(uuid) from public, anon, authenticated;
revoke execute on function public.finish_notification_fanout(uuid) from public, anon, authenticated;
revoke execute on function public.list_stale_notification_fanout_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_fanout(uuid) to service_role;
grant execute on function public.finish_notification_fanout(uuid) to service_role;
grant execute on function public.list_stale_notification_fanout_jobs(integer) to service_role;
