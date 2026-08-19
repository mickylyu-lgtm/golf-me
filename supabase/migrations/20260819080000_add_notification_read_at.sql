-- Lets the client keep a read notification visible in the inbox panel for a
-- while after it's read (currently 2 hours, see NotificationsPanel.tsx)
-- instead of it vanishing from the read-state flip alone, or piling up
-- forever -- needs a timestamp of WHEN it was read, which the boolean
-- `read` column alone can't express.
alter table public.notifications add column read_at timestamptz;
