create extension if not exists btree_gist;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_request_status') then
    create type booking_request_status as enum ('pending', 'accepted', 'declined');
  end if;
end $$;

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  guest_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date,
  guests integer not null default 1 check (guests > 0),
  total numeric(12, 2) not null default 0,
  status booking_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);

alter table public.booking_requests
  drop constraint if exists booking_requests_no_active_overlap;

alter table public.booking_requests
  add constraint booking_requests_no_active_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, coalesce(end_date, start_date + 1), '[)') with &&
  )
  where (status in ('pending', 'accepted'));

create index if not exists booking_requests_listing_status_idx on public.booking_requests (listing_id, status, start_date);
create index if not exists booking_requests_guest_id_idx on public.booking_requests (guest_id);

alter table public.booking_requests enable row level security;

grant select, insert, update on public.booking_requests to authenticated;

drop policy if exists "Booking participants can read requests" on public.booking_requests;
create policy "Booking participants can read requests" on public.booking_requests
  for select
  using (
    guest_id = (select auth.uid())
    or exists (
      select 1
      from public.listings
      where listings.id = booking_requests.listing_id
        and listings.author_id = (select auth.uid())
    )
  );

drop policy if exists "Guests can create own booking requests" on public.booking_requests;
create policy "Guests can create own booking requests" on public.booking_requests
  for insert
  with check (guest_id = (select auth.uid()));

drop policy if exists "Listing owners can answer booking requests" on public.booking_requests;
create policy "Listing owners can answer booking requests" on public.booking_requests
  for update
  using (
    exists (
      select 1
      from public.listings
      where listings.id = booking_requests.listing_id
        and listings.author_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.listings
      where listings.id = booking_requests.listing_id
        and listings.author_id = (select auth.uid())
    )
  );
