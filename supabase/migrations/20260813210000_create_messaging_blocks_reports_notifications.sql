-- Real DMs, blocks, reports, and notifications (Phase 5 of the real-backend
-- migration). Same philosophy as Phase 4: the database enforces the
-- invariants that matter (blocking actually prevents new messages;
-- notifications are a guaranteed side effect of the real event, never
-- something the client has to remember to also do) rather than trusting the
-- client to behave.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

alter table public.conversation_participants enable row level security;

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (char_length(text) > 0),
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = (select auth.uid())
  ));

-- No insert policy — conversations are only ever created by
-- get_or_create_dm_conversation() below.

create policy "conversation_participants_select_fellow_participant"
  on public.conversation_participants for select
  to authenticated
  using (exists (
    select 1 from public.conversation_participants cp2
    where cp2.conversation_id = conversation_participants.conversation_id and cp2.user_id = (select auth.uid())
  ));

create policy "conversation_participants_update_own_read_state"
  on public.conversation_participants for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No insert policy — rows are only ever created by
-- get_or_create_dm_conversation() below.

-- A golfer can see blocks they created AND blocks against them (needed to
-- know "has this person blocked me," same as the existing mock's
-- isBlockedBy), but never anyone else's.
create policy "blocks_select_own_or_against_self"
  on public.blocks for select
  to authenticated
  using ((select auth.uid()) in (blocker_id, blocked_id));

create policy "blocks_insert_own"
  on public.blocks for insert
  to authenticated
  with check (blocker_id = (select auth.uid()));

create policy "blocks_delete_own"
  on public.blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = (select auth.uid())
  ));

-- The block check lives in the write path itself, not just client UI —
-- blocking someone makes new messages to them fail here, at the database.
create policy "messages_insert_participant_not_blocked"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = (select auth.uid())
    )
    and not exists (
      select 1 from public.conversation_participants other_cp
      join public.blocks b
        on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_cp.user_id)
        or (b.blocker_id = other_cp.user_id and b.blocked_id = (select auth.uid()))
      where other_cp.conversation_id = messages.conversation_id and other_cp.user_id <> (select auth.uid())
    )
  );

-- Finds the existing 1:1 conversation between the caller and the other
-- user, or creates one. SECURITY DEFINER since conversations/
-- conversation_participants have no client-facing insert policy — this
-- function is the only sanctioned way one gets created. A benign, accepted
-- race: two people messaging each other for the very first time at the
-- exact same instant could each create a separate conversation (no locking
-- here, unlike join_golf_call) — low-stakes for a 1:1 DM thread, not worth
-- the extra complexity this phase.
create function public.get_or_create_dm_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_self uuid := (select auth.uid());
  v_conversation_id uuid;
begin
  if v_self = p_other_user_id then
    raise exception 'Cannot start a conversation with yourself.';
  end if;
  if exists (
    select 1 from public.blocks
    where (blocker_id = v_self and blocked_id = p_other_user_id)
       or (blocker_id = p_other_user_id and blocked_id = v_self)
  ) then
    raise exception 'Cannot message this golfer.';
  end if;

  select cp1.conversation_id into v_conversation_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = v_self and cp2.user_id = p_other_user_id
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.conversations default values returning id into v_conversation_id;
  insert into public.conversation_participants (conversation_id, user_id) values
    (v_conversation_id, v_self),
    (v_conversation_id, p_other_user_id);

  return v_conversation_id;
end;
$$;

revoke execute on function public.get_or_create_dm_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_dm_conversation(uuid) to authenticated;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid references auth.users (id) on delete set null,
  reported_message_id uuid references public.messages (id) on delete set null,
  round_id uuid references public.golf_calls (id) on delete set null,
  category text not null,
  details text not null default '',
  context text not null check (context in ('profile', 'chat', 'round', 'post', 'comment')),
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using (reporter_id = (select auth.uid()));

create policy "reports_insert_own"
  on public.reports for insert
  to authenticated
  with check (reporter_id = (select auth.uid()));

-- No update/delete policy — status changes are future moderation-tooling
-- territory, not something a regular client should ever do.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('round_joined', 'round_left', 'round_cancelled', 'new_message')),
  actor_id uuid references auth.users (id) on delete set null,
  text text not null,
  link_to text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No insert policy — notifications are only ever created by the trigger
-- functions below, never directly by a client.

create function public.notify_round_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_joiner_name text;
begin
  if new.participant_status <> 'joined' then
    return new;
  end if;
  select host_user_id into v_host from public.golf_calls where id = new.round_id;
  if v_host is null or v_host = new.user_id then
    return new; -- the host's own seat at hosting time, not a real "someone joined" event
  end if;
  select name into v_joiner_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, type, actor_id, text, link_to)
  values (v_host, 'round_joined', new.user_id, coalesce(v_joiner_name, 'A golfer') || ' joined your round.', '/golf-calls/' || new.round_id);
  return new;
end;
$$;

create trigger trg_notify_round_joined
  after insert on public.round_participants
  for each row execute function public.notify_round_joined();

create function public.notify_round_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_leaver_name text;
begin
  if old.participant_status = 'joined' and new.participant_status = 'left' then
    select host_user_id into v_host from public.golf_calls where id = new.round_id;
    if v_host is null or v_host = new.user_id then
      return new;
    end if;
    select name into v_leaver_name from public.profiles where id = new.user_id;
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    values (v_host, 'round_left', new.user_id, coalesce(v_leaver_name, 'A golfer') || ' left your round.', '/golf-calls/' || new.round_id);
  end if;
  return new;
end;
$$;

create trigger trg_notify_round_left
  after update on public.round_participants
  for each row execute function public.notify_round_left();

create function public.notify_round_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    insert into public.notifications (user_id, type, actor_id, text, link_to)
    select rp.user_id, 'round_cancelled', new.host_user_id, 'The host cancelled a round you joined.', '/golf-calls/' || new.id
    from public.round_participants rp
    where rp.round_id = new.id and rp.participant_status = 'joined' and rp.user_id <> new.host_user_id;
  end if;
  return new;
end;
$$;

create trigger trg_notify_round_cancelled
  after update on public.golf_calls
  for each row execute function public.notify_round_cancelled();

create function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_name text;
begin
  select name into v_sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, type, actor_id, text, link_to)
  select cp.user_id, 'new_message', new.sender_id, coalesce(v_sender_name, 'A golfer') || ' sent you a message.', '/messages/' || new.sender_id
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;
  return new;
end;
$$;

create trigger trg_notify_new_message
  after insert on public.messages
  for each row execute function public.notify_new_message();

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
