begin;

create table private.work_draft_creations (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('vacancies','work_requests')),
  creation_key uuid not null,
  request_hash bytea not null,
  publication_id uuid not null,
  primary key (owner_id, kind, creation_key)
);
revoke all on private.work_draft_creations from public, anon, authenticated, service_role;
grant select, insert on private.work_draft_creations to service_role;

create function public.create_work_draft_once(p_kind text, p_key uuid, p_fields jsonb, p_paths text[])
returns uuid language plpgsql strict security invoker set search_path = '' as $$
declare
  owner uuid := (p_fields->>'author_id')::uuid;
  fingerprint bytea := sha256(convert_to(jsonb_build_array(p_fields, p_paths)::text, 'UTF8'));
  receipt private.work_draft_creations%rowtype;
  saved_id uuid;
begin
  if owner is null or p_kind not in ('vacancies','work_requests')
     or p_fields->>'status' is distinct from 'draft'
     or coalesce((p_fields->>'is_paid')::boolean, false) or p_fields->>'published_at' is not null then
    raise exception 'Invalid draft' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner::text || ':' || p_kind || ':' || p_key::text, 0));
  select * into receipt from private.work_draft_creations
    where owner_id = owner and kind = p_kind and creation_key = p_key;
  if found then
    if receipt.request_hash <> fingerprint then return null; end if;
    return receipt.publication_id;
  end if;

  if p_kind = 'vacancies' then
    select id into strict saved_id from public.create_vacancy_with_gallery(p_fields, p_paths);
  else
    select id into strict saved_id from public.create_work_request_with_gallery(p_fields, p_paths);
  end if;
  insert into private.work_draft_creations(owner_id, kind, creation_key, request_hash, publication_id)
    values (owner, p_kind, p_key, fingerprint, saved_id);
  return saved_id;
end;
$$;
revoke all on function public.create_work_draft_once(text, uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.create_work_draft_once(text, uuid, jsonb, text[]) to service_role;
notify pgrst, 'reload schema';
commit;
