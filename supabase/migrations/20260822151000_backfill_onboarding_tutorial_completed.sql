-- The new onboarding_tutorial_completed column defaults false for every
-- row, including accounts that finished onboarding long before this
-- feature existed -- without this backfill, every existing user would see
-- the tutorial auto-start on their next login, which the brief explicitly
-- rules out ("existing users should NOT suddenly be forced into the
-- tutorial after deployment"). Anyone who already finished the required
-- has_onboarded flow is marked as having already seen it; only accounts
-- that complete onboarding from here on get the real (false) default and
-- are eligible for the real first-time walkthrough.
update public.profiles
set onboarding_tutorial_completed = true
where has_onboarded = true;
