-- Local opt-in. Parent mutations are confined to the authenticated journal trigger.
begin;
grant select on app.work_owner_actions to blizhniy_runtime;
grant insert(operation_id,publication_id,expected_revision,action,reason) on app.work_owner_actions to blizhniy_runtime;
commit;
