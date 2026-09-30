-- User reports (profile / chat / round / post / comment) have been landing
-- in public.reports with nobody ever told about them: no trigger, no
-- function reading the table, no admin UI. App Store Guideline 1.2 requires
-- a timely response to reports, so this closes the loop two ways:
--
--   1. An AFTER INSERT trigger emails the founder via Resend the moment a
--      report is filed -- same pg_net + Vault 'resend_api_key' mechanism as
--      notify_admin_of_waitlist_signup() (20260818110000), same recipient,
--      same sender. It no-ops if the key is missing, and any failure inside
--      it is swallowed so a report can never be blocked by the alert.
--   2. admin_list_reports() / admin_set_report_status() back a Reports
--      section on /admin/dashboard, same admin-only SECURITY DEFINER shape
--      as every other admin_* RPC (private.has_role check, execute granted
--      to authenticated only, re-verified server-side on every call).
--
-- reports.status already has a CHECK constraint (open | reviewed |
-- actioned | dismissed, default 'open'); admin_set_report_status only lets
-- an admin move a report to one of the three non-open states.

-- Minimal HTML escaper for user-supplied text going into the alert email
-- body. Report details, names and usernames are all user input, so every
-- one of them goes through this before being concatenated into HTML --
-- '&' first so the entities added after it aren't double-escaped. Lives in
-- the private schema (not exposed through the API) and isn't callable by
-- client roles.
create function private.html_escape(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(
    coalesce(p_text, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;');
$$;

revoke execute on function private.html_escape(text) from public, anon, authenticated;

create function public.notify_admin_of_report()
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
-- trigger function in this project.
revoke execute on function public.notify_admin_of_report() from public, anon, authenticated;

create trigger trg_notify_admin_of_report
  after insert on public.reports
  for each row execute function public.notify_admin_of_report();

-- Report queue for the admin dashboard, newest first. Only what's needed to
-- triage: who reported whom (display name + username), what, where, when,
-- and the ids to look it up -- no emails, locations or other profile data.
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
    r.category,
    r.context,
    r.details,
    r.status,
    r.created_at
  from public.reports r
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles tp on tp.id = r.reported_user_id
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke execute on function public.admin_list_reports(integer) from public, anon;
grant execute on function public.admin_list_reports(integer) to authenticated;

-- Mark a report reviewed / actioned / dismissed. 'open' is only the insert
-- default and isn't settable here; the table's own CHECK constraint is the
-- backstop, but the allowed set is enforced explicitly for a clear error.
create function public.admin_set_report_status(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('reviewed', 'actioned', 'dismissed') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;

  update public.reports set status = p_status where id = p_report_id;
  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_set_report_status(uuid, text) from public, anon;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;
