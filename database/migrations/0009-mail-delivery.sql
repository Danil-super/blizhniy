-- Additive delivery state; not enabled in the production bootstrap manifest.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table app.mail_outbox
  add column state text not null default 'ready',
  add column attempts integer not null default 0,
  add column available_at timestamptz not null default statement_timestamp(),
  add column claim_id uuid,
  add column lease_until timestamptz,
  add column last_code text,
  add constraint mail_delivery_state check (state in ('ready','reserved','sending','accepted','cancelled','failed','unknown')),
  add constraint mail_delivery_attempts check (attempts between 0 and 5),
  add constraint mail_delivery_lease check (
    (state in ('reserved','sending') and claim_id is not null and lease_until is not null)
    or (state not in ('reserved','sending') and claim_id is null and lease_until is null)),
  add constraint mail_delivery_code check (last_code in ('TEMPORARY','AUTH_FAILED','REJECTED','UNKNOWN','STALE','INVALID_PAYLOAD','LOST_WORKER'));
create index mail_delivery_ready_idx on app.mail_outbox(available_at,id) where state='ready';
create index mail_delivery_lease_idx on app.mail_outbox(lease_until,id) where state in ('reserved','sending');
commit;
