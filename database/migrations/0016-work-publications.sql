-- Additive vacancy/order storage only; no application cutover or copied records.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.work_publications (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 author_id uuid not null references app.users(id) on delete cascade,
 kind text not null check (kind in ('vacancy','workRequest')),
 creation_key uuid not null,
 form jsonb not null check (jsonb_typeof(form)='object' and octet_length(form::text)<=65536),
 title text generated always as (form->>'title') stored not null check (title=btrim(title) and char_length(title)<=120),
 city_id uuid references app.cities(id),
 profession_id uuid references app.specialist_categories(id),
 revision bigint not null default 1 check (revision>=1),
 status text not null default 'draft' check (status in ('draft','pending_payment','paid','published','archived','expired','rejected')),
 is_paid boolean not null default false,
 created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
 updated_at timestamptz not null default clock_timestamp() check (isfinite(updated_at)),
 published_at timestamptz check (isfinite(published_at)),
 expires_at timestamptz check (isfinite(expires_at)),
 deleted_at timestamptz check (isfinite(deleted_at)),
 unique(author_id,kind,creation_key),
 constraint work_publication_form_kind check (form ? 'kind' and jsonb_typeof(form->'kind')='string' and form->>'kind'=kind),
 constraint work_publication_form_title check (form ? 'title' and jsonb_typeof(form->'title')='string'),
 constraint work_publication_dates check ((published_at is null)=(expires_at is null) and (published_at is null or expires_at>published_at)),
 constraint work_publication_unpaid_draft check (status not in ('draft','pending_payment') or (not is_paid and published_at is null)),
 constraint work_publication_published_complete check (status<>'published' or
  (is_paid and published_at is not null and city_id is not null and profession_id is not null and char_length(title)>=3 and deleted_at is null))
);
create index work_publications_owner_idx on app.work_publications(author_id,kind,updated_at desc,id desc) where deleted_at is null;
create index work_publications_city_idx on app.work_publications(city_id);
create index work_publications_profession_idx on app.work_publications(profession_id);
create index work_publications_public_idx on app.work_publications(kind,published_at desc,id desc) where status='published' and deleted_at is null;
create table app.work_publication_photos (
 publication_id uuid not null references app.work_publications(id) on delete cascade,
 media_id uuid not null references app.media_objects(id),
 position integer not null check (position between 0 and 19),
 primary key(publication_id,media_id),
 unique(publication_id,position)
);
create index work_publication_photos_media_idx on app.work_publication_photos(media_id);
create table app.work_moderation (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 publication_id uuid not null references app.work_publications(id) on delete cascade,
 revision bigint not null check (revision>=1),
 state text not null default 'pending' check (state in ('pending','approved','rejected')),
 submitted_at timestamptz not null default clock_timestamp() check (isfinite(submitted_at)),
 decided_at timestamptz check (isfinite(decided_at) and decided_at>=submitted_at),
 decided_by uuid references app.users(id) on delete set null,
 decision_note text check (decision_note=btrim(decision_note) and char_length(decision_note) between 1 and 1000),
 unique(publication_id,revision),
 constraint work_moderation_decision check (
  (state='pending' and decided_at is null and decided_by is null and decision_note is null) or
  (state='approved' and decided_at is not null and decision_note is null) or
  (state='rejected' and decided_at is not null and decision_note is not null)
 )
);
create index work_moderation_pending_idx on app.work_moderation(submitted_at,id) where state='pending';
create index work_moderation_reviewer_idx on app.work_moderation(decided_by);
revoke all on app.work_publications from public;
revoke all on app.work_publication_photos from public;
revoke all on app.work_moderation from public;
commit;
