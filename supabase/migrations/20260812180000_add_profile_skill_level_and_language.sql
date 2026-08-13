-- Two additive, nullable columns needed for real-auth Phase 1 (real-backend
-- migration plan). Both optional/unset-capable, matching the "no forced
-- default" behavior of every other not-yet-collected profile field.

-- ProfileSetup's onboarding wizard lets a golfer describe their game by
-- skill band ("Beginner"/"Intermediate"/"Advanced") instead of a numeric
-- handicap. The existing `handicap` column already covers the numeric path;
-- this covers the band path without forcing a fabricated handicap number
-- onto someone who explicitly said they don't have one.
alter table public.profiles
  add column skill_level text check (skill_level in ('Beginner', 'Intermediate', 'Advanced'));

-- Device/UI language preference, kept alongside the rest of the profile so
-- it can follow a golfer across devices once wired up (client-side reads
-- localStorage for now — this column exists for that future sync, not
-- consumed yet).
alter table public.profiles
  add column language text;
