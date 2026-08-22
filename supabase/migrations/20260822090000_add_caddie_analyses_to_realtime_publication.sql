-- caddie_analyses was never added to the supabase_realtime publication,
-- so the client's postgres_changes subscription in RealCaddieContext.tsx
-- has never actually received live INSERT/UPDATE/DELETE events for this
-- table -- explaining why a completed (or failed/deleted) analysis only
-- ever showed up after a manual refresh, never live.
alter publication supabase_realtime add table public.caddie_analyses;
