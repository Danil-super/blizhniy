-- Keep the media bucket public for object URLs, but do not expose broad storage.objects listing.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

update storage.buckets
set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'blizhniy-media';

drop policy if exists "Public can read blizhniy media" on storage.objects;
