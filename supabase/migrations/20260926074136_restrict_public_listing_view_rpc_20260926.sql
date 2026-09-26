-- The application records views through a service-role server route. Keep the
-- SECURITY DEFINER RPC out of the direct browser Data API.
revoke execute on function public.record_listing_view(uuid, text) from public, anon, authenticated;
grant execute on function public.record_listing_view(uuid, text) to service_role;
