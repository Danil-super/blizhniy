-- The old exclusion constraint treats a tour with many seats like a one-room rental.
-- Only confirmed tour seats count against capacity. Serialize checks per listing.
alter table public.booking_requests
  drop constraint if exists booking_requests_no_active_overlap;

create or replace function public.enforce_booking_inventory()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  listing_row public.listings%rowtype;
  booking_mode text;
  max_guests integer;
  accepted_guests integer;
  today_moscow date := (now() at time zone 'Europe/Moscow')::date;
begin
  -- A response is final; repeat or reverse responses require an explicit cancellation flow.
  if tg_op = 'UPDATE' and old.status <> 'pending' and new.status <> old.status then
    raise exception 'Booking response is already final' using errcode = '23514';
  end if;

  select * into listing_row from public.listings where id = new.listing_id for update;
  if not found or listing_row.booking is null then
    raise exception 'Booking is unavailable for this listing' using errcode = '23514';
  end if;

  if new.guest_id = listing_row.author_id then
    raise exception 'An owner cannot book their own listing' using errcode = '23514';
  end if;

  if new.status = 'declined' then
    return new;
  end if;

  if new.start_date < today_moscow or new.start_date > today_moscow + 365 then
    raise exception 'Booking date must be within the next year' using errcode = '23514';
  end if;

  booking_mode := listing_row.booking->>'mode';
  max_guests := (listing_row.booking->>'maxGuests')::integer;

  if max_guests is null or max_guests < 1 or new.guests > max_guests then
    raise exception 'Party exceeds listing capacity' using errcode = '23514';
  end if;

  if booking_mode = 'tour' then
    if new.end_date is not null or new.start_date <> (listing_row.booking->>'tourDate')::date then
      raise exception 'Select the scheduled tour date' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.booking_requests existing
      where existing.listing_id = new.listing_id
        and existing.guest_id = new.guest_id
        and existing.start_date = new.start_date
        and existing.status in ('pending', 'accepted')
        and existing.id <> new.id
    ) then
      raise exception 'You already have a request for this tour' using errcode = '23505';
    end if;

    select coalesce(sum(existing.guests), 0)::integer into accepted_guests
    from public.booking_requests existing
    where existing.listing_id = new.listing_id
      and existing.start_date = new.start_date
      and existing.status = 'accepted'
      and existing.id <> new.id;

    if accepted_guests + new.guests > max_guests then
      raise exception 'Not enough seats left on this tour' using errcode = '23514';
    end if;
  elsif booking_mode = 'stay' then
    if new.end_date is null or new.end_date <= new.start_date or new.end_date > new.start_date + 30
       or new.end_date > today_moscow + 366 then
      raise exception 'Stay must be between one and thirty nights within the next year' using errcode = '23514';
    end if;

    if exists (
      select 1 from public.booking_requests existing
      where existing.listing_id = new.listing_id
        and existing.status in ('pending', 'accepted')
        and existing.id <> new.id
        and daterange(existing.start_date, coalesce(existing.end_date, existing.start_date + 1), '[)')
            && daterange(new.start_date, new.end_date, '[)')
    ) then
      raise exception 'Stay overlaps an active request' using errcode = '23P01';
    end if;
  else
    raise exception 'Unsupported booking mode' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_booking_inventory() from public, anon, authenticated;
grant execute on function public.enforce_booking_inventory() to service_role;

drop trigger if exists booking_requests_inventory_guard on public.booking_requests;
create trigger booking_requests_inventory_guard
  before insert or update of listing_id, guest_id, start_date, end_date, guests, status
  on public.booking_requests for each row
  execute function public.enforce_booking_inventory();

create index if not exists booking_requests_active_dates_idx
  on public.booking_requests using gist
  (listing_id, daterange(start_date, coalesce(end_date, start_date + 1), '[)'))
  where status in ('pending', 'accepted');

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.booking_requests'::regclass
             and conname = 'booking_requests_no_active_overlap') then
    raise exception 'Old all-or-nothing booking constraint remains';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.booking_requests'::regclass
                 and tgname = 'booking_requests_inventory_guard' and not tgisinternal) then
    raise exception 'Booking inventory trigger was not installed';
  end if;
end;
$$;
