-- Carries a real video thumbnail forward through Caddie's "Share to
-- Community" handoff — that path reuses an already-uploaded video by
-- reference (never re-uploads it), so the thumbnail has to already exist
-- on the caddie_analyses row for CreatePost.tsx to hand off, rather than
-- being generated at share time (which would mean re-fetching the remote
-- video first). Populated by AnalyzeSwing.tsx (captured from the local
-- file at upload time, same technique as community_posts.video_thumbnail_url)
-- or copied straight from the source post's own thumbnail when the
-- analysis instead comes from "Ask Caddie" on an existing Community post.
alter table public.caddie_analyses add column thumbnail_url text;
