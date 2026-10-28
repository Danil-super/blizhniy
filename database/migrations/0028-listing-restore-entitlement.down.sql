-- Fail closed: removal requires keeping status writes disabled until a reviewed replacement.
begin;
set local lock_timeout='3s';
revoke update(status) on app.listings from blizhniy_runtime;
commit;
