-- Opt-in only, after schema/checks. No erasure, financial or role authority.
begin;
grant select on app.account_deletion_requests,app.account_deletion_events to blizhniy_runtime;
grant insert(user_id),update(status,resolution,case_reference) on app.account_deletion_requests to blizhniy_runtime;
commit;
