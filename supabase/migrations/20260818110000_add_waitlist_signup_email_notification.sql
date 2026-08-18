-- Emails the founder the moment someone joins the waitlist. Uses pg_net
-- (async HTTP from Postgres) to call Resend directly from a trigger rather
-- than adding a new Edge Function -- there's no way for this session to
-- set an Edge Function secret (that's a dashboard/CLI-only step, same
-- limitation already documented for GEOAPIFY_API_KEY), but a Postgres
-- secret in Vault IS settable via SQL, so that's the path that can
-- actually be finished end-to-end today.
--
-- The actual Resend API key is NOT in this file -- it's inserted directly
-- into Vault via a one-off `execute_sql` call outside of any migration,
-- same reasoning `.env.local` is gitignored: a real secret value must
-- never land in a tracked file, even though the schema/trigger that
-- references it (by name only, via vault.decrypted_secrets) safely can.
-- If replaying this migration on a fresh environment, the vault secret
-- named 'resend_api_key' must be created separately before this trigger
-- will actually send anything -- it no-ops silently until then (see below).
create extension if not exists pg_net;

create function public.notify_admin_of_waitlist_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_key text;
  v_admin_email text := 'mickylyu@gmail.com';
begin
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  -- No key configured (secret removed/never set) -- skip silently rather
  -- than ever blocking or failing the actual waitlist signup over this.
  if v_api_key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'GolfMe Waitlist <onboarding@resend.dev>',
      'to', jsonb_build_array(v_admin_email),
      'subject', 'New GolfMe waitlist signup — ' || new.home_region,
      'html',
        '<p><strong>New GolfMe waitlist signup.</strong></p>' ||
        '<p>Email: ' || new.email || '<br>' ||
        'Home area: ' || new.home_region || '<br>' ||
        coalesce('Referral source: ' || new.referral_source || '<br>', '') ||
        'Signed up: ' || to_char(new.created_at, 'YYYY-MM-DD HH24:MI') || ' UTC</p>'
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

-- Trigger-only -- never directly callable, same lockdown as every other
-- trigger function in this project.
revoke execute on function public.notify_admin_of_waitlist_signup() from public, anon, authenticated;

create trigger trg_notify_admin_of_waitlist_signup
  after insert on public.waitlist_signups
  for each row execute function public.notify_admin_of_waitlist_signup();
