-- Paid publication writes are handled by server endpoints using service_role.
-- The audited release and current main use browser Supabase only for Auth and
-- user_roles SELECT. Browser clients must not modify monetized rows or images.
revoke insert, update, delete, maintain on table
  public.listings,
  public.listing_images,
  public.vacancies,
  public.vacancy_images,
  public.work_requests,
  public.work_request_images,
  public.fair_applications,
  public.fair_application_images,
  public.ad_marquee_placements,
  public.specialist_profiles
from anon, authenticated;
