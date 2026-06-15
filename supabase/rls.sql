alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table organization_profiles enable row level security;
alter table regions enable row level security;
alter table cities enable row level security;
alter table categories enable row level security;
alter table specialist_categories enable row level security;
alter table listings enable row level security;
alter table listing_images enable row level security;
alter table vacancies enable row level security;
alter table work_requests enable row level security;
alter table specialist_profiles enable row level security;
alter table applications enable row level security;
alter table fair_applications enable row level security;
alter table fair_application_images enable row level security;
alter table tariffs enable row level security;
alter table payments enable row level security;
alter table notifications enable row level security;

create or replace function public.has_role(required_role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = required_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

create policy "Public can read active regions" on regions for select using (active = true);
create policy "Public can read active cities" on cities for select using (active = true);
create policy "Public can read active categories" on categories for select using (active = true);
create policy "Public can read active specialist categories" on specialist_categories for select using (active = true);
create policy "Public can read active tariffs" on tariffs for select using (active = true);

create policy "Users can read own profile" on profiles for select using (id = (select auth.uid()) or public.is_admin());
create policy "Users can update own profile" on profiles for update using (id = (select auth.uid()) or public.is_admin()) with check (id = (select auth.uid()) or public.is_admin());
create policy "Admins can insert profiles" on profiles for insert with check (public.is_admin());
create policy "Admins can delete profiles" on profiles for delete using (public.is_admin());

create policy "Users can read own roles" on user_roles for select using (user_id = (select auth.uid()) or public.is_admin());
create policy "Admins can insert roles" on user_roles for insert with check (public.is_admin());
create policy "Admins can update roles" on user_roles for update using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete roles" on user_roles for delete using (public.is_admin());

create policy "Public can read published listings" on listings for select using (status = 'published');
create policy "Users can manage own listings" on listings for all using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "Admins can manage listings" on listings for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read listing images" on listing_images for select using (
  exists (select 1 from listings where listings.id = listing_images.listing_id and listings.status = 'published')
);
create policy "Owners can manage listing images" on listing_images for all using (
  exists (select 1 from listings where listings.id = listing_images.listing_id and listings.author_id = (select auth.uid()))
) with check (
  exists (select 1 from listings where listings.id = listing_images.listing_id and listings.author_id = (select auth.uid()))
);
create policy "Admins can manage listing images" on listing_images for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read published vacancies" on vacancies for select using (status = 'published');
create policy "Users can manage own vacancies" on vacancies for all using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "Admins can manage vacancies" on vacancies for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read published work requests" on work_requests for select using (status = 'published');
create policy "Users can manage own work requests" on work_requests for all using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "Admins can manage work requests" on work_requests for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read published specialists" on specialist_profiles for select using (status = 'published');
create policy "Users can manage own specialist profile" on specialist_profiles for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Admins can manage specialist profiles" on specialist_profiles for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read published organizations" on organization_profiles for select using (status = 'published');
create policy "Users can manage own organization profile" on organization_profiles for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Admins can manage organization profiles" on organization_profiles for all using (public.is_admin()) with check (public.is_admin());

create policy "Users can read own applications" on applications for select using (
  exists (select 1 from specialist_profiles where specialist_profiles.id = applications.specialist_profile_id and specialist_profiles.user_id = (select auth.uid()))
  or exists (select 1 from vacancies where vacancies.id = applications.vacancy_id and vacancies.author_id = (select auth.uid()))
  or public.is_admin()
);
create policy "Specialists can create own applications" on applications for insert with check (
  exists (select 1 from specialist_profiles where specialist_profiles.id = applications.specialist_profile_id and specialist_profiles.user_id = (select auth.uid()))
);
create policy "Admins can manage applications" on applications for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read published fair applications" on fair_applications for select using (status = 'published');
create policy "Users can manage own fair applications" on fair_applications for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Admins can manage fair applications" on fair_applications for all using (public.is_admin()) with check (public.is_admin());

create policy "Public can read fair application images" on fair_application_images for select using (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.status = 'published'
  )
);
create policy "Owners can manage fair application images" on fair_application_images for all using (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1
    from fair_applications
    where fair_applications.id = fair_application_images.fair_application_id
      and fair_applications.user_id = (select auth.uid())
  )
);
create policy "Admins can manage fair application images" on fair_application_images for all using (public.is_admin()) with check (public.is_admin());

create policy "Users can read own payments" on payments for select using (user_id = (select auth.uid()) or public.is_admin());
create policy "Users can create own payments" on payments for insert with check (user_id = (select auth.uid()));
create policy "Admins can manage payments" on payments for all using (public.is_admin()) with check (public.is_admin());

create policy "Users can read own notifications" on notifications for select using (user_id = (select auth.uid()) or public.is_admin());
create policy "Admins can manage notifications" on notifications for all using (public.is_admin()) with check (public.is_admin());
