-- Bookings are created and moderated by authenticated Next.js API routes.
-- Browser clients only need RLS-filtered SELECT for their own requests.
revoke insert, update, delete, truncate, references, trigger
on table public.booking_requests from anon, authenticated;

drop policy if exists "Guests can create own booking requests" on public.booking_requests;
drop policy if exists "Listing owners can answer booking requests" on public.booking_requests;

do $$
begin
  if has_table_privilege('anon', 'public.booking_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.booking_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.booking_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.booking_requests', 'DELETE') then
    raise exception 'Browser roles can still write booking requests';
  end if;

  if not has_table_privilege('authenticated', 'public.booking_requests', 'SELECT')
     or not has_table_privilege('service_role', 'public.booking_requests', 'INSERT')
     or not has_table_privilege('service_role', 'public.booking_requests', 'UPDATE') then
    raise exception 'Booking access for participants or API server is missing';
  end if;
end
$$;
