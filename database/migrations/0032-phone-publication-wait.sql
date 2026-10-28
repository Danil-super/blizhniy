-- Durable phone wait without changing completed/blocked financial-job history.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
alter table app.payment_reconciliation_jobs drop constraint payment_reconciliation_jobs_state_check;
alter table app.payment_reconciliation_jobs add constraint payment_reconciliation_jobs_state_check
 check(state in ('queued','processing','completed','blocked','waiting_phone'));
alter table app.payment_reconciliation_jobs drop constraint payment_reconciliation_jobs_last_code_check;
alter table app.payment_reconciliation_jobs add constraint payment_reconciliation_jobs_last_code_check
 check(last_code in ('provider_pending','capture_required','processing_unavailable','publication_blocked','attempts_exhausted','phone_required'));
alter table app.payment_reconciliation_jobs add constraint payment_phone_wait_state
 check(state<>'waiting_phone' or last_code is not distinct from 'phone_required');
create function app.guard_phone_wait_job() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare owner_id uuid;
 begin
  if old.last_code='phone_required' and new.state in ('queued','processing') then new.last_code:='phone_required';end if;
  if new.state='waiting_phone' then
   select i.owner_id into owner_id from app.payment_checkout_intents i where i.id=new.intent_id;
   perform 1 from app.users where id=owner_id for update;
   new.claim_id:=null;new.lease_until:=null;new.attempts:=0;
   if not (select required from app.phone_verification_policy where singleton) or app.phone_is_confirmed(owner_id) then
    new.state:='queued';new.last_code:='phone_required';new.next_attempt_at:=clock_timestamp();
   else new.last_code:='phone_required';end if;
  end if;
  return new;
 end $$;
create trigger payment_phone_wait_guard before update on app.payment_reconciliation_jobs for each row execute function app.guard_phone_wait_job();
create function app.wake_phone_publications() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if app.phone_is_confirmed(new.user_id) then
   update app.payment_reconciliation_jobs q set state='queued',next_attempt_at=clock_timestamp()
    from app.payment_checkout_intents i where i.id=q.intent_id and i.owner_id=new.user_id and q.state='waiting_phone';
  end if;
  return new;
 end $$;
create trigger phone_binding_wake after insert or update on app.telegram_phone_bindings for each row execute function app.wake_phone_publications();
create trigger phone_profile_wake after insert or update on app.cabinet_profiles for each row execute function app.wake_phone_publications();
create function app.guard_phone_payment_window() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 declare shift interval;
 begin
  if new.status='published' and (tg_op='INSERT' or old.status is distinct from new.status) then
   if (select required from app.phone_verification_policy where singleton) then
    perform 1 from app.users where id=new.author_id for update;
    if not app.phone_is_confirmed(new.author_id) then raise exception using errcode='P7601',message='Verified phone required';end if;
   end if;
   if (select required from app.phone_verification_policy where singleton) or exists(select 1 from app.payment_reconciliation_jobs q join app.payment_checkout_intents i on i.id=q.intent_id where i.target_id=new.id and q.last_code='phone_required') then
    -- The first paid placement starts when it actually becomes available.
    -- Restores and existing receipts cannot renew the purchased window.
    if tg_op='UPDATE' and old.status='draft' and not old.is_paid and old.published_at is null and old.expires_at is null and new.is_paid then
     shift:=clock_timestamp()-new.published_at;new.published_at:=new.published_at+shift;new.expires_at:=new.expires_at+shift;
    end if;
   end if;
   if new.expires_at<=clock_timestamp() then raise exception using errcode='P7602',message='Publication period unavailable';end if;
  end if;
  return new;
 end $$;
create trigger listing_phone_payment_window before insert or update on app.listings for each row execute function app.guard_phone_payment_window();
create trigger work_phone_payment_window before insert or update on app.work_publications for each row execute function app.guard_phone_payment_window();
create function app.wake_disabled_phone_policy() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if old.required and not new.required then
   update app.payment_reconciliation_jobs set state='queued',next_attempt_at=clock_timestamp() where state='waiting_phone';
  end if;
  return new;
 end $$;
create trigger phone_policy_wake after update on app.phone_verification_policy for each row execute function app.wake_disabled_phone_policy();
revoke all on function app.wake_disabled_phone_policy() from public;
revoke all on function app.guard_phone_wait_job(),app.wake_phone_publications(),app.guard_phone_payment_window() from public;
commit;
