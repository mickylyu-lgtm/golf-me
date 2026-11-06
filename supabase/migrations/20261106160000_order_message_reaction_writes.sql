-- Reaction writes: the latest intent wins on the server, even when an older
-- request arrives late. PREPARED, NOT APPLIED: apply only after Micky's
-- sign-off. Requires 20261105150000 and 20261105160000 (both applied
-- 2026-11-05).
--
-- Problem
--   The client sends one write per message at a time and bounds each at 15 s
--   (src/lib/reactionWrites.ts). After a timeout it sends the newer state.
--   If the timed-out request was only delayed (mobile network, a PostgREST
--   pool wait) and reaches Postgres AFTER the newer write committed, it is
--   applied last and the older state wins: e.g. "add" applied after
--   "remove" brings the reaction back. Nothing on the server could tell
--   the two apart. (Two writes that reach Postgres concurrently are already
--   ordered by the row lock; the gap is a request that arrives later.)
--
-- Fix: a per-(message, user) write sequence, stored on the row.
--   * client_seq bigint (nullable). New clients send it on every write; a
--     BEFORE UPDATE trigger skips (returns NULL: no error, 0 rows) any
--     write whose client_seq is LOWER than the stored one. Equal = the same
--     write replayed, applied (harmless).
--   * Removal is a tombstone, not a DELETE: new clients upsert emoji = NULL
--     with their client_seq, so the row (and its sequence) survives and a
--     late "add" with a lower sequence can't resurrect it. A tombstone is
--     "no reaction": the client drops rows whose emoji isn't one of the six
--     (lib/reactions.ts reactionRowsToReactions; the live client already
--     does), so no pill. emoji therefore becomes nullable; the six-emoji
--     check still applies to every non-null value.
--   * The sequence is client-generated: max(Date.now() in microseconds,
--     last one this device issued + 1, the stored one this device last
--     fetched for that message + 1). Monotonic on one device across reloads
--     (wall clock) and after seeing another device's write (fetched value).
--     Why not a server-issued version: the order that matters is the order
--     of the user's taps, decided before the request leaves the phone. A
--     version handed out when a request reaches the server just reproduces
--     arrival order (the bug), and fetching one first is another request
--     that can itself be late.
--     Trade-off: two devices of the same user, the one with the slower clock
--     tapping without having fetched the other's write, can have its newer
--     tap ignored; its next refetch shows the server's state (no retry
--     loop, no error). Only the same account's devices compete for a row.
--
-- Backward compatibility (live clients without client_seq)
--   * Their upsert doesn't name client_seq, so on conflict the column is
--     unchanged (new = old): applied, exactly as today. Their DELETE is
--     unchanged. Their fetch names its columns and drops NULL emoji.
--   * Legacy writes aren't ordered against sequenced ones (only matters
--     across two devices of one user during the rollout).
--
-- Unchanged: RLS policies, the authz trigger
-- (private.prepare_message_reaction from 20261105160000: it runs first,
-- trigger names fire alphabetically, so an unauthorized caller gets the
-- uniform reaction_not_allowed before any sequence is compared), the
-- unsend trigger (it deletes every row of the message, tombstones too),
-- realtime, grants. A tombstone write follows the same rules as an add
-- (participant, visible, not unsent, no block). Under a block, or on an
-- unsent message, the client falls back to the old DELETE, which stays
-- allowed; a late add is refused there by the same rules.
--
-- Privacy note: a tombstone row is visible to the other participant (as
-- the reaction was), with user_id and created_at: they can see that a
-- reaction was removed, which realtime already told them live.
--
-- Verify: reactions-order-check.sql returns true (one row).
-- Rollback (reactions-order-rollback.sql, in a transaction):
--   drop trigger if exists message_reactions_sequence on public.message_reactions;
--   drop function if exists private.order_message_reaction();
--   delete from public.message_reactions where emoji is null;   -- tombstones = no reaction
--   alter table public.message_reactions alter column emoji set not null;
--   alter table public.message_reactions drop column if exists client_seq;
--   notify pgrst, 'reload schema';

alter table public.message_reactions add column client_seq bigint;
alter table public.message_reactions alter column emoji drop not null;

comment on column public.message_reactions.client_seq is
  'Client write sequence per (message, user); a lower one than stored is ignored (migration 20261106160000).';
comment on column public.message_reactions.emoji is
  'One of the six quick reactions; NULL = removed (tombstone, keeps client_seq).';

-- BEFORE UPDATE only: an INSERT has nothing to be stale against. Reads
-- nothing but the row, so SECURITY INVOKER.
create function private.order_message_reaction()
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

revoke execute on function private.order_message_reaction() from public, anon, authenticated;

-- "sequence" sorts after "prepare": authorization first.
create trigger message_reactions_sequence
  before update on public.message_reactions
  for each row execute function private.order_message_reaction();

notify pgrst, 'reload schema';
