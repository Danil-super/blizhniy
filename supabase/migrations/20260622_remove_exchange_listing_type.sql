update public.listings
set listing_type = 'free'
where listing_type::text = 'exchange';

alter type public.listing_type rename to listing_type_old;

create type public.listing_type as enum ('sell', 'buy', 'free', 'rent');

alter table public.listings
  alter column listing_type type public.listing_type
  using listing_type::text::public.listing_type;

drop type public.listing_type_old;
