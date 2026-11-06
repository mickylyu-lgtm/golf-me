-- Round group chat parity with DMs (Micky, 2026-11-05: "unsend and hold
-- reaction and every other normal chat function don't apply" in round
-- chats). PREPARED, NOT APPLIED: designed by golfme-architect; apply only
-- after Micky's sign-off. Requires every earlier migration (round_messages
-- 20260820040000, the host-block rule 20260924100300, the read-only lock
-- 20261103120000, and the DM versions this copies: 20261026120000 replies,
-- 20261105120000 unsend, 20261105150000 + 20261105160000 reactions,
-- 20261106160000 ordering).
--
-- Who counts as "in" a round chat (unchanged, private.is_round_member):
-- the host, or a participant whose status is 'joined'. That is the rule for
-- READING round_messages. POSTING additionally needs no block either way
-- with the host and the round still 'open'/'full' (round_messages insert
-- policy, 20261103120000). Everything below follows those two rules:
--   * read a reaction                 = read the chat
--   * add / change a reaction         = post to the chat
--   * remove my own reaction (DELETE) = read the chat (allowed across a
--     block and after the round, like DMs: removal only ever takes away)
--   * reply (quote)                   = post, quoting a message of the same round
--   * unsend                          = the sender, still in the chat, within
--     5 minutes by the database clock (allowed after the round ended and
--     across a block: it only removes)
--
-- 1. Replies: round_messages.reply_to_message_id (nullable, same round,
--    ON DELETE SET NULL), enforced by a trigger like DMs'. The trigger checks
--    membership BEFORE looking at the quoted id, so a non-member can't use
--    it to probe which message ids belong to a round (the insert is then
--    refused by the unchanged RLS policy, with its usual message).
--
-- 2. Unsend: round_messages.unsent_at, text wiped to '' (the non-empty
--    check now allows '' only on an unsent row), and
--    public.unsend_round_message(p_message_id), the ONLY way to unsend
--    (round_messages still has no client UPDATE policy). Same contract as
--    public.unsend_message so the client's lib/unsend.ts reads both:
--    'unsent', 'already_unsent', hint unsend_not_allowed (42501), hint
--    unsend_window_expired (P0001). Authorization comes first: "no such
--    message", "not yours" and "not in this round (any more)" are the same
--    unsend_not_allowed, decided before the row is locked or its unsent /
--    window state is looked at.
--    Before the wipe, in the same transaction, the original text goes to
--    private.unsent_round_message_copies (same design as
--    private.unsent_message_copies: private schema, RLS on, no policies, no
--    grants, not in realtime; SQL-editor-only admin access). A copy cascades
--    with its message (round deleted, sender's account deleted). Retention:
--    90 days, purged manually (round messages can't be reported in the app
--    today, so there is no report exception):
--      delete from private.unsent_round_message_copies
--       where unsent_at < now() - interval '90 days';
--    Round chat has no in-app notification or push per message, so there is
--    nothing to retract.
--
-- 3. Reactions: public.round_message_reactions, a separate table rather
--    than generalising public.message_reactions (its conversation_id is NOT
--    NULL with an FK to conversations, and its triggers, policies and
--    rollbacks are live; touching them risks DMs). Same shape as the DM
--    table after 20261106160000: one row per (message, user), emoji one of
--    the six or NULL (tombstone = removed), client_seq ordering from the
--    start (a lower sequence than stored is ignored: no error, 0 rows),
--    round_id filled in by the trigger from the message (never trusted from
--    the client). The authorization trigger is the HARDENED one
--    (20261105160000 pattern): user_id = me, I'm in the chat, I may post
--    there (no block with the host, round open/full) are all checked before
--    the message is locked or its unsent state read, and every refusal is
--    the same error (42501, 'reaction_not_allowed'). Unsend clears the
--    message's reactions in the same transaction (AFTER UPDATE OF unsent_at
--    trigger). In the realtime publication (RLS-filtered per subscriber).
--
-- Blocks: exactly round chat's existing rule, a block either way with the
-- HOST. Blocks between two non-host members are not a round chat rule today
-- (their messages are already mutually visible), and reactions don't add
-- one.
--
-- Client rollout (src/context/RealRoundsContext.tsx): every part is
-- feature-detected, so the client can ship before or after this:
--   * replies / unsend are offered only once fetched round_messages rows
--     carry reply_to_message_id / unsent_at (select "*");
--   * reactions only once a select on round_message_reactions succeeds
--     (missing table: PGRST205 / 42P01 -> no reaction row, no pills, no
--     errors).
--
-- Verify: roundchat-parity-check.sql returns true (one row).
-- Rollback: roundchat-parity-rollback.sql (restores unsent text from the
-- copies first).

