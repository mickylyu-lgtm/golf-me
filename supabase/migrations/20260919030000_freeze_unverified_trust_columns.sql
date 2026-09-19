-- Security fix, 2026-09-19: profiles.phone_verified/email_verified/
-- verified_golfer were self-settable by any signed-in user via the normal
-- profiles_update_own RLS policy -- confirmed live: no server-side check
-- ever validated a real phone number, real email ownership, or that both
-- were actually true before a client set verified_golfer directly. The
-- app's own "Verify" UI was demo scaffolding on top of this (accepted any
-- 6-digit code, and the "phone number" shown was hardcoded fake text --
-- no phone column exists in this schema at all), but the real hole was
-- server-side: nothing stopped a bypass of that UI entirely.
--
-- Real email verification already exists for free via Supabase Auth
-- itself (auth.users.email_confirmed_at, populated by Google OAuth /
-- email-OTP sign-in) -- the client now reads that directly instead of
-- this column, so profiles.email_verified is retired, not reimplemented.
-- Real phone verification has no backing infrastructure yet (no phone
-- number is even collected) and needs a paid SMS provider decision before
-- it can be built for real.
--
-- Until a real, server-verified path exists for either signal, freeze all
-- three columns against every client update -- a future real verification
-- flow should use its own SECURITY DEFINER function (same pattern as
-- get_credibility_stats/get_reputation_state) and explicitly allow itself
-- through this trigger then, not by relaxing this default.
create function public.protect_unverified_trust_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone_verified := old.phone_verified;
  new.email_verified := old.email_verified;
  new.verified_golfer := old.verified_golfer;
  return new;
end;
$$;

create trigger profiles_protect_unverified_trust_columns
before update on public.profiles
for each row
execute function public.protect_unverified_trust_columns();

-- Trigger functions default to PUBLIC execute, which the Supabase linter
-- flags since PostgREST exposes every public-schema function as a
-- callable RPC endpoint. Trigger invocation isn't gated by this grant
-- (verified live), so revoking it only closes an unnecessary direct-call
-- surface, it doesn't affect the trigger itself.
revoke execute on function public.protect_unverified_trust_columns() from public, anon, authenticated;
