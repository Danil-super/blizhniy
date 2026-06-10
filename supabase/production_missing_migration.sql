create extension if not exists pgcrypto;

alter type tariff_action add value if not exists 'fair_participation';

create table if not exists work_requests (
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

create table if not exists fair_applications (
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

create table if not exists fair_application_images (
  id uuid primary key default gen_random_uuid(),
  fair_application_id uuid not null references fair_applications(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0
);

alter table work_requests enable row level security;
alter table fair_applications enable row level security;
alter table fair_application_images enable row level security;

drop policy if exists "Public can read published work requests" on work_requests;
create policy "Public can read published work requests" on work_requests for select using (status = 'published');

drop policy if exists "Users can manage own work requests" on work_requests;
create policy "Users can manage own work requests" on work_requests for all using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "Admins can manage work requests" on work_requests;
create policy "Admins can manage work requests" on work_requests for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public can read published fair applications" on fair_applications;
create policy "Public can read published fair applications" on fair_applications for select using (status = 'published');

drop policy if exists "Users can manage own fair applications" on fair_applications;
create policy "Users can manage own fair applications" on fair_applications for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Admins can manage fair applications" on fair_applications;
create policy "Admins can manage fair applications" on fair_applications for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public can read fair application images" on fair_application_images;
create policy "Public can read fair application images" on fair_application_images for select using (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.status = 'published'
  )
);

drop policy if exists "Owners can manage fair application images" on fair_application_images;
create policy "Owners can manage fair application images" on fair_application_images for all using (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.user_id = auth.uid()
  )
);

drop policy if exists "Admins can manage fair application images" on fair_application_images;
create policy "Admins can manage fair application images" on fair_application_images for all using (public.is_admin()) with check (public.is_admin());

insert into tariffs (name, action, price, duration_days, active)
values ('Участие в ярмарке мастеров', 'fair_participation', 1000, null, true)
on conflict (action) do update
set name = excluded.name,
    price = excluded.price,
    duration_days = excluded.duration_days,
    active = true,
    updated_at = now();
