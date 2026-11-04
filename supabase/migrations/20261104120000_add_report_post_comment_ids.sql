-- Post and comment reports reach moderation with nothing identifying the
-- content: public.reports (20260813210000) only has reported_user_id,
-- reported_message_id and round_id, so a 'post' / 'comment' report says
-- who was reported but not what for. App Store Guideline 1.2 needs us to be
-- able to act on reported content, so this migration:
--
--   1. Adds reports.reported_post_id -> community_posts(id) and
--      reports.reported_comment_id -> community_comments(id), both nullable
--      and ON DELETE SET NULL (same as reported_message_id: the report
--      survives the content being deleted, it just loses the pointer).
--      Partial indexes so deleting a post/comment doesn't seq-scan reports.
--   2. Re-creates notify_admin_of_report() (20260930100000) with two extra
--      'Post id' / 'Comment id' lines in the founder email. Everything else
--      is copied verbatim: the no-op when the Vault key is missing, the
--      exception block that swallows any alert failure, SECURITY DEFINER,
--      search_path = '', and the trigger-only revoke.
--   3. Drops + re-creates admin_list_reports(integer) (its return type
--      changes) to also return reported_post_id and reported_comment_id.
--      Same private.has_role admin check, SECURITY DEFINER, search_path,
--      revoke/grant. For a comment report with no post id, reported_post_id
--      falls back to the comment's own post_id so the dashboard can still
--      link to the thread.
--
-- RLS is unchanged (reports_insert_own / reports_select_own). No "can the
-- reporter see this post/comment" check is added: community_posts and
-- community_comments are SELECT-able by every authenticated user
-- (community_*_select_authenticated, using (true), never altered since
-- 20260816143600), so the FK check reveals nothing a reporter couldn't
-- already read. As with reported_message_id/round_id today, nothing ties
-- the post/comment to reported_user_id -- the admin should treat the ids as
-- the reporter's claim and verify them.
--
-- The client (src/lib/reportRow.ts) already sends these two columns and
-- falls back to putting the ids in `details` when they don't exist yet, so
-- this can be applied before or after the app change ships.
--
-- VERIFY (run in a transaction and roll back; pg_net's queue insert is
-- rolled back too, so no email is sent):
--
--   -- a) normal user can file a post report carrying the post id
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<normal user uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   insert into public.reports (reporter_id, reported_user_id, reported_post_id, category, context)
--   values ('<normal user uuid>', (select author_id from public.community_posts where id = '<post uuid>'),
--           '<post uuid>', 'Spam', 'post')
--   returning id, reported_post_id, reported_comment_id;   -- expect 1 row, post id set
--   -- and they still can't list the admin queue:
--   select * from public.admin_list_reports(5);            -- expect ERROR 42501
--   rollback;
--
--   -- b) admin listing returns the new columns
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<admin user uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select id, context, reported_post_id, reported_comment_id from public.admin_list_reports(5);
--   rollback;
--
--   -- c) structure
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'reports'
--     and column_name in ('reported_post_id', 'reported_comment_id');   -- expect 2 rows
--
-- ROLLBACK (functions first -- plpgsql bodies don't register column
-- dependencies, so dropping the columns first would silently break them):
--
--   drop function public.admin_list_reports(integer);
--   -- then re-run, verbatim from 20260930100000_report_alerts_and_admin_view.sql:
--   --   * `create function public.admin_list_reports(...)` through its
--   --     revoke/grant lines
--   --   * `create function public.notify_admin_of_report()` as
--   --     `create or replace function ...`, plus its revoke line
--   drop index if exists public.reports_reported_post_id_idx;
--   drop index if exists public.reports_reported_comment_id_idx;
--   alter table public.reports
--     drop column reported_comment_id,
--     drop column reported_post_id;

alter table public.reports
  add column reported_post_id uuid references public.community_posts (id) on delete set null,
  add column reported_comment_id uuid references public.community_comments (id) on delete set null;

create index reports_reported_post_id_idx on public.reports (reported_post_id) where reported_post_id is not null;
create index reports_reported_comment_id_idx on public.reports (reported_comment_id) where reported_comment_id is not null;

create or replace function public.notify_admin_of_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_key text;
  v_admin_email text := 'mickylyu@gmail.com';
  v_reporter_name text;
  v_reporter_username text;
  v_reported_name text;
  v_reported_username text;
  v_category text;
  v_details text;
