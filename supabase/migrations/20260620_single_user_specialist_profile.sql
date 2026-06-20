-- Make specialist profile a single inactive-by-default account profile.

alter table public.specialist_profiles
  alter column status set default 'draft';

create unique index if not exists specialist_profiles_user_id_unique
  on public.specialist_profiles (user_id);

create index if not exists specialist_profiles_status_updated_at_idx
  on public.specialist_profiles (status, updated_at desc);

comment on table public.specialist_profiles is
  'One specialist profile per user. Draft profiles are private; published profiles are active and can be used for paid responses.';
