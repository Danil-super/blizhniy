-- Local opt-in evidence only. No refund calculation, money movement or grants.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
-- Serialize the legacy boundary with delivery/decision writers. Do not take
-- work-row locks here: an existing writer may hold one while awaiting this DDL.
lock table app.applications in share row exclusive mode;
create table app.application_contact_views (
 application_id uuid not null references app.applications(id) on delete restrict,
 recipient_id uuid not null references app.users(id) on delete restrict,
 evidence text not null default 'recipient_read' check(evidence in ('recipient_read','legacy_unknown')),
 recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at)),
 primary key(application_id,evidence)
);
create index application_contact_views_recipient_idx on app.application_contact_views(recipient_id,application_id);
revoke all on app.application_contact_views from public;

create function app.guard_application_contact_view() returns trigger
 language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='Application contact evidence is immutable';
 end if;
 if not exists(select 1 from app.applications a join app.work_publications w on w.id=a.work_publication_id
  where a.id=new.application_id and w.author_id=new.recipient_id and a.applicant_id<>new.recipient_id
   and a.is_paid and a.sent_at is not null and a.sent_at<=new.recorded_at
   and new.recorded_at<=clock_timestamp() and a.status in ('sent','viewed','selected','rejected')) then
  raise exception using errcode='23514',message='Application contact evidence requires an authorized delivery';
 end if;
 return new;
end $$;
create trigger application_contact_view_guard before insert or update or delete on app.application_contact_views
 for each row execute function app.guard_application_contact_view();
revoke all on function app.guard_application_contact_view() from public;

-- Existing delivery is not proof of either viewing or non-viewing. recorded_at
-- denotes this migration's observation, never a fabricated historical view time.
insert into app.application_contact_views(application_id,recipient_id,evidence)
 select a.id,w.author_id,'legacy_unknown' from app.applications a
 join app.work_publications w on w.id=a.work_publication_id
 where a.is_paid and a.sent_at is not null and a.status in ('sent','viewed','selected','rejected');

-- Preserve explicit viewing/selection from older authorized clients too. Bulk
-- rejection of other responses does not itself mean their contacts were read.
create function app.record_application_view_decision() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('viewed','selected') and new.status is distinct from old.status then
  insert into app.application_contact_views(application_id,recipient_id)
   select new.id,w.author_id from app.work_publications w where w.id=new.work_publication_id
   on conflict do nothing;
 end if;
 return new;
end $$;
create trigger application_view_decision after update of status on app.applications
 for each row execute function app.record_application_view_decision();
revoke all on function app.record_application_view_decision() from public;
commit;
