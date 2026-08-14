-- Phase 6: round completion (no new policy needed — the host already has a
-- general update policy on golf_calls from Phase 4, and "mark my own round
-- completed" is just another host-owned status change, same risk profile
-- as cancel), real post-round reviews, and real credibility computed live
-- from that data — never a fabricated or denormalized number.

create table public.round_reviews (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.golf_calls (id) on delete cascade,
  reviewer_user_id uuid not null references auth.users (id) on delete cascade,
  reviewed_user_id uuid not null references auth.users (id) on delete cascade,
  would_play_again boolean not null,
  showed_up boolean not null,
  on_time boolean not null,
  pace text not null check (pace in ('Fast', 'Good', 'Slow')),
  respectful boolean not null,
  handicap_accuracy text not null check (handicap_accuracy in ('accurate', 'slightly_off', 'very_inaccurate', 'not_sure')),
  private_note text,
  created_at timestamptz not null default now(),
  unique (round_id, reviewer_user_id, reviewed_user_id),
  check (reviewer_user_id <> reviewed_user_id)
);

alter table public.round_reviews enable row level security;

-- Raw review content — including private_note — is visible only to the
-- golfer who wrote it, never the person being reviewed and never any other
-- golfer. Public-facing credibility is the aggregated numbers returned by
-- get_credibility_stats() below, never these raw rows.
create policy "round_reviews_select_own_submitted"
  on public.round_reviews for select
  to authenticated
  using (reviewer_user_id = (select auth.uid()));

-- No insert/update/delete policy — every write goes through
-- submit_round_review() below, which enforces the actual rules (same
-- completed round, not reviewing yourself, both people actually played,
-- and the one-review-per-person-per-round unique constraint above as a
-- hard backstop even if the function's own check somehow raced).
create function public.submit_round_review(
  p_round_id uuid,
  p_reviewed_user_id uuid,
  p_would_play_again boolean,
  p_showed_up boolean,
  p_on_time boolean,
  p_pace text,
  p_respectful boolean,
  p_handicap_accuracy text,
  p_private_note text
)
returns public.round_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_self uuid := (select auth.uid());
  v_round public.golf_calls%rowtype;
  v_review public.round_reviews%rowtype;
begin
  if v_self = p_reviewed_user_id then
    raise exception 'You can''t review yourself.';
  end if;

  select * into v_round from public.golf_calls where id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found.';
  end if;
  if v_round.status <> 'completed' then
    raise exception 'This round hasn''t been marked completed yet.';
  end if;

  if not exists (
    select 1 from public.round_participants
    where round_id = p_round_id and user_id = v_self and participant_status = 'joined'
  ) then
    raise exception 'You weren''t part of this round.';
  end if;
  if not exists (
    select 1 from public.round_participants
    where round_id = p_round_id and user_id = p_reviewed_user_id and participant_status = 'joined'
  ) then
    raise exception 'That golfer wasn''t part of this round.';
  end if;

  insert into public.round_reviews (
    round_id, reviewer_user_id, reviewed_user_id, would_play_again, showed_up, on_time, pace, respectful, handicap_accuracy, private_note
  ) values (
    p_round_id, v_self, p_reviewed_user_id, p_would_play_again, p_showed_up, p_on_time, p_pace, p_respectful, p_handicap_accuracy, nullif(p_private_note, '')
  )
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function public.submit_round_review(uuid, uuid, boolean, boolean, boolean, text, boolean, text, text) from public, anon;
grant execute on function public.submit_round_review(uuid, uuid, boolean, boolean, boolean, text, boolean, text, text) to authenticated;

-- Aggregated, never-fabricated credibility — any authenticated golfer can
-- call this for any other golfer (needed to show credibility on someone
-- else's profile), but it only ever returns rounded aggregate numbers,
-- never raw review rows or who-said-what. A brand-new real account
-- naturally returns 0 completed_rounds / 0 reviews_received here, which the
-- client renders as "Building Credibility" — not a special-cased fake
-- value, just what an honest empty aggregate looks like.
create function public.get_credibility_stats(p_user_id uuid)
returns table (
  completed_rounds int,
  would_play_again_pct int,
  show_up_pct int,
  on_time_pct int,
  respectful_pct int,
  handicap_confidence text,
  reviews_received int
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_completed_rounds int;
  v_reviews_count int;
  v_wpa_pct int := 0;
  v_showup_pct int := 0;
  v_ontime_pct int := 0;
  v_respect_pct int := 0;
  v_confidence text;
  v_unique int;
  v_negative int;
begin
  select count(distinct rp.round_id) into v_completed_rounds
  from public.round_participants rp
  join public.golf_calls gc on gc.id = rp.round_id
  where rp.user_id = p_user_id and rp.participant_status = 'joined' and gc.status = 'completed';

  select count(*) into v_reviews_count from public.round_reviews where reviewed_user_id = p_user_id;

  if v_reviews_count > 0 then
    select
      round(100.0 * count(*) filter (where would_play_again) / v_reviews_count),
      round(100.0 * count(*) filter (where showed_up) / v_reviews_count),
      round(100.0 * count(*) filter (where on_time) / v_reviews_count),
      round(100.0 * count(*) filter (where respectful) / v_reviews_count)
    into v_wpa_pct, v_showup_pct, v_ontime_pct, v_respect_pct
    from public.round_reviews where reviewed_user_id = p_user_id;
  end if;

  -- Same rule as the existing (mock) computeHandicapConfidence: latest
  -- opinion per distinct reviewer, ignoring "not_sure"; 2+ reviewers with a
  -- negative majority -> needs_review; 2+ reviewers with zero negative ->
  -- high; otherwise normal. No single reviewer can move this.
  with latest_per_reviewer as (
    select distinct on (reviewer_user_id) reviewer_user_id, handicap_accuracy
    from public.round_reviews
    where reviewed_user_id = p_user_id and handicap_accuracy <> 'not_sure'
    order by reviewer_user_id, created_at desc
  )
  select count(*), count(*) filter (where handicap_accuracy in ('slightly_off', 'very_inaccurate'))
  into v_unique, v_negative
  from latest_per_reviewer;

  if v_unique = 0 then
    v_confidence := 'normal';
  elsif v_unique >= 2 and v_negative >= 2 and v_negative::float / v_unique > 0.5 then
    v_confidence := 'needs_review';
  elsif v_unique >= 2 and v_negative = 0 then
    v_confidence := 'high';
  else
    v_confidence := 'normal';
  end if;

  return query select v_completed_rounds, v_wpa_pct, v_showup_pct, v_ontime_pct, v_respect_pct, v_confidence, v_reviews_count;
end;
$$;

revoke execute on function public.get_credibility_stats(uuid) from public, anon;
grant execute on function public.get_credibility_stats(uuid) to authenticated;
