-- Candidate for explicit installation. Apply the recipient's saved choice at delivery.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create function app.apply_inbox_preference() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
 preference_key text := case new.category
  when 'booking' then 'notifyBookings'
  when 'message' then 'notifyMessages'
  when 'payment' then 'notifyPayments'
  when 'publication' then 'notifyPublicationStatus'
  when 'system' then 'notifySystem'
 end;
begin
 if exists (
  select 1 from app.cabinet_profiles p
  where p.user_id = new.user_id and p.profile -> preference_key = 'false'::jsonb
 ) then
  -- Retain the original event key so retries cannot deliver it after preferences change.
  new.dismissed_at := new.created_at;
 end if;
 return new;
end;
$$;

revoke all on function app.apply_inbox_preference() from public;
create trigger apply_inbox_preference before insert on app.notifications
 for each row when (new.dismissed_at is null) execute function app.apply_inbox_preference();
commit;
