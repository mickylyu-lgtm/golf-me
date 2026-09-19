-- Post-round review polish, 2026-09-19 (approved): on_time and pace move
-- from always-required to genuinely optional -- NULL now means "not
-- asked / not applicable / no valid observation," never a fabricated
-- answer. on_time stays a real reputation-relevant signal (still powers
-- the % on-time stat below), just conditional on showed_up=true in the
-- client now. pace is retired from the active review flow entirely but
-- keeps its column and historical data untouched.
alter table public.round_reviews
  alter column on_time drop not null,
  alter column pace drop not null,
  add constraint round_reviews_private_note_length check (private_note is null or char_length(private_note) <= 500);

-- on_time_pct's denominator changes from "all reviews" to "reviews where
-- on_time is not null" -- otherwise a growing pool of un-asked (no-show)
-- reviews would silently drag the displayed percentage toward 0 over time
-- even though nothing negative happened. NULL is never interpreted as late.
create or replace function public.get_credibility_stats(p_user_id uuid)
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
  v_ontime_known_count int := 0;
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
      round(100.0 * count(*) filter (where respectful) / v_reviews_count),
      count(*) filter (where on_time is not null)
    into v_wpa_pct, v_showup_pct, v_respect_pct, v_ontime_known_count
    from public.round_reviews where reviewed_user_id = p_user_id;

    if v_ontime_known_count > 0 then
      select round(100.0 * count(*) filter (where on_time) / v_ontime_known_count)
      into v_ontime_pct
      from public.round_reviews where reviewed_user_id = p_user_id and on_time is not null;
    end if;
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
