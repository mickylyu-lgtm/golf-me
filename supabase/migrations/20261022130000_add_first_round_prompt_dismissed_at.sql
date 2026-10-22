-- First Round Hosting Onboarding (2026-10-22): remembers, per account and
-- across every device, that the golfer closed the "Host your first round"
-- popup (Maybe Later, the X, or acting on it). Once set the popup never
-- shows again; the Home reminder card takes over until the golfer's first
-- round is created.
--
-- Additive and nullable: existing rows read as "never dismissed", nothing
-- is backfilled, and the app treats a missing column (migration not applied
-- yet) the same way, with a per-device localStorage fallback.
--
-- Access: covered by the existing profiles policies, no new policy needed.
--   * profiles_update_own (to authenticated, using/with check
--     auth.uid() = id) lets a golfer set it on their own row only.
--   * profiles_select_authenticated lets any signed-in golfer read it, like
--     every other profiles column (onboarding_tutorial_completed included).
--     It only says when someone closed an onboarding popup.
-- Column guards on profiles are blacklist triggers that pin specific trust
-- columns (protect_unverified_trust_columns, the reputation/tee-time freeze,
-- guard_profile_founding_columns); none of them touch this column, and
-- profiles has no column-level grants, so the table-level update grant
-- already covers it.
--
-- Rollback:
--   alter table public.profiles drop column if exists first_round_prompt_dismissed_at;

alter table public.profiles
  add column first_round_prompt_dismissed_at timestamptz;

comment on column public.profiles.first_round_prompt_dismissed_at is
  'When the golfer closed the first-round hosting popup. Null = never closed. Set by the client on its own row.';
