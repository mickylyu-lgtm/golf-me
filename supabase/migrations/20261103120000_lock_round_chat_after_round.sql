-- NYC launch Phase 3 "round conversations" (2026-11-03, Micky's call): a
-- round's group chat becomes read-only once the round is over. Until now a
-- member could keep posting to a completed or cancelled round forever.
--
-- What changes: the round_messages INSERT policy also requires the round to
-- still be 'open' or 'full'. Everything the current policy (migration
-- 20260924100300_enforce_blocks_on_rounds) enforces is kept exactly:
--   * sender_id = auth.uid()
--   * private.is_round_member(round_id): the host, or a 'joined' participant
--   * no block either way between the sender and the round's host
-- Untouched: the SELECT policy (members keep reading the history; someone who
-- left still loses it, as before), the append-only design (no update/delete
-- policy), and the content-filter trigger from
-- 20260930120000_add_objectionable_content_filter (BEFORE INSERT/UPDATE OF
-- text on round_messages), which still runs before this check.
--
-- The status read is a plain subquery, like the host lookup already in this
-- policy: golf_calls_select_authenticated lets every signed-in user read
-- golf_calls, so no SECURITY DEFINER helper is needed. A round_id with no
-- golf_calls row makes the subquery NULL, so `in (...)` is not true and the
-- insert is refused (the FK would refuse it anyway).
--
-- Client: GroupChat replaces the composer with a read-only note on completed /
-- cancelled rounds; a post refused by this policy (42501) shows as a failed
-- bubble with the read-only explanation (src/lib/roundChat.ts).
--
-- Verify after applying (role-simulated, inside a transaction that is rolled
-- back; replace the ids with a real member + round on the target project):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<member-user-id>","role":"authenticated"}';
--   -- open/full round the caller is a member of: succeeds
--   insert into public.round_messages (round_id, sender_id, text)
--     values ('<open-round-id>', '<member-user-id>', 'verify: open ok');
--   -- completed or cancelled round the caller is a member of: must fail with
--   -- "new row violates row-level security policy for table round_messages"
--   insert into public.round_messages (round_id, sender_id, text)
--     values ('<ended-round-id>', '<member-user-id>', 'verify: ended refused');
--   rollback;
--
--   -- Policy text, expect the status clause:
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy
--   where polname = 'round_messages_insert_member';
--
-- Rollback (restores the 20260924100300 policy exactly):
--   drop policy round_messages_insert_member on public.round_messages;
--   create policy round_messages_insert_member on public.round_messages
--     for insert to authenticated
--     with check (
--       sender_id = (select auth.uid())
--       and private.is_round_member(round_id)
--       and not private.has_block_between(
--         (select auth.uid()),
--         (select gc.host_user_id from public.golf_calls gc where gc.id = round_id)
--       )
--     );

drop policy round_messages_insert_member on public.round_messages;
create policy round_messages_insert_member on public.round_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_round_member(round_id)
    and not private.has_block_between(
      (select auth.uid()),
      (select gc.host_user_id from public.golf_calls gc where gc.id = round_id)
    )
    and (select gc.status from public.golf_calls gc where gc.id = round_id) in ('open', 'full')
  );
