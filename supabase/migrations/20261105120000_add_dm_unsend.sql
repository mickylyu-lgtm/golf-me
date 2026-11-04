-- Unsend a 1:1 DM within 5 minutes (Micky, 2026-11-04). PREPARED, NOT
-- APPLIED: designed by golfme-architect; apply only after Micky's sign-off.
-- Revised 2026-11-04 (Micky chose option B): the original text is kept in a
-- hidden, admin-only copy in the database so a harassment report can still
-- be checked after an unsend. Never visible in the app.
--
-- What it does
--   * messages.unsent_at (nullable). An unsent message stays as a row (so
--     the conversation shows "<name> unsent a message" where it was, and
--     replies that quoted it still resolve), but its TEXT IS WIPED to ''
--     in public.messages: after unsend the content no longer exists for
--     anyone reading through the API, and the realtime UPDATE payload carries
--     '' only (with the default replica identity, no old values at all).
--   * private.unsent_message_copies: before the wipe, in the SAME
--     transaction (inside unsend_message), the original text plus message
--     id, conversation id, sender id, original created_at and unsent_at are
--     copied here. Same pattern as private.blocked_terms: the private schema
--     is never exposed by PostgREST, RLS is on with NO policies, and nothing
--     is granted to anon/authenticated (authenticated has USAGE on the
--     schema only because RLS helper functions live there; it has no table
--     privilege). Not in the realtime publication. Readable only by the
--     table owner, i.e. the Supabase SQL editor (admin access for v1).
--   * The non-empty text check now allows '' only on an unsent row.
--   * public.unsend_message(p_message_id): the ONLY way to unsend. SECURITY
--     DEFINER because messages has no client UPDATE policy (and still gets
--     none, so a client can never edit text or set unsent_at directly).
--     Server-enforced: caller must be the sender; created_at must be within
--     the last 5 minutes by the database clock (never the phone's); a second
--     call is a harmless no-op ('already_unsent'). Return values and errors
--     are unchanged from the client contract (commit 8471606): 'unsent',
--     'already_unsent', hint unsend_not_allowed (42501), hint
--     unsend_window_expired (P0001).
--   * The recipient's in-app "new_message" notification row for that exact
--     message is deleted. notify_new_message() inserts it in the SAME
--     transaction as the message, so its created_at (now(), the transaction
--     start) equals the message's created_at exactly: the match is precise,
--     not a time window. (Its text never contained the message anyway.)
--
-- Retention and deletion
--   * Deletion: message_id references public.messages ON DELETE CASCADE, so
--     a copy lives exactly as long as its message row does. When the sender
--     deletes their account, auth.users cascades to their messages (as it
--     does today for every message) and so to these copies; same when a
--     conversation row is deleted or admin reset removes messages. A deleted
--     user's hidden text never outlives their visible text.
--   * Retention: 90 days after unsent_at, EXCEPT copies whose message is
--     referenced by a report (kept while the message row exists). No pg_cron
--     in this project, so purging is a manual SQL-editor run:
--       delete from private.unsent_message_copies u
--        where u.unsent_at < now() - interval '90 days'
--          and not exists (select 1 from public.reports r
--                          where r.reported_message_id = u.message_id);
--
-- Admin lookup (SQL editor), e.g. for a report's reported_message_id:
--   select * from private.unsent_message_copies where message_id = '<id>';
--
-- Realtime: the UPDATE reaches the other participant through the existing
-- postgres_changes subscription on messages (RLS-filtered), and the client
-- does a full message refetch on UPDATE. The notifications DELETE refetches
-- the notification list.
--
-- NOT covered here (follow-up, needs the send-push edge function): an APNs
-- push already delivered keeps its lock-screen preview (up to 100 chars).
-- The fix is an apns-collapse-id per message (= message id) on the original
-- push, plus a replacement push with the same collapse id and a generic
-- body on unsend.
--
-- Triggers that fire on the UPDATE: filter_objectionable_text (text '' is
-- never objectionable) and enforce_message_reply_same_conversation (only
-- on reply_to_message_id/conversation_id changes; untouched here).
--
-- Rollout: the client feature-detects the column (it only offers Unsend
-- once fetched rows carry unsent_at) and treats a missing RPC as "can't
-- unsend", so this can be applied before or after the client deploy.
--
-- Verify (SQL editor, after applying):
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'messages' and column_name = 'unsent_at';
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.messages'::regclass and conname = 'messages_text_check';
--   select prosecdef, proconfig from pg_proc where proname = 'unsend_message';
--   select has_function_privilege('anon', 'public.unsend_message(uuid)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.unsend_message(uuid)', 'execute'); -- true
--   select relrowsecurity from pg_class where oid = 'private.unsent_message_copies'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'private' and tablename = 'unsent_message_copies'; -- 0
--   select r, p, has_table_privilege(r, 'private.unsent_message_copies', p)
--     from unnest(array['anon','authenticated']) r,
--          unnest(array['select','insert','update','delete']) p;                          -- all false
--   select count(*) from pg_publication_tables where schemaname = 'private';               -- 0
--
-- Role-simulated test (SQL editor; everything rolls back):
--   begin;
--   -- pick a sender + recipient + conversation, insert two test messages as postgres
--   --   insert into public.messages (id, conversation_id, sender_id, text)
--   --     values ('<fresh id>', '<conv>', '<sender>', 'test unsend');
--   --   insert into public.messages (id, conversation_id, sender_id, text, created_at)
--   --     values ('<old id>', '<conv>', '<sender>', 'old', now() - interval '10 minutes');
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<sender uuid>","role":"authenticated"}';
--   select public.unsend_message('<fresh id>');                 -- 'unsent'
--   select public.unsend_message('<fresh id>');                 -- 'already_unsent'
--   select text, unsent_at from public.messages where id = '<fresh id>'; -- '', <ts>
--   select public.unsend_message('<old id>');                   -- ERROR unsend_window_expired
--   -- (each ERROR aborts the transaction: run the remaining lines in their own begin/rollback)
--   update public.messages set text = 'x' where id = '<fresh id>'; -- UPDATE 0 (no UPDATE policy)
--   select * from private.unsent_message_copies;                -- ERROR permission denied
--   set local request.jwt.claims = '{"sub":"<recipient uuid>","role":"authenticated"}';
--   select * from private.unsent_message_copies;                -- ERROR permission denied
--   select public.unsend_message('<a recipient-visible id sent by the other user>'); -- ERROR unsend_not_allowed
--   reset role;
--   select original_text from private.unsent_message_copies where message_id = '<fresh id>'; -- 'test unsend'
--   rollback;
--   -- anon: begin; set local role anon; select * from private.unsent_message_copies; -- ERROR; rollback;
--
-- Rollback (unsent rows must be dealt with first: their public text is gone;
-- the copies hold it, so restore from them before dropping the table):
--   drop function if exists public.unsend_message(uuid);
--   update public.messages m set text = u.original_text, unsent_at = null
--     from private.unsent_message_copies u where u.message_id = m.id;  -- or delete those rows
--   delete from public.messages where unsent_at is not null;            -- any left without a copy
--   drop table if exists private.unsent_message_copies;
--   alter table public.messages drop constraint messages_text_check;
--   alter table public.messages add constraint messages_text_check check (char_length(text) > 0);
--   alter table public.messages drop column unsent_at;

alter table public.messages
  add column unsent_at timestamptz null;

-- Replace the original inline check (char_length(text) > 0), whatever name
-- Postgres gave it, with a named one that also allows a wiped unsent row.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.messages'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%char_length(text) > 0%'
  loop
    execute format('alter table public.messages drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.messages
  add constraint messages_text_check
  check (char_length(text) > 0 or (unsent_at is not null and text = ''));

-- Hidden admin-only copy of unsent text. The schema already exists (created
-- in 20260814104127); kept idempotent like the other private-schema files.
create schema if not exists private;

create table private.unsent_message_copies (
  message_id          uuid primary key references public.messages (id) on delete cascade,
  conversation_id     uuid not null,
  sender_id           uuid not null,
  original_text       text not null,
  original_created_at timestamptz not null,
  unsent_at           timestamptz not null
);

create index unsent_message_copies_unsent_at_idx
  on private.unsent_message_copies (unsent_at);

-- RLS on with no policies, plus no grants: only the table owner can read it.
alter table private.unsent_message_copies enable row level security;
revoke all on table private.unsent_message_copies from public, anon, authenticated;

create function public.unsend_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'unsend_not_allowed: sign in to unsend.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- Row lock: two taps (or two devices) can't race each other.
  select * into v_msg from public.messages where id = p_message_id for update;

  -- Same error for "no such message" and "not yours", so this can't be used
  -- to probe other conversations' message ids.
  if not found or v_msg.sender_id <> v_uid then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  if v_msg.unsent_at is not null then
    return 'already_unsent';
  end if;

  if v_msg.created_at <= v_now - interval '5 minutes' then
    raise exception 'unsend_window_expired: messages can only be unsent within 5 minutes.'
      using errcode = 'P0001', hint = 'unsend_window_expired';
  end if;

  -- Hidden copy first, same transaction: if anything below fails, neither
  -- the copy nor the wipe happens. The row lock + unsent_at check above
  -- means this runs at most once per message.
  insert into private.unsent_message_copies
    (message_id, conversation_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.conversation_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  update public.messages
     set text = '', unsent_at = v_now
   where id = p_message_id;

  delete from public.notifications n
   where n.type = 'new_message'
     and n.actor_id = v_msg.sender_id
     and n.created_at = v_msg.created_at
     and n.user_id in (
       select cp.user_id
       from public.conversation_participants cp
       where cp.conversation_id = v_msg.conversation_id
         and cp.user_id <> v_msg.sender_id
     );

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_message(uuid) from public, anon;
grant execute on function public.unsend_message(uuid) to authenticated;
