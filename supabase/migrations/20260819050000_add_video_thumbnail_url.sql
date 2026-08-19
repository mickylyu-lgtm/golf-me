-- Swing Post videos rendered as a plain black rectangle until tapped --
-- browsers show nothing for a <video> with no poster frame. Stores a real
-- captured frame (client-side canvas capture of the actual uploaded video,
-- never a fake/placeholder image) alongside the video itself, uploaded to
-- the same community-media bucket. Nullable: existing posts predate this
-- and simply have no thumbnail until re-posted -- not a migration
-- backfill target, no fabricated thumbnail is worth inventing for them.
alter table public.community_posts add column video_thumbnail_url text;
