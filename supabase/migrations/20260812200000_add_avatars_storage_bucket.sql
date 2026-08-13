-- Real avatar uploads (Phase 2 of the real-backend migration) — a public
-- bucket, one object per golfer at "<user-id>/avatar.jpg" (upsert on
-- replace), never base64 in the database. Public read matches existing
-- product behavior (avatars are already visible to any golfer via
-- visibleGolfers()/Find/Discover); write/delete restricted to the owning
-- folder so nobody can overwrite or remove someone else's avatar.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

create policy "avatar_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatar_images_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatar_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
