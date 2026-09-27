-- Persist the signup assertion independently of later edits to Auth user metadata.
-- The source is client-controlled and must not be treated as proof of a UI click.
-- The two checkboxes have different meanings: accepting the agreement and
-- acknowledging the privacy policy. Neither is a general marketing/publication consent.
create table if not exists public.registration_legal_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('agreement_acceptance_asserted', 'privacy_review_asserted')),
  document_version text not null,
  purpose text not null check (purpose = 'account_registration'),
  assertion_source text not null default 'client_supplied_auth_metadata'
    check (assertion_source = 'client_supplied_auth_metadata'),
  recorded_at timestamptz not null default now(),
  primary key (user_id, event_type, document_version)
);

comment on table public.registration_legal_events is
  'Server-timestamped snapshot of self-asserted signup metadata, not proof that a checkbox was clicked.';

alter table public.registration_legal_events enable row level security;

-- Only the database-owned signup trigger writes these immutable audit rows.
revoke all on public.registration_legal_events from public, anon, authenticated;
grant select on public.registration_legal_events to service_role;

create schema if not exists registration_internal;
revoke all on schema registration_internal from public, anon, authenticated;

create or replace function registration_internal.record_registration_legal_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  legal jsonb := new.raw_user_meta_data -> 'registration_legal';
begin
  if legal ->> 'purpose' = 'account_registration' then
    if legal ->> 'agreement_acceptance_asserted' = 'true'
       and legal ->> 'agreement_version' = '2026-06-18' then
      insert into public.registration_legal_events (user_id, event_type, document_version, purpose)
      values (new.id, 'agreement_acceptance_asserted', '2026-06-18', 'account_registration')
      on conflict do nothing;
    end if;

    if legal ->> 'privacy_review_asserted' = 'true'
       and legal ->> 'privacy_version' = '2026-06-18' then
      insert into public.registration_legal_events (user_id, event_type, document_version, purpose)
      values (new.id, 'privacy_review_asserted', '2026-06-18', 'account_registration')
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function registration_internal.record_registration_legal_events()
  from public, anon, authenticated;

drop trigger if exists on_auth_registration_legal_events on auth.users;
create trigger on_auth_registration_legal_events
after insert on auth.users
for each row execute function registration_internal.record_registration_legal_events();

do $assert_privileges$
begin
  if has_table_privilege('anon', 'public.registration_legal_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.registration_legal_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.registration_legal_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.registration_legal_events', 'DELETE')
     or not has_table_privilege('service_role', 'public.registration_legal_events', 'SELECT') then
    raise exception 'registration legal event privileges are not private';
  end if;
end
$assert_privileges$;
