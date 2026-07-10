-- Split listing_images owner/admin FOR ALL policies into action-specific policies.
-- Access rules remain equivalent: public can read images for published listings, listing owners can manage images for their listings, and admins can manage all images.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

alter policy "Public can read listing images" on public.listing_images
  using (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.status = 'published'
          or listings.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

drop policy if exists "Owners can manage listing images" on public.listing_images;
drop policy if exists "Admins can manage listing images" on public.listing_images;

create policy "Owners can insert listing images" on public.listing_images
  for insert
  with check (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can update listing images" on public.listing_images
  for update
  using (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );

create policy "Owners can delete listing images" on public.listing_images
  for delete
  using (
    exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.author_id = (select auth.uid())
          or private.is_admin()
        )
    )
  );
