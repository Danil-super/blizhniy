-- Create a public media bucket for user-uploaded listing and fair application images.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.
-- Uploads are performed through the server API with the service role key.
-- The bucket is public for direct object URLs; no broad storage.objects SELECT policy is needed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blizhniy-media',
  'blizhniy-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read blizhniy media" on storage.objects;
