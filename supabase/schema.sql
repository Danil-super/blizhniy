create type publication_status as enum (
  'draft',
  'pending_payment',
  'paid',
  'published',
  'archived',
  'expired',
  'rejected'
);

create type listing_type as enum ('sell', 'buy', 'exchange', 'free');
create type payment_status as enum ('created', 'pending', 'succeeded', 'failed', 'refunded');
create type tariff_action as enum ('listing_publication', 'vacancy_publication', 'job_response');

create table profiles (
  id uuid primary key,
  email text unique,
  phone text,
  display_name text,
  is_admin boolean not null default false,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
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
  title text not null,
  description text not null,
  price numeric(12, 2),
  contact_phone text,
  messenger_url text,
  status publication_status not null default 'draft',
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

create table vacancies (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id),
  organization_name text not null,
  logo_path text,
  title text not null,
  specialist_category_id uuid references specialist_categories(id),
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
  description text not null,
  requirements text,
  responsibilities text,
  salary numeric(12, 2),
  schedule text,
  contact_phone text,
  email text,
  status publication_status not null default 'draft',
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  expires_at timestamptz
);

create table specialist_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id),
  name text not null,
  photo_path text,
  region_id uuid not null references regions(id),
  city_id uuid not null references cities(id),
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
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  specialist_profile_id uuid not null references specialist_profiles(id) on delete cascade,
  message text,
  status text not null default 'pending_payment',
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz
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
  ('Отклик на вакансию', 'job_response', 99, null);
