-- Additive private interaction records. No automatic delivery, payment or grants.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.applications (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 applicant_id uuid not null references app.users(id) on delete cascade,
 work_publication_id uuid not null references app.work_publications(id) on delete cascade,
 specialist_publication_id uuid references app.service_publications(id) on delete set null,
 creation_key uuid not null,
 target_revision bigint not null check (target_revision>=1),
 specialist_revision bigint not null check (specialist_revision>=1),
 snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=16384),
 message text not null default '' check (message=btrim(message) and char_length(message)<=3000),
 revision bigint not null default 1 check (revision>=1),
 status text not null default 'pending_payment' check (status in ('pending_payment','paid','sent','viewed','selected','rejected')),
 is_paid boolean not null default false,
 sent_at timestamptz check (isfinite(sent_at)),
 created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
 updated_at timestamptz not null default clock_timestamp() check (isfinite(updated_at)),
 unique(applicant_id,creation_key),unique(applicant_id,work_publication_id),
 constraint application_delivery_state check (
  (not is_paid and status='pending_payment' and sent_at is null) or
  (is_paid and status='paid' and sent_at is null) or
  (is_paid and status in ('sent','viewed','selected','rejected') and sent_at is not null and sent_at>=created_at))
);
create index application_target_idx on app.applications(work_publication_id,created_at desc,id desc);
create index application_specialist_idx on app.applications(specialist_publication_id);
create index application_owner_idx on app.applications(applicant_id,created_at desc,id desc);
create table app.booking_requests (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 listing_id uuid not null references app.listings(id) on delete cascade,
 guest_id uuid not null references app.users(id) on delete cascade,
 creation_key uuid not null,
 mode text not null check (mode in ('stay','tour')),
 start_date date not null check (isfinite(start_date)),
 end_date date check (isfinite(end_date)),
 guests integer not null check (guests between 1 and 1000),
 total numeric(20,2) not null check (total>=0 and total<'Infinity'::numeric),
 details_snapshot jsonb not null check (jsonb_typeof(details_snapshot)='object' and octet_length(details_snapshot::text)<=16384),
 revision bigint not null default 1 check (revision>=1),
 status text not null default 'pending' check (status in ('pending','accepted','declined')),
 created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
 updated_at timestamptz not null default clock_timestamp() check (isfinite(updated_at)),
 decided_at timestamptz check (isfinite(decided_at)),
 unique(guest_id,creation_key),
 constraint booking_period check ((mode='tour' and end_date is null) or (mode='stay' and end_date is not null and end_date>start_date and end_date-start_date<=30)),
 constraint booking_decision check ((status='pending' and decided_at is null) or (status in ('accepted','declined') and decided_at is not null and decided_at>=created_at))
);
create index booking_listing_idx on app.booking_requests(listing_id,start_date,id) where status in ('pending','accepted');
create index booking_guest_idx on app.booking_requests(guest_id,created_at desc,id desc);
create table app.notifications (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 user_id uuid not null references app.users(id) on delete cascade,
 event_key text not null check (event_key ~ '^[a-zA-Z0-9:_-]{1,200}$'),
 category text not null check (category in ('system','publication','payment','message','booking')),
 tone text not null check (tone in ('info','success','warning')),
 title text not null check (title=btrim(title) and char_length(title) between 1 and 200),
 body text not null check (body=btrim(body) and char_length(body) between 1 and 4000),
 action_href text check (action_href ~ '^/cabinet(/[a-z0-9-]+)*$'),
 booking_request_id uuid references app.booking_requests(id) on delete set null,
 read_at timestamptz check (isfinite(read_at)),
 dismissed_at timestamptz check (isfinite(dismissed_at)),
 created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
 unique(user_id,event_key)
);
create index notification_owner_idx on app.notifications(user_id,created_at desc,id desc) where dismissed_at is null;
create index notification_booking_idx on app.notifications(booking_request_id);
revoke all on app.applications from public;
revoke all on app.booking_requests from public;
revoke all on app.notifications from public;
commit;
