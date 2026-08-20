-- round_messages (Phase 20's group-chat-on-real-Supabase migration) was
-- created without being added to the supabase_realtime publication, so
-- postgres_changes never fired for it -- RealRoundsContext's subscription
-- to this table was silently a no-op, leaving group chat working only via
-- the initial fetch (no live delivery). Caught while investigating a
-- related notifications-realtime report and fixed here for both tables it
-- touches directly.
alter publication supabase_realtime add table public.round_messages;