-- ---------------------------------------------------------------------------
-- 1. Replies
-- ---------------------------------------------------------------------------

alter table public.round_messages
  add column reply_to_message_id uuid null
    references public.round_messages (id) on delete set null;

create index round_messages_reply_to_message_id_idx
  on public.round_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create function private.enforce_round_message_reply_same_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  -- Not in this round's chat: say nothing about the quoted id; the insert
  -- policy refuses the row right after this trigger.
  if auth.uid() is not null and not private.is_round_member(new.round_id) then
    return new;
  end if;
  if not exists (
    select 1
      from public.round_messages m
     where m.id = new.reply_to_message_id
       and m.round_id = new.round_id
  ) then
    raise exception 'reply_not_in_round: a reply must quote a message from the same round.'
      using errcode = 'check_violation',
            hint    = 'reply_not_in_round';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_round_message_reply_same_round() from public, anon, authenticated;

create trigger enforce_round_message_reply_same_round
  before insert or update of reply_to_message_id, round_id on public.round_messages
  for each row execute function private.enforce_round_message_reply_same_round();

-- ---------------------------------------------------------------------------
-- 2. Unsend
-- ---------------------------------------------------------------------------

alter table public.round_messages
  add column unsent_at timestamptz null;

-- Replace the original inline check (length(text) > 0), whatever name
-- Postgres gave it, with a named one that also allows a wiped unsent row.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.round_messages'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%length(text) > 0%'
  loop
    execute format('alter table public.round_messages drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.round_messages
  add constraint round_messages_text_check
  check (length(text) > 0 or (unsent_at is not null and text = ''));

create schema if not exists private;

create table private.unsent_round_message_copies (
  message_id          uuid primary key references public.round_messages (id) on delete cascade,
  round_id            uuid not null,
  sender_id           uuid not null,
  original_text       text not null,
  original_created_at timestamptz not null,
  unsent_at           timestamptz not null
);

create index unsent_round_message_copies_unsent_at_idx
  on private.unsent_round_message_copies (unsent_at);

-- RLS on with no policies, plus no grants: only the table owner can read it.
alter table private.unsent_round_message_copies enable row level security;
revoke all on table private.unsent_round_message_copies from public, anon, authenticated;

create function public.unsend_round_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_msg public.round_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- 1. Authorize. No lock, and nothing about the message's state decides
  --    the error: missing, someone else's, or a round I'm no longer in all
  --    read the same.
  select * into v_msg from public.round_messages where id = p_message_id;
  if not found or v_msg.sender_id <> v_uid or not private.is_round_member(v_msg.round_id) then
    raise exception 'unsend_not_allowed: only the sender can unsend a message.'
      using errcode = '42501', hint = 'unsend_not_allowed';
  end if;

  -- 2. Row lock (two taps or two devices can't race), then re-read.
  select * into v_msg from public.round_messages where id = p_message_id for update;
  if not found then
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
  -- the copy nor the wipe happens.
  insert into private.unsent_round_message_copies
    (message_id, round_id, sender_id, original_text, original_created_at, unsent_at)
  values
    (v_msg.id, v_msg.round_id, v_msg.sender_id, v_msg.text, v_msg.created_at, v_now);

  -- Fires round_messages_clear_reactions_on_unsend (section 3).
  update public.round_messages
     set text = '', unsent_at = v_now
   where id = p_message_id;

  return 'unsent';
end;
$$;

revoke execute on function public.unsend_round_message(uuid) from public, anon;
grant execute on function public.unsend_round_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reactions
-- ---------------------------------------------------------------------------

create table public.round_message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.round_messages (id) on delete cascade,
  round_id   uuid not null references public.golf_calls (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text null,
  client_seq bigint null,
  created_at timestamptz not null default now(),
  constraint round_message_reactions_one_per_user unique (message_id, user_id),
  -- U+2764 U+FE0F, U+1F602, U+1F62E, U+1F622, U+1F621, U+1F44D: the six the
  -- app offers (src/lib/reactions.ts QUICK_REACTIONS). NULL = tombstone.
  constraint round_message_reactions_emoji_check
    check (emoji in (U&'\2764\FE0F', U&'\+01F602', U&'\+01F62E', U&'\+01F622', U&'\+01F621', U&'\+01F44D'))
);

comment on column public.round_message_reactions.client_seq is
  'Client write sequence per (message, user); a lower one than stored is ignored (as 20261106160000 for DMs).';
comment on column public.round_message_reactions.emoji is
  'One of the six quick reactions; NULL = removed (tombstone, keeps client_seq).';

create index round_message_reactions_round_id_idx on public.round_message_reactions (round_id);
create index round_message_reactions_user_id_idx on public.round_message_reactions (user_id);

alter table public.round_message_reactions enable row level security;

revoke all on table public.round_message_reactions from public, anon;
grant select, insert, update, delete on table public.round_message_reactions to authenticated;

-- Authorization first (20261105160000 pattern), then the lock + unsent
-- check, one error for every refusal. Also fills round_id and created_at.
create function private.prepare_round_message_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_round_id uuid;
  v_unsent_at timestamptz;
  v_allowed boolean;
begin
  if tg_op = 'UPDATE' and (new.message_id <> old.message_id or new.user_id <> old.user_id) then
    raise exception 'reaction_immutable: only the emoji of a reaction can change.'
      using errcode = '42501', hint = 'reaction_immutable';
  end if;

  -- 1. Authorize. No lock, and nothing about the message decides the error.
  select m.round_id
    into v_round_id
    from public.round_messages m
   where m.id = new.message_id;

  if v_uid is null then
    v_allowed := v_round_id is not null;
  else
    v_allowed := v_round_id is not null
      and new.user_id = v_uid
      and private.is_round_member(v_round_id)
      and exists (
        select 1
          from public.golf_calls gc
         where gc.id = v_round_id
           and gc.status in ('open', 'full')
           and not private.has_block_between(v_uid, gc.host_user_id)
      );
  end if;

  if v_allowed then
    -- 2. Lock (waits for a concurrent unsend to commit) and re-read.
    select m.unsent_at
      into v_unsent_at
      from public.round_messages m
     where m.id = new.message_id
       for share;
    v_allowed := found and v_unsent_at is null;
  end if;

  -- 3. One error for every refusal.
  if not coalesce(v_allowed, false) then
    raise exception 'reaction_not_allowed'
      using errcode = '42501', hint = 'reaction_not_allowed';
  end if;

  new.round_id := v_round_id;
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

revoke execute on function private.prepare_round_message_reaction() from public, anon, authenticated;

create trigger round_message_reactions_prepare
  before insert or update on public.round_message_reactions
  for each row execute function private.prepare_round_message_reaction();

-- Ordering (20261106160000 pattern). Its own function, so either chat's
-- migration can be rolled back without the other.
create function private.order_round_message_reaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_seq is not null and old.client_seq is not null and new.client_seq < old.client_seq then
    return null; -- stale: skip this row, no error
  end if;
  if new.client_seq is null then
    new.client_seq := old.client_seq; -- an explicit NULL never lowers the stored sequence
  end if;
  return new;
end;
$$;

revoke execute on function private.order_round_message_reaction() from public, anon, authenticated;

-- "sequence" sorts after "prepare": authorization first.
create trigger round_message_reactions_sequence
  before update on public.round_message_reactions
  for each row execute function private.order_round_message_reaction();

create function private.clear_round_reactions_on_unsend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unsent_at is not null and old.unsent_at is null then
    delete from public.round_message_reactions r where r.message_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.clear_round_reactions_on_unsend() from public, anon, authenticated;

create trigger round_messages_clear_reactions_on_unsend
  after update of unsent_at on public.round_messages
  for each row execute function private.clear_round_reactions_on_unsend();

-- RLS (defence in depth: the trigger above already refused anything these
-- would refuse, with the uniform error).
create policy round_message_reactions_select_member
  on public.round_message_reactions for select
  to authenticated
  using (private.is_round_member(round_id));

create policy round_message_reactions_insert_own_can_post
  on public.round_message_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_round_member(round_id)
    and exists (
      select 1
        from public.round_messages m
        join public.golf_calls gc on gc.id = m.round_id
       where m.id = round_message_reactions.message_id
         and m.round_id = round_message_reactions.round_id
         and m.unsent_at is null
         and gc.status in ('open', 'full')
         and not private.has_block_between((select auth.uid()), gc.host_user_id)
    )
  );

create policy round_message_reactions_update_own_can_post
  on public.round_message_reactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.is_round_member(round_id)
    and exists (
      select 1
        from public.round_messages m
        join public.golf_calls gc on gc.id = m.round_id
       where m.id = round_message_reactions.message_id
         and m.round_id = round_message_reactions.round_id
         and m.unsent_at is null
         and gc.status in ('open', 'full')
         and not private.has_block_between((select auth.uid()), gc.host_user_id)
    )
  );

create policy round_message_reactions_delete_own
  on public.round_message_reactions for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_round_member(round_id)
  );

alter publication supabase_realtime add table public.round_message_reactions;

notify pgrst, 'reload schema';
