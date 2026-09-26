-- Temporary fail-closed gate until payment fulfillment migration and app release are tested together.
-- Server-side draft edits remain available through the authenticated application API.
revoke insert, update on public.specialist_profiles from anon, authenticated;

create or replace function private.reject_unpaid_specialist_activation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      raise exception using errcode = '23514',
        message = 'Specialist publication is temporarily unavailable until payment fulfillment is verified';
    elsif old.status is distinct from 'published' then
      raise exception using errcode = '23514',
        message = 'Specialist publication is temporarily unavailable until payment fulfillment is verified';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_unpaid_specialist_activation() from public, anon, authenticated;
drop trigger if exists reject_unpaid_specialist_activation on public.specialist_profiles;
create trigger reject_unpaid_specialist_activation
before insert or update of status on public.specialist_profiles
for each row execute function private.reject_unpaid_specialist_activation();
