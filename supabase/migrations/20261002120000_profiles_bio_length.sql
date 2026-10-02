-- Profile bios are capped at 150 characters (Micky, 2026-10-02). bio is
-- `text not null default ''`, so no null branch is needed. Every current
-- row is well under the cap, so the constraint validates immediately.
-- Reviewed by golfme-architect: no trigger, RPC, Edge Function or seed path
-- writes a bio over 150 (onboarding default 46 chars, App Review account 34).
alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 150);

comment on constraint profiles_bio_length on public.profiles is
  'Bio max 150 characters (code points); the client enforces the same limit with textarea maxLength.';