begin
  -- Everything is inside its own exception block: the alert is strictly
  -- best-effort, and a Vault/pg_net/lookup error must never roll back or
  -- fail the user's report insert. On error we log a warning and move on.
  begin
    select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    -- No key configured -- skip silently, same as the waitlist alert.
    if v_api_key is null then
      return new;
    end if;

    select p.name, p.username into v_reporter_name, v_reporter_username
    from public.profiles p where p.id = new.reporter_id;

    if new.reported_user_id is not null then
      select p.name, p.username into v_reported_name, v_reported_username
      from public.profiles p where p.id = new.reported_user_id;
    end if;

    -- category is client-supplied free text (no CHECK constraint), so for
    -- the subject line strip line breaks and cap the length; jsonb handles
    -- the JSON escaping. The HTML body gets the escaped version.
    v_category := left(regexp_replace(coalesce(new.category, ''), '[\r\n]+', ' ', 'g'), 60);
    -- Cap the details so a huge report can't produce a huge email; escape,
    -- then turn line breaks into <br> so the admin sees the original shape.
    v_details := replace(private.html_escape(left(coalesce(new.details, ''), 2000)), E'\n', '<br>');

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'GolfMe Reports <onboarding@resend.dev>',
        'to', jsonb_build_array(v_admin_email),
        'subject', 'GolfMe user report — ' || v_category || ' (' || new.context || ')',
        'html',
          '<p><strong>New GolfMe user report.</strong> Review it in /admin/dashboard.</p>' ||
          '<p>Category: ' || private.html_escape(v_category) || '<br>' ||
          'Where: ' || private.html_escape(new.context) || '<br>' ||
          'Reported at: ' || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC</p>' ||
          '<p>Reporter: ' || private.html_escape(coalesce(v_reporter_name, 'Unknown')) ||
            coalesce(' (@' || private.html_escape(v_reporter_username) || ')', '') || '<br>' ||
          'Reported user: ' ||
            case when new.reported_user_id is null then '(none)'
                 else private.html_escape(coalesce(v_reported_name, 'Unknown')) ||
                      coalesce(' (@' || private.html_escape(v_reported_username) || ')', '')
            end || '</p>' ||
          '<p>Details:<br>' || case when v_details = '' then '(none given)' else v_details end || '</p>' ||
          '<p style="color:#64748b;font-size:12px">' ||
            'Report id: ' || new.id::text || '<br>' ||
            'Reporter id: ' || new.reporter_id::text ||
            coalesce('<br>Reported user id: ' || new.reported_user_id::text, '') ||
            coalesce('<br>Golf Call id: ' || new.round_id::text, '') ||
            coalesce('<br>Message id: ' || new.reported_message_id::text, '') ||
            coalesce('<br>Post id: ' || new.reported_post_id::text, '') ||
            coalesce('<br>Comment id: ' || new.reported_comment_id::text, '') ||
          '</p>'
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_admin_of_report: alert skipped for report % (%)', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Trigger-only -- never directly callable, same lockdown as every other
-- trigger function in this project. (create or replace keeps the existing
-- privileges; re-stated so this file is self-describing.)
revoke execute on function public.notify_admin_of_report() from public, anon, authenticated;

-- Return type changes, so drop + create (create or replace can't do it).
drop function public.admin_list_reports(integer);

create function public.admin_list_reports(p_limit integer default 100)
returns table (
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reporter_username text,
  reported_user_id uuid,
  reported_name text,
  reported_username text,
  reported_message_id uuid,
  round_id uuid,
  reported_post_id uuid,
  reported_comment_id uuid,
  category text,
  context text,
  details text,
  status text,
  created_at timestamptz
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
  select
    r.id,
    r.reporter_id,
    rp.name,
    rp.username,
    r.reported_user_id,
    tp.name,
    tp.username,
    r.reported_message_id,
    r.round_id,
    coalesce(r.reported_post_id, rc.post_id),
    r.reported_comment_id,
    r.category,
    r.context,
    r.details,
    r.status,
    r.created_at
  from public.reports r
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles tp on tp.id = r.reported_user_id
  left join public.community_comments rc on rc.id = r.reported_comment_id
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke execute on function public.admin_list_reports(integer) from public, anon;
grant execute on function public.admin_list_reports(integer) to authenticated;
