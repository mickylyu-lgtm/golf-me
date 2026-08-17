-- "Ask Caddie" is owner-only for this beta (explicit product decision —
-- analyzing another user's swing and saving it to your own private
-- history raised an open permissions question, deferred rather than
-- silently allowed). The UI already only shows the button on the viewer's
-- own posts; this makes it a real, DB-enforced rule rather than trusting
-- the client, matching the project's usual "not just hidden in the UI"
-- discipline (see follows_no_self, round_reviews' constraints).
create or replace function public.enforce_caddie_community_post_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_author_id uuid;
begin
  if new.source_type = 'community_post' then
    select author_id into v_post_author_id from public.community_posts where id = new.source_post_id;
    if v_post_author_id is null then
      raise exception 'Source post not found.';
    end if;
    if v_post_author_id <> new.owner_id then
      raise exception 'Ask Caddie is only available on your own posts.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_caddie_community_post_ownership() from public, anon, authenticated;

create trigger enforce_caddie_community_post_ownership
  before insert or update on public.caddie_analyses
  for each row execute function public.enforce_caddie_community_post_ownership();
