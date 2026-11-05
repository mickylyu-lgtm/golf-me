-- Quick reactions on 1:1 DMs (Micky, 2026-11-05: Instagram-style hold ->
-- emoji row). PREPARED, NOT APPLIED: apply only after Micky's sign-off.
--
-- What it does
--   * public.message_reactions: one row per (message, user). Changing the
--     emoji replaces the row's emoji (the client upserts on
--     (message_id, user_id)); removing deletes the row. emoji is one of the
--     six quick reactions the app offers, nothing else.
--   * conversation_id is a copy of the message's conversation, set by the
--     BEFORE trigger from the message row itself (never trusted from the
--     client). It exists so the client can load "reactions in my
--     conversations" with the same .in("conversation_id", ...) filter it
--     uses for messages, instead of a URL listing a thousand message ids.
--   * id is a surrogate primary key on purpose: Supabase Realtime can't run
--     RLS on a DELETE, so a DELETE event reaches every subscriber of the
--     table carrying only the old row's primary key. A random id leaks
--     nothing; (message_id, user_id) as the key would tell everyone who
--     un-reacted to which message.
--
-- Who can do what (RLS, authenticated only; anon has no privileges)
--   * SELECT: reactions on messages the caller can see, i.e. the row's
--     message passes messages_select_participant for the caller (a
--     participant of that conversation, and the message is newer than the
--     caller's own cleared_before). So "Clear chat history" hides the
--     reactions on cleared messages exactly like the messages themselves.
--     Blocks: messages stay readable across a block (the client hides the
--     conversation); reactions follow the messages, same rule.
--   * INSERT / UPDATE: only the caller's own row (user_id = auth.uid()), on
--     a message the caller can see, that is not unsent, and only while no
--     block exists either way between the caller and the conversation's
--     other participant: the same block rule as
--     messages_insert_participant_not_blocked. message_id and user_id can't
--     be changed on an existing row (trigger), only the emoji.
--   * DELETE: only the caller's own row, on a message the caller can see.
--     Allowed across a block (taking a reaction back is never harmful).
--
-- Unsend: no reactions on an unsent message.
--   * The policies refuse a reaction on a row with unsent_at set.
--   * The AFTER UPDATE OF unsent_at trigger on messages deletes the
--     message's reactions in the same transaction as the unsend
--     (public.unsend_message is unchanged).
--   * Race: a reaction being inserted while the same message is unsent.
--     The BEFORE trigger reads the message FOR SHARE, which waits for
--     unsend_message's FOR UPDATE row lock; once that commits it sees
--     unsent_at and refuses (hint reaction_message_unsent). So a reaction
--     can never outlive its message's unsend.
--
-- Retention and deletion: a reaction lives as long as its message and its
-- reactor. message_id ON DELETE CASCADE (message deleted, conversation
-- deleted, sender's account deleted, admin reset) and user_id ON DELETE
-- CASCADE (reactor's account deleted). No copy is kept anywhere. No
-- notification and no push for reactions.
--
-- Realtime: added to supabase_realtime like public.messages; INSERT and
-- UPDATE events are RLS-filtered per subscriber, DELETE carries only id.
-- The client refetches reactions on any event.
--
-- Rollout: the client feature-detects the table (a missing-table error
-- hides the reaction row and pills, no error shown), so this can be applied
-- before or after the client deploy.
--
-- Verify (SQL editor, after applying): the dm-reactions-check.sql query
-- returns true. By hand:
--   select relrowsecurity from pg_class where oid = 'public.message_reactions'::regclass; -- true
--   select policyname, cmd from pg_policies where tablename = 'message_reactions';        -- 4 rows
--   select has_table_privilege('anon', 'public.message_reactions', 'select');             -- false
--   select count(*) from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'message_reactions';             -- 1
--
-- Rollback:
--   alter publication supabase_realtime drop table public.message_reactions;
--   drop trigger if exists messages_clear_reactions_on_unsend on public.messages;
--   drop table if exists public.message_reactions;
--   drop function if exists private.clear_reactions_on_unsend();
--   drop function if exists private.prepare_message_reaction();

create table public.message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  emoji           text not null,
  created_at      timestamptz not null default now(),
  constraint message_reactions_one_per_user unique (message_id, user_id),
  -- U+2764 U+FE0F, U+1F602, U+1F62E, U+1F622, U+1F621, U+1F44D: the six the
  -- app offers (src/lib/reactions.ts QUICK_REACTIONS, same order).
  constraint message_reactions_emoji_check
    check (emoji in (U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E', U&'\+01F622', U&'\+01F621', U&'\+01F44D'))
);

create index message_reactions_conversation_id_idx on public.message_reactions (conversation_id);
create index message_reactions_user_id_idx on public.message_reactions (user_id);

alter table public.message_reactions enable row level security;

revoke all on table public.message_reactions from public, anon;
grant select, insert, update, delete on table public.message_reactions to authenticated;

-- BEFORE INSERT/UPDATE: copy conversation_id from the message, refuse an
-- unsent message (waiting out a concurrent unsend, see header), and keep
-- message_id/user_id fixed on an existing row. SECURITY DEFINER because a
-- FOR SHARE lock needs UPDATE rights on messages, which clients don't have;
-- the policies below have already decided the caller may write this row.
create function private.prepare_message_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_unsent_at timestamptz;
begin
  if tg_op = 'UPDATE' and (new.message_id <> old.message_id or new.user_id <> old.user_id) then
    raise exception 'reaction_immutable: only the emoji of a reaction can change.'
      using errcode = '42501', hint = 'reaction_immutable';
  end if;

  select m.conversation_id, m.unsent_at
    into v_conversation_id, v_unsent_at
    from public.messages m
   where m.id = new.message_id
     for share;

  if not found then
    raise exception 'reaction_not_allowed: message not found.'
      using errcode = '42501', hint = 'reaction_not_allowed';
  end if;

  if v_unsent_at is not null then
    raise exception 'reaction_message_unsent: an unsent message can''t be reacted to.'
      using errcode = 'P0001', hint = 'reaction_message_unsent';
  end if;

  new.conversation_id := v_conversation_id;
  if tg_op = 'UPDATE' and new.emoji is distinct from old.emoji then
    new.created_at := now();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.prepare_message_reaction() from public, anon, authenticated;

create trigger message_reactions_prepare
  before insert or update on public.message_reactions
  for each row execute function private.prepare_message_reaction();

-- Unsend clears the message's reactions, same transaction.
create function private.clear_reactions_on_unsend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unsent_at is not null and old.unsent_at is null then
    delete from public.message_reactions r where r.message_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.clear_reactions_on_unsend() from public, anon, authenticated;

create trigger messages_clear_reactions_on_unsend
  after update of unsent_at on public.messages
  for each row execute function private.clear_reactions_on_unsend();

create policy message_reactions_select_visible_message
  on public.message_reactions for select
  to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );

create policy message_reactions_insert_own_not_blocked
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = message_reactions.message_id
        and m.unsent_at is null
        and not exists (
          select 1
          from private.conversation_other_participants(m.conversation_id) as other_id(other_id)
          join public.blocks b
            on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_id.other_id)
            or (b.blocker_id = other_id.other_id and b.blocked_id = (select auth.uid()))
        )
    )
  );

create policy message_reactions_update_own_not_blocked
  on public.message_reactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = message_reactions.message_id
        and m.unsent_at is null
        and not exists (
          select 1
          from private.conversation_other_participants(m.conversation_id) as other_id(other_id)
          join public.blocks b
            on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_id.other_id)
            or (b.blocker_id = other_id.other_id and b.blocked_id = (select auth.uid()))
        )
    )
  );

create policy message_reactions_delete_own
  on public.message_reactions for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );

alter publication supabase_realtime add table public.message_reactions;
