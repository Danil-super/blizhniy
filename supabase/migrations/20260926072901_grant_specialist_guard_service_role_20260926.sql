-- Preserve the application's service-role draft edits while the browser has no direct write grant.
grant execute on function private.reject_unpaid_specialist_activation() to service_role;
