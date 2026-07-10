create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type publication_status as enum (
  'draft',
  'pending_payment',
  'paid',
  'published',
  'archived',
  'expired',
  'rejected',
  'sold'
);

create type listing_type as enum ('sell', 'buy', 'free', 'rent');
create type payment_status as enum ('created', 'pending', 'succeeded', 'failed', 'refunded');
create type tariff_action as enum ('listing_publication', 'vacancy_publication', 'work_request_publication', 'job_response', 'fair_participation', 'specialist_publication', 'ad_marquee');
create type app_role as enum ('user', 'specialist', 'organization', 'admin');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  phone text,
  display_name text,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid not null references profiles(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true
);

create table cities (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references regions(id),
  slug text not null unique,
  name text not null,
  active boolean not null default true
);

create table organization_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  region_id uuid references regions(id),
  city_id uuid references cities(id),
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default true,
  contact_phone text,
  email text,
  logo_path text,
  status publication_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id),
  slug text not null unique,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table specialist_categories (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null,
  slug text not null unique,
  name text not null,
  active boolean not null default true
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id),
  listing_type listing_type not null,
  category_id uuid not null references categories(id),
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default false,
  title text not null,
  description text not null,
  booking jsonb,
  price numeric(12, 2),
  contact_phone text,
  messenger_url text,
  status publication_status not null default 'draft',
  is_paid boolean not null default false,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_request_status') then
    create type booking_request_status as enum ('pending', 'accepted', 'declined');
  end if;
end $$;

create table booking_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  guest_id uuid not null references profiles(id) on delete cascade,
  start_date date not null,
  end_date date,
  guests integer not null default 1 check (guests > 0),
  total numeric(12, 2) not null default 0,
  status booking_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);

alter table booking_requests
  add constraint booking_requests_no_active_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, coalesce(end_date, start_date + 1), '[)') with &&
  )
  where (status in ('pending', 'accepted'));

create index booking_requests_listing_status_idx on booking_requests (listing_id, status, start_date);
create index booking_requests_guest_id_idx on booking_requests (guest_id);

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create table listing_views (
  listing_id uuid not null references listings(id) on delete cascade,
  viewer_key text not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_key),
  check (viewer_key <> '')
);

create index listing_views_listing_id_idx on listing_views (listing_id);

alter table listing_views enable row level security;

create or replace function record_listing_view(p_listing_id uuid, p_viewer_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer;
  next_view_count integer;
  normalized_viewer_key text := left(btrim(p_viewer_key), 160);
begin
  if normalized_viewer_key is null or normalized_viewer_key = '' then
    raise exception 'viewer key is required';
  end if;

  insert into listing_views (listing_id, viewer_key)
  values (p_listing_id, normalized_viewer_key)
  on conflict do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    update listings
       set view_count = view_count + 1
     where id = p_listing_id
       and status = 'published'
     returning view_count into next_view_count;

    if next_view_count is not null then
      return next_view_count;
    end if;

    delete from listing_views
     where listing_id = p_listing_id
       and viewer_key = normalized_viewer_key;
  end if;

  select view_count
    into next_view_count
    from listings
   where id = p_listing_id;

  return coalesce(next_view_count, 0);
end;
$$;

create table vacancies (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id),
  employer_type text not null default 'organization' check (employer_type in ('organization', 'ip', 'person')),
  organization_name text not null,
  logo_path text,
  title text not null,
  inn text,
  ogrn text,
  ogrnip text,
  contact_person text,
  website text,
  specialist_category_id uuid references specialist_categories(id),
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default true,
  description text not null,
  requirements text,
  responsibilities text,
  conditions text,
  salary numeric(12, 2),
  schedule text,
  work_format text,
  contact_phone text,
  messenger_url text,
  email text,
  placement_right_confirmed boolean not null default false,
  status publication_status not null default 'draft',
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);

create table vacancy_images (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create table work_requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id),
  request_type text not null default 'private_request',
  title text not null,
  description text not null,
  specialist_category_id uuid references specialist_categories(id),
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default false,
  budget numeric(12, 2),
  photo_path text,
  contact_phone text,
  messenger_url text,
  status publication_status not null default 'draft',
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table work_request_images (
  id uuid primary key default gen_random_uuid(),
  work_request_id uuid not null references work_requests(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create table specialist_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id),
  name text not null,
  photo_path text,
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default false,
  specialist_category_id uuid references specialist_categories(id),
  skills text[] not null default '{}',
  description text,
  experience text,
  price_from numeric(12, 2),
  contact_phone text,
  email text,
  messenger_url text,
  video_url text,
  status publication_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid references profiles(id) on delete cascade,
  vacancy_id uuid references vacancies(id) on delete cascade,
  work_request_id uuid references work_requests(id) on delete cascade,
  specialist_profile_id uuid references specialist_profiles(id) on delete cascade,
  message text,
  status text not null default 'pending_payment',
  is_paid boolean not null default false,
  specialist_name text,
  specialist_profession text,
  specialist_price text,
  specialist_skills text,
  specialist_phone text,
  specialist_email text,
  specialist_messenger_url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint applications_target_check check (
    (vacancy_id is not null and work_request_id is null)
    or (vacancy_id is null and work_request_id is not null)
  ),
  constraint applications_status_check check (status in ('pending_payment', 'paid', 'sent', 'viewed', 'selected', 'rejected'))
);

create table fair_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  participant_name text not null,
  region_id uuid references regions(id),
  city_id uuid references cities(id),
  fair_category text not null,
  description text not null,
  video_url text,
  contact_phone text not null,
  email text not null,
  comment text,
  district text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  show_exact_address boolean not null default false,
  status publication_status not null default 'draft',
  payment_status payment_status not null default 'created',
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table fair_application_images (
  id uuid primary key default gen_random_uuid(),
  fair_application_id uuid not null references fair_applications(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create table tariffs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  action tariff_action not null unique,
  price numeric(12, 2) not null,
  duration_days integer,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  tariff_id uuid references tariffs(id),
  target_type text not null,
  target_id uuid not null,
  provider text not null default 'mock',
  provider_payment_id text,
  amount numeric(12, 2) not null,
  status payment_status not null default 'created',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  email text,
  event text not null,
  subject text not null,
  body text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

insert into regions (slug, name) values ('krasnodarskiy-kray', 'Краснодарский край');

insert into cities (region_id, slug, name)
select regions.id, city.slug, city.name
from regions
cross join (
  values
    ('krasnodar', 'Краснодар'),
    ('sochi', 'Сочи'),
    ('anapa', 'Анапа'),
    ('novorossiysk', 'Новороссийск'),
    ('armavir', 'Армавир'),
    ('gelendzhik', 'Геленджик'),
    ('eysk', 'Ейск'),
    ('tuapse', 'Туапсе')
) as city(slug, name)
where regions.slug = 'krasnodarskiy-kray';

insert into tariffs (name, action, price, duration_days) values
  ('Размещение объявления', 'listing_publication', 199, 30),
  ('Размещение вакансии', 'vacancy_publication', 499, 30),
  ('Отклик на вакансию', 'job_response', 99, null),
  ('Участие в ярмарке мастеров', 'fair_participation', 1000, null),
  ('Размещение анкеты специалиста', 'specialist_publication', 299, 30),
  ('Бегущая строка / промо-объявление', 'ad_marquee', 399, 7);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
