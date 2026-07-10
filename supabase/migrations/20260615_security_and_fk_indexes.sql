-- Tighten public execution of trigger-only functions and add indexes for foreign keys reported by Supabase advisors.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

revoke all on function private.has_role(public.app_role) from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon, authenticated;

create index if not exists applications_specialist_profile_id_idx on public.applications (specialist_profile_id);
create index if not exists applications_vacancy_id_idx on public.applications (vacancy_id);
create index if not exists categories_parent_id_idx on public.categories (parent_id);
create index if not exists cities_region_id_idx on public.cities (region_id);
create index if not exists fair_application_images_fair_application_id_idx on public.fair_application_images (fair_application_id);
create index if not exists fair_applications_city_id_idx on public.fair_applications (city_id);
create index if not exists fair_applications_region_id_idx on public.fair_applications (region_id);
create index if not exists fair_applications_user_id_idx on public.fair_applications (user_id);
create index if not exists listing_images_listing_id_idx on public.listing_images (listing_id);
create index if not exists listings_author_id_idx on public.listings (author_id);
create index if not exists listings_category_id_idx on public.listings (category_id);
create index if not exists listings_city_id_idx on public.listings (city_id);
create index if not exists listings_region_id_idx on public.listings (region_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists organization_profiles_city_id_idx on public.organization_profiles (city_id);
create index if not exists organization_profiles_region_id_idx on public.organization_profiles (region_id);
create index if not exists organization_profiles_user_id_idx on public.organization_profiles (user_id);
create index if not exists payments_tariff_id_idx on public.payments (tariff_id);
create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists specialist_profiles_city_id_idx on public.specialist_profiles (city_id);
create index if not exists specialist_profiles_region_id_idx on public.specialist_profiles (region_id);
create index if not exists specialist_profiles_specialist_category_id_idx on public.specialist_profiles (specialist_category_id);
create index if not exists vacancies_author_id_idx on public.vacancies (author_id);
create index if not exists vacancies_city_id_idx on public.vacancies (city_id);
create index if not exists vacancies_region_id_idx on public.vacancies (region_id);
create index if not exists vacancies_specialist_category_id_idx on public.vacancies (specialist_category_id);
create index if not exists work_requests_author_id_idx on public.work_requests (author_id);
create index if not exists work_requests_city_id_idx on public.work_requests (city_id);
create index if not exists work_requests_region_id_idx on public.work_requests (region_id);
create index if not exists work_requests_specialist_category_id_idx on public.work_requests (specialist_category_id);
