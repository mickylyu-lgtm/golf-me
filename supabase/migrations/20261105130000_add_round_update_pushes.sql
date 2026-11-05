-- Phone pushes for round updates (Micky's picks, 2026-11-04):
--   1. tee time / date / course changed -> every joined player except the
--      host who made the change
--   2. round cancelled                   -> every joined player except the host
--   3. someone joined                    -> the host (already pushed since
--      20260916190000; now also covers a re-join, with a cooldown)
--
-- Same mechanism as every per-event push: the existing AFTER trigger writes
-- the bell row, then queues a pg_net POST to the send-push Edge Function
-- (sent only after the transaction commits; a rolled-back edit sends
-- nothing). No new tables, no new notification types, no client change. The
-- notify-fanout queue is for broadcast audiences with rate limits; a round
-- has at most a handful of players, so it isn't needed here.
--
-- Who gets a push: profiles.push_enabled on AND at least one registered
-- device (send-push would no-op without one anyway). No per-type switch:
-- these are about rounds the golfer is in, same as DMs. The bell row is
-- written either way, as before.
--
-- No duplicate pushes:
--   * One UPDATE that changes course + date + tee time fires the row trigger
--     once -> one push per player. edit_golf_call_tee_time()'s follow-up
--     UPDATE that invalidates booking proof doesn't list those columns, so
--     it doesn't re-fire this trigger (booking_proof_removed stays bell-only).
--   * Updates and the cancellation of a round share one APNs collapse id
--     ('round-<id>'), so a second edit, or a cancel after an edit, replaces
--     the earlier banner on the phone instead of stacking a stale one. Needs
--     the matching send-push change (collapse_id field); an older send-push
--     ignores the field, so the order of deploy vs. apply doesn't matter.
--   * Cancel fires once (old.status <> 'cancelled' guard, unchanged).
--   * Join: a first join (INSERT) pushes the host once. Leaving never pushes.
--     A re-join (join_golf_call's ON CONFLICT DO UPDATE flips 'left' back to
--     'joined', which never fired the INSERT trigger, so re-joins had no bell
--     at all) now writes a bell row, and pushes only if that golfer's
--     previous join of this round didn't already notify the host in the last
--     2 hours -- a join / leave / re-join loop costs the host one push.
--   * No push for a round whose day is over (now() > date_iso + 12h, the
--     same cutoff join_golf_call uses), e.g. a host tidying up an old round
--     by cancelling it. The bell row is still written.
--
-- Copy: localized by the recipient's profiles.language (6 app locales, null
-- or unknown -> English), same approach as notify-fanout. The bell row and
-- the push body are the same sentence (one event, one copy). English join
-- text is unchanged ("Nathan joined your round at Dyker Beach."). The round
-- day comes from date_iso's UTC date (noon on the host's day, see
-- 20261030120000 / src/lib/golfCall.ts roundCalendarDay); the tee time is the
-- host's own label, shown as typed. Existing bell rows are not rewritten.
--
-- Tap target: link_to '/golf-calls/<id>' in both the bell row and the push
-- (App.tsx PushNotificationRouting navigates to data.link_to).
--
-- Not included (mention only): booking_proof_attached / booking_proof_removed
-- stay bell-only. Adding the push is a few lines each, but a host editing the
-- tee time of a verified round would then send two pushes (time + proof
-- removed) for one action.
--
-- ---------------------------------------------------------------------------
-- BEFORE APPLYING: save the live definitions (the exact rollback):
--   select pg_get_functiondef('public.notify_tee_time_updated()'::regprocedure);
--   select pg_get_functiondef('public.notify_round_cancelled()'::regprocedure);
--   select pg_get_functiondef('public.notify_round_joined()'::regprocedure);
--
-- VERIFY (after apply), each should be true:
--   select pg_get_functiondef('public.notify_tee_time_updated()'::regprocedure) like '%send_round_push%';
--   select pg_get_functiondef('public.notify_round_cancelled()'::regprocedure) like '%send_round_push%';
--   select pg_get_functiondef('public.notify_round_joined()'::regprocedure) like '%send_round_push%';
--   select exists (select 1 from pg_trigger where tgname = 'trg_notify_round_rejoined');
--   select not has_function_privilege('authenticated', 'private.send_round_push(text, uuid, text, text, text, text)', 'execute');
--
-- ROLLBACK (restores the repo's previous definitions: 20260819070000 for
-- tee time, 20260813210000 for cancel, 20260916190000 for join; if the
-- saved live definitions above differ, paste those instead):
--   begin;
--   drop trigger if exists trg_notify_round_rejoined on public.round_participants;
--   create or replace function public.notify_tee_time_updated() returns trigger language plpgsql security definer set search_path = '' as $$
--   declare v_host_name text;
--   begin
--     if old.course_name is distinct from new.course_name or old.date_iso is distinct from new.date_iso or old.tee_time_label is distinct from new.tee_time_label then
--       select name into v_host_name from public.profiles where id = new.host_user_id;
--       insert into public.notifications (user_id, type, actor_id, text, link_to)
--       select rp.user_id, 'tee_time_updated', new.host_user_id,
--         coalesce(v_host_name, 'Your host') || ' updated the tee time for your round at ' || new.course_name || '.', '/golf-calls/' || new.id
--       from public.round_participants rp
--       where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
--     end if;
--     return new;
--   end; $$;
--   create or replace function public.notify_round_cancelled() returns trigger language plpgsql security definer set search_path = '' as $$
--   begin
--     if old.status <> 'cancelled' and new.status = 'cancelled' then
--       insert into public.notifications (user_id, type, actor_id, text, link_to)
--       select rp.user_id, 'round_cancelled', new.host_user_id, 'The host cancelled a round you joined.', '/golf-calls/' || new.id
--       from public.round_participants rp
--       where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
--     end if;
--     return new;
--   end; $$;
--   create or replace function public.notify_round_joined() returns trigger language plpgsql security definer set search_path = '' as $$
--   declare v_host uuid; v_course_name text; v_joiner_name text; v_text text; v_push_secret text; v_host_push_enabled boolean;
--   begin
--     if new.participant_status <> 'joined' then return new; end if;
--     select host_user_id, course_name into v_host, v_course_name from public.golf_calls where id = new.round_id;
--     if v_host is null or v_host = new.user_id then return new; end if;
--     select name into v_joiner_name from public.profiles where id = new.user_id;
--     v_text := coalesce(v_joiner_name, 'A golfer') || ' joined your round' || coalesce(' at ' || v_course_name, '') || '.';
--     insert into public.notifications (user_id, type, actor_id, text, link_to) values (v_host, 'round_joined', new.user_id, v_text, '/golf-calls/' || new.round_id);
--     select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
--     if v_push_secret is not null then
--       select push_enabled into v_host_push_enabled from public.profiles where id = v_host;
--       if v_host_push_enabled then
--         perform net.http_post(
--           url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
--           headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
--           body := jsonb_build_object('user_id', v_host, 'title', coalesce(v_joiner_name, 'A golfer'), 'body', v_text, 'link_to', '/golf-calls/' || new.round_id),
--           timeout_milliseconds := 5000);
--       end if;
--     end if;
--     return new;
--   end; $$;
--   drop function if exists private.send_round_push(text, uuid, text, text, text, text);
--   drop function if exists private.round_push_copy(text, text, text, text, text);
--   drop function if exists private.round_push_title(text, text);
--   drop function if exists private.round_push_host_fallback(text);
--   drop function if exists private.round_push_when(text, timestamptz, text);
--   commit;
-- (create or replace keeps the existing revokes on the three trigger functions.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Copy helpers (private schema, never callable by clients)
-- ---------------------------------------------------------------------------

-- "Sat 11/8 8:10 AM" -- always the full date: after a change the golfer
-- needs the exact day, not "this Saturday".
create function private.round_push_when(p_lang text, p_date_iso timestamptz, p_time text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day date := (p_date_iso at time zone 'UTC')::date;
  v_dow integer := extract(dow from v_day)::integer; -- 0 = Sunday
  v_md text := extract(month from v_day)::integer || '/' || extract(day from v_day)::integer;
  v_dm text := extract(day from v_day)::integer || '/' || extract(month from v_day)::integer;
  v_time text := left(btrim(coalesce(p_time, '')), 20);
  v_when text;
begin
  case coalesce(p_lang, 'en')
    when 'es' then v_when := (array['dom','lun','mar','mié','jue','vie','sáb'])[v_dow + 1] || ' ' || v_dm;
    when 'ja' then v_when := v_md || '(' || (array['日','月','火','水','木','金','土'])[v_dow + 1] || ')';
    when 'ko' then v_when := v_md || '(' || (array['일','월','화','수','목','금','토'])[v_dow + 1] || ')';
    when 'zh-CN' then v_when := v_md || ' ' || (array['周日','周一','周二','周三','周四','周五','周六'])[v_dow + 1];
    when 'zh-TW' then v_when := v_md || ' ' || (array['週日','週一','週二','週三','週四','週五','週六'])[v_dow + 1];
    else v_when := (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[v_dow + 1] || ' ' || v_md;
  end case;
  return btrim(v_when || ' ' || v_time);
end;
$$;

create function private.round_push_host_fallback(p_lang text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_lang, 'en')
    when 'es' then 'Tu anfitrión'
    when 'ja' then 'ホスト'
    when 'ko' then '호스트'
    when 'zh-CN' then '发起人'
    when 'zh-TW' then '發起人'
    else 'Your host'
  end;
$$;

-- p_kind: 'updated' | 'cancelled'
create function private.round_push_title(p_lang text, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'cancelled' then
      case coalesce(p_lang, 'en')
        when 'es' then 'Ronda cancelada'
        when 'ja' then 'ラウンドがキャンセルされました'
        when 'ko' then '라운드 취소'
        when 'zh-CN' then '球局已取消'
        when 'zh-TW' then '球局已取消'
        else 'Round cancelled'
      end
    else
      case coalesce(p_lang, 'en')
        when 'es' then 'Ronda actualizada'
        when 'ja' then 'ラウンドが変更されました'
        when 'ko' then '라운드 변경'
        when 'zh-CN' then '球局有变动'
        when 'zh-TW' then '球局有變動'
        else 'Round updated'
      end
  end;
$$;

-- p_kind: 'joined' (p_name = joiner) | 'moved' (course changed) |
-- 'rescheduled' (date/time only) | 'cancelled' (p_name = host).
-- p_when is unused for 'joined'.
create function private.round_push_copy(p_lang text, p_kind text, p_name text, p_course text, p_when text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_name, ''));
  c text := left(btrim(coalesce(p_course, '')), 60);
  w text := coalesce(p_when, '');
begin
  case coalesce(p_lang, 'en')
    when 'es' then
      return case p_kind
        when 'joined' then n || ' se unió a tu ronda en ' || c || '.'
        when 'moved' then n || ' cambió tu ronda a ' || c || ' · ' || w
        when 'rescheduled' then n || ' cambió la hora de salida de tu ronda en ' || c || ': ' || w
        else n || ' canceló tu ronda en ' || c || ' · ' || w
      end;
    when 'ja' then
      return case p_kind
        when 'joined' then n || 'さんが' || c || 'のラウンドに参加しました。'
        when 'moved' then n || 'さんがラウンドを' || c || 'に変更しました · ' || w
        when 'rescheduled' then n || 'さんが' || c || 'のラウンドのティータイムを変更しました：' || w
        else n || 'さんが' || c || 'のラウンド（' || w || '）をキャンセルしました'
      end;
    when 'ko' then
      return case p_kind
        when 'joined' then n || '님이 ' || c || ' 라운드에 참여했어요.'
        when 'moved' then n || '님이 라운드 장소를 ' || c || '(으)로 변경했어요 · ' || w
        when 'rescheduled' then n || '님이 ' || c || ' 라운드 티타임을 변경했어요: ' || w
        else n || '님이 ' || c || ' 라운드(' || w || ')를 취소했어요'
      end;
    when 'zh-CN' then
      return case p_kind
        when 'joined' then n || ' 加入了你在 ' || c || ' 的球局。'
        when 'moved' then n || ' 将球局改到 ' || c || ' · ' || w
        when 'rescheduled' then n || ' 修改了你在 ' || c || ' 的球局开球时间：' || w
        else n || ' 取消了你在 ' || c || ' 的球局（' || w || '）'
      end;
    when 'zh-TW' then
      return case p_kind
        when 'joined' then n || ' 加入了你在 ' || c || ' 的球局。'
        when 'moved' then n || ' 將球局改到 ' || c || ' · ' || w
        when 'rescheduled' then n || ' 修改了你在 ' || c || ' 的球局開球時間：' || w
        else n || ' 取消了你在 ' || c || ' 的球局（' || w || '）'
      end;
    else
      return case p_kind
        when 'joined' then n || ' joined your round at ' || c || '.'
        when 'moved' then n || ' moved your round to ' || c || ' · ' || w
        when 'rescheduled' then n || ' changed the tee time for your round at ' || c || ': ' || w
        else n || ' cancelled your round at ' || c || ' · ' || w
      end;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. One push, best effort. Never raises: a push problem must not fail the
--    edit / cancel / join that caused it.
-- ---------------------------------------------------------------------------
create function private.send_round_push(p_secret text, p_user_id uuid, p_title text, p_body text, p_link_to text, p_collapse_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null then
    return; -- same "no secret configured -> skip" posture as every push trigger
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.push_enabled)
     or not exists (select 1 from public.device_push_tokens t where t.user_id = p_user_id) then
    return;
  end if;
  begin
    perform net.http_post(
      url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('x-internal-secret', p_secret, 'Content-Type', 'application/json'),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', p_user_id,
        'title', p_title,
        'body', p_body,
        'link_to', p_link_to,
        'collapse_id', p_collapse_id
      )),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'send-push request failed for a round update: %', sqlerrm;
  end;
end;
$$;

revoke execute on function private.round_push_when(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function private.round_push_host_fallback(text) from public, anon, authenticated;
revoke execute on function private.round_push_title(text, text) from public, anon, authenticated;
revoke execute on function private.round_push_copy(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.send_round_push(text, uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tee time / date / course changed -> joined players (not the host)
-- ---------------------------------------------------------------------------
-- Same guard as before: the trigger's "of column" list fires whenever the
-- columns are in the SET list (edit_golf_call_tee_time always lists them),
-- so the body checks for a real change.
create or replace function public.notify_tee_time_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
  v_push_secret text;
  v_kind text;
  v_live boolean;
  v_text text;
  v_link text := '/golf-calls/' || new.id;
  r record;
begin
  if old.course_name is not distinct from new.course_name
     and old.date_iso is not distinct from new.date_iso
     and old.tee_time_label is not distinct from new.tee_time_label then
    return new;
  end if;

  v_kind := case when old.course_name is distinct from new.course_name then 'moved' else 'rescheduled' end;
  v_live := new.status in ('open', 'full') and now() <= new.date_iso + interval '12 hours';
  select nullif(btrim(p.name), '') into v_host_name from public.profiles p where p.id = new.host_user_id;
  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;

  for r in
    select rp.user_id, p.language
    from public.round_participants rp
    left join public.profiles p on p.id = rp.user_id
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id
  loop
    v_text := private.round_push_copy(r.language, v_kind,
      coalesce(v_host_name, private.round_push_host_fallback(r.language)),
      new.course_name, private.round_push_when(r.language, new.date_iso, new.tee_time_label));
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (r.user_id, 'tee_time_updated', new.host_user_id, v_text, v_link);
    if v_live then
      perform private.send_round_push(v_push_secret, r.user_id, private.round_push_title(r.language, 'updated'), v_text, v_link, 'round-' || new.id);
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Round cancelled -> joined players (not the host)
-- ---------------------------------------------------------------------------
create or replace function public.notify_round_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_name text;
  v_push_secret text;
  v_live boolean;
  v_text text;
  v_link text := '/golf-calls/' || new.id;
  r record;
begin
  if not (old.status <> 'cancelled' and new.status = 'cancelled') then
    return new;
  end if;

  v_live := now() <= new.date_iso + interval '12 hours';
  select nullif(btrim(p.name), '') into v_host_name from public.profiles p where p.id = new.host_user_id;
  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;

  for r in
    select rp.user_id, p.language
    from public.round_participants rp
    left join public.profiles p on p.id = rp.user_id
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id
  loop
    v_text := private.round_push_copy(r.language, 'cancelled',
      coalesce(v_host_name, private.round_push_host_fallback(r.language)),
      new.course_name, private.round_push_when(r.language, new.date_iso, new.tee_time_label));
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (r.user_id, 'round_cancelled', new.host_user_id, v_text, v_link);
    if v_live then
      perform private.send_round_push(v_push_secret, r.user_id, private.round_push_title(r.language, 'cancelled'), v_text, v_link, 'round-' || new.id);
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Someone joined -> the host. Fires on the first join (INSERT, existing
--    trigger) and now on a re-join (UPDATE 'left' -> 'joined', new trigger).
-- ---------------------------------------------------------------------------
create or replace function public.notify_round_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_course_name text;
  v_date_iso timestamptz;
  v_host_lang text;
  v_joiner_name text;
  v_title text;
  v_text text;
  v_link text := '/golf-calls/' || new.round_id;
  v_push boolean := true;
  v_push_secret text;
begin
  if new.participant_status <> 'joined' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.participant_status = 'joined' then
    return new; -- not a re-join
  end if;
  select g.host_user_id, g.course_name, g.date_iso into v_host, v_course_name, v_date_iso
  from public.golf_calls g where g.id = new.round_id;
  if v_host is null or v_host = new.user_id then
    return new; -- the host's own seat at hosting time, not a real "someone joined" event
  end if;

  select p.language into v_host_lang from public.profiles p where p.id = v_host;
  select nullif(btrim(p.name), '') into v_joiner_name from public.profiles p where p.id = new.user_id;
  v_title := coalesce(v_joiner_name, private.fanout_golfer_fallback(v_host_lang));
  v_text := private.round_push_copy(v_host_lang, 'joined', v_title, v_course_name, null);

  if tg_op = 'UPDATE' then
    -- Re-join: one push per golfer per round per 2 hours (checked before this
    -- row's own bell insert).
    v_push := not exists (
      select 1 from public.notifications n
      where n.user_id = v_host and n.type = 'round_joined' and n.actor_id = new.user_id
        and n.link_to = v_link and n.created_at > now() - interval '2 hours'
    );
  end if;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_host, 'round_joined', new.user_id, v_text, v_link);

  if v_push and now() <= v_date_iso + interval '12 hours' then
    select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
    perform private.send_round_push(v_push_secret, v_host, v_title, v_text, v_link, null);
  end if;

  return new;
end;
$$;

create trigger trg_notify_round_rejoined
  after update of participant_status on public.round_participants
  for each row
  when (old.participant_status is distinct from 'joined' and new.participant_status = 'joined')
  execute function public.notify_round_joined();

-- create or replace keeps the existing revokes; restated so this file
-- stands on its own (trigger functions are never called directly).
revoke execute on function public.notify_tee_time_updated() from public, anon, authenticated;
revoke execute on function public.notify_round_cancelled() from public, anon, authenticated;
revoke execute on function public.notify_round_joined() from public, anon, authenticated;
