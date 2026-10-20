-- Optional additive contact preference. Existing rows retain the original phone default.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table app.listings add column contact_method text not null default 'phone'
  constraint listings_contact_method_check check (contact_method in ('phone','messenger'));
commit;
