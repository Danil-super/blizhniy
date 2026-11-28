-- Stop the verifier before reverting this candidate. Key and enrollment data are retained.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

revoke select (session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at),
  insert (session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at),
  update (auth_version,kind,command_digest,credential_ids,challenge,expires_at),delete
  on app_admin_passkey.challenges from blizhniy_passkey_verifier;
revoke select (id,admin_id,user_handle,public_key,counter,created_at,revoked_at),update (counter)
  on app_admin_passkey.credentials from blizhniy_passkey_verifier;
revoke usage on schema app_admin_passkey from blizhniy_passkey_verifier;

drop function app_admin_passkey.store_access_permit(text,bigint,text,jsonb);
drop function app_admin_passkey.complete_enrollment(text,text,text,text,text,bytea,bigint);
drop function app_admin_passkey.bind_enrollment(text,text,text,text,text);
drop function app_admin_passkey.enrollment_state(text,text,text);
drop function app_admin_passkey.session_state(text,boolean);

commit;
