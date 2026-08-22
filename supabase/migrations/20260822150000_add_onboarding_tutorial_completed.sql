-- First-time-user tutorial: a separate flag from has_onboarded -- that one
-- gates required account/profile setup; this one gates the optional
-- spotlight walkthrough shown once profile setup is done. Same
-- null/false-eligible, true-never-again shape as has_onboarded itself, and
-- deliberately independent of it so replaying the tutorial later never
-- touches onboarding/profile-setup state.
alter table public.profiles
  add column onboarding_tutorial_completed boolean not null default false;
