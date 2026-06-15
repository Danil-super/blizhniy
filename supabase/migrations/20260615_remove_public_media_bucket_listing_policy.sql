-- Public buckets can serve object URLs without a broad storage.objects SELECT policy.
-- Removing this policy prevents clients from listing all files in the media bucket.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

drop policy if exists "Public can read blizhniy media" on storage.objects;
