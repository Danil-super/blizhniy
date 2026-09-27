-- Organization profiles are not written by the current or audited browser app.
-- Keep server service_role access while closing raw Data API writes to public fields.
revoke insert, update, delete on table public.organization_profiles from anon, authenticated;
