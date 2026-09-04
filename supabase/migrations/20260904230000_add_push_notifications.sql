-- Real APNs push for DMs. One device (token) can belong to at most one user
-- at a time -- unique on token alone, not (user_id, token), so a phone that
-- signs into a second account doesn't keep receiving the first account's
-- pushes too (upsert on token replaces the owning user_id).
create table public.device_push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'ios' check (platform in ('ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_push_tokens_user_id_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

-- A signed-in user manages only their own device's row -- upsert-by-token
-- from the client (see src/lib/push.ts) needs select+insert+update; no
-- client-facing delete policy (removal only happens server-side, e.g. the
-- send-push function dropping a token Apple reports as unregistered).
create policy "device_push_tokens_select_own" on public.device_push_tokens
  for select using (auth.uid() = user_id);
create policy "device_push_tokens_insert_own" on public.device_push_tokens
  for insert with check (auth.uid() = user_id);
create policy "device_push_tokens_update_own" on public.device_push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-user opt-out, replacing the Settings page's old cosmetic-only local
-- toggle (src/pages/Settings.tsx previously just held this in useState,
-- never persisted, never actually gated anything).
alter table public.profiles add column push_enabled boolean not null default true;

create extension if not exists pg_net;

-- Extends the existing notify_new_message trigger (unchanged in-app
-- notification-row behavior) with a best-effort real push, same "no direct
-- client insert, guaranteed side effect of the real event" posture as every
-- other trigger here. Calls the send-push Edge Function (which owns the
-- actual APNs JWT signing + HTTP/2 call -- Postgres/pg_net can't do ES256
-- JWT signing) via pg_net, same async-HTTP-from-a-trigger pattern already
-- used for the waitlist-signup email. Never blocks or fails the message
-- insert itself: no push-internal-secret configured yet (or any other
-- failure) just means no push goes out, silently, same as the waitlist
-- email trigger's own "no key configured -> skip" behavior.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sender_name text;
  v_push_secret text;
  v_recipient record;
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id, coalesce(v_sender_name, 'A golfer') || ' sent you a message.', '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  select decrypted_secret into v_push_secret from vault.decrypted_secrets where name = 'push_internal_secret' limit 1;
  if v_push_secret is not null then
    for v_recipient in
      select cp.user_id
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id and p.push_enabled
    loop
      perform net.http_post(
        url := 'https://adokdenbmpshqgjbzshb.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('x-internal-secret', v_push_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'user_id', v_recipient.user_id,
          'title', coalesce(v_sender_name, 'A golfer'),
          'body', new.text,
          'link_to', '/messages/' || new.sender_id
        ),
        timeout_milliseconds := 5000
      );
    end loop;
  end if;

  return new;
end;
$function$;

revoke execute on function public.notify_new_message() from public, anon, authenticated;
