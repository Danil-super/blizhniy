-- Local simulator only. A dispatch anchor is irreversible, even after a lost POST reply.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.payment_checkout_cancellations (
 payment_id uuid primary key references app.payment_orders(id) on delete restrict,
 owner_id uuid not null references app.users(id) on delete restrict,
 target_type text not null check(target_type in ('listing','vacancy','workRequest','application')),
 cancelled_at timestamptz not null check(isfinite(cancelled_at))
);
create function app.guard_checkout_cancellation() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare session_hash text;actor uuid;version bigint;purchase app.payment_checkout_intents;checkout app.payment_orders;previous app.payment_checkout_cancellations;
begin
 if tg_op<>'INSERT' then raise exception 'Checkout cancellation history is immutable' using errcode='42501';end if;
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Cancellation requires read committed' using errcode='PCA04';end if;
 session_hash:=pg_catalog.current_setting('blizhniy.checkout_cancel_session',true);
 if session_hash is null or session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Owner session required' using errcode='PCA03';end if;
 select user_id into actor from app.sessions where token_hash=session_hash;
 select auth_version into version from app.users where id=actor and not is_blocked and email_verified_at is not null for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 perform token_hash from app.sessions where token_hash=session_hash and user_id=actor and auth_version=version and scope='app'
  and expires_at>pg_catalog.clock_timestamp() and last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes' for update;
 if not found then raise exception 'Owner session required' using errcode='PCA03';end if;
 select * into purchase from app.payment_checkout_intents where id=new.payment_id for update nowait;
 if not found or purchase.owner_id<>actor or not purchase.is_test or purchase.merchant_shop_id<>'local-fixture-shop'
  or purchase.target_type not in ('listing','vacancy','workRequest','application') then raise exception 'Local checkout required' using errcode='PCA01';end if;
 select * into checkout from app.payment_orders where id=purchase.id for update nowait;
 if not found or row(checkout.owner_id,checkout.target_type,checkout.target_id,checkout.target_revision)
  is distinct from row(purchase.owner_id,purchase.target_type,purchase.target_id,purchase.target_revision) then raise exception 'Local checkout required' using errcode='PCA01';end if;
 select * into previous from app.payment_checkout_cancellations where payment_id=purchase.id;
 if found then new.owner_id:=previous.owner_id;new.target_type:=previous.target_type;new.cancelled_at:=previous.cancelled_at;return new;end if;
 if checkout.status<>'created' or exists(select 1 from app.payment_dispatch_anchors where intent_id=purchase.id) then
  raise exception 'Checkout dispatch may already have started' using errcode='PCA02';end if;
 new.owner_id:=actor;new.target_type:=purchase.target_type;new.cancelled_at:=pg_catalog.clock_timestamp();return new;
end $$;
create function app.apply_checkout_cancellation() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
begin
 if not exists(select 1 from app.sessions s join app.users u on u.id=s.user_id
  where s.token_hash=pg_catalog.current_setting('blizhniy.checkout_cancel_session',true) and s.user_id=new.owner_id and s.auth_version=u.auth_version
   and s.scope='app' and not u.is_blocked and u.email_verified_at is not null
   and s.expires_at>pg_catalog.clock_timestamp() and s.last_seen_at>pg_catalog.clock_timestamp()-interval '30 minutes') then
  raise exception 'Owner session expired' using errcode='PCA03';end if;
 -- ON CONFLICT may discard a BEFORE-validated row. Only a successful INSERT applies the effect.
 update app.payment_orders set status='failed' where id=new.payment_id and owner_id=new.owner_id and status='created'
  and not exists(select 1 from app.payment_dispatch_anchors where intent_id=new.payment_id);
 if not found then raise exception 'Checkout dispatch may already have started' using errcode='PCA02';end if;
 return new;
end $$;
create trigger checkout_cancellation_guard before insert or update or delete on app.payment_checkout_cancellations for each row execute function app.guard_checkout_cancellation();
create trigger checkout_cancellation_truncate_guard before truncate on app.payment_checkout_cancellations for each statement execute function app.guard_checkout_cancellation();
create trigger checkout_cancellation_effect after insert on app.payment_checkout_cancellations for each row execute function app.apply_checkout_cancellation();
alter table app.payment_checkout_cancellations enable always trigger checkout_cancellation_guard;
alter table app.payment_checkout_cancellations enable always trigger checkout_cancellation_truncate_guard;
alter table app.payment_checkout_cancellations enable always trigger checkout_cancellation_effect;
create function app.guard_cancelled_checkout_dispatch() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('transaction_isolation')<>'read committed' then raise exception 'Dispatch requires read committed' using errcode='PCA04';end if;
 -- Canonical dispatch and cancellation take this same lock before either journal can commit.
 perform id from app.payment_checkout_intents where id=new.intent_id for update nowait;
 if exists(select 1 from app.payment_checkout_cancellations where payment_id=new.intent_id) then
  raise exception 'Checkout preparation was cancelled' using errcode='PCA02';end if;
 return new;
end $$;
create trigger checkout_cancellation_dispatch_fence before insert on app.payment_dispatch_anchors for each row execute function app.guard_cancelled_checkout_dispatch();
alter table app.payment_dispatch_anchors enable always trigger checkout_cancellation_dispatch_fence;
revoke all on app.payment_checkout_cancellations from public;
revoke all on function app.guard_checkout_cancellation(),app.apply_checkout_cancellation(),app.guard_cancelled_checkout_dispatch() from public;
commit;
