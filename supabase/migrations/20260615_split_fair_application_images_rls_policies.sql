-- Split fair_application_images owner/admin FOR ALL policies into action-specific policies.
-- Access rules remain equivalent: public can read images for published fair applications, fair application owners can manage images for their applications, and admins can manage all images.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

alter policy "Public can read fair application images" on public.fair_application_images
  using (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and (
          fair_applications.status = 'published'
          or fair_applications.user_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

drop policy if exists "Owners can manage fair application images" on public.fair_application_images;
drop policy if exists "Admins can manage fair application images" on public.fair_application_images;

create policy "Owners can insert fair application images" on public.fair_application_images
  for insert
  with check (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and (
          fair_applications.user_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

create policy "Owners can update fair application images" on public.fair_application_images
  for update
  using (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and (
          fair_applications.user_id = (select auth.uid())
          or public.is_admin()
        )
    )
  )
  with check (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and (
          fair_applications.user_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );

create policy "Owners can delete fair application images" on public.fair_application_images
  for delete
  using (
    exists (
      select 1
      from public.fair_applications
      where fair_applications.id = fair_application_images.fair_application_id
        and (
          fair_applications.user_id = (select auth.uid())
          or public.is_admin()
        )
    )
  );
