-- Lets a golfer flag "please review my swing" at post time, rather than
-- Coach Reviewers only ever discovering a post organically while browsing.
-- Purely a signal column -- no gating/notification system, just something
-- CoachReviewSection/PostCard can surface so a requested post is easy to
-- spot. No RLS change needed: community_posts' existing insert-own/select-
-- open policies already cover every column generically.
alter table public.community_posts add column coach_review_requested boolean not null default false;
