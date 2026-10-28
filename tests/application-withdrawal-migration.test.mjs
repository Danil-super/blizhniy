import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

// Static migration contract checks only. PostgreSQL execution/concurrency must
// additionally be verified in an approved disposable database before applying.
const read=name=>readFileSync(new URL(`../database/migrations/${name}`,import.meta.url),'utf8');
const executable=sql=>sql.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const up=()=>executable(read('0030-application-withdrawals.sql'));

test('withdrawal marker binds an application, owner, exact revision and finite server timestamp',()=>{
 const sql=up();
 assert.match(sql,/application_id uuid primary key references app\.applications\(id\) on delete cascade/);
 assert.match(sql,/owner_id uuid not null references app\.users\(id\) on delete cascade/);
 assert.match(sql,/withdrawn_revision bigint not null check \(withdrawn_revision>=1\)/);
 assert.match(sql,/withdrawn_at timestamptz not null default clock_timestamp\(\) check \(isfinite\(withdrawn_at\)\)/);
 assert.match(sql,/new\.withdrawn_at:=pg_catalog\.clock_timestamp\(\)/);
});

test('withdrawal trigger requires application session context and checks actual identity schema',()=>{
 const sql=up();
 assert.match(sql,/current_setting\('blizhniy\.application_session',true\)/);
 assert.match(sql,/session_hash is null or session_hash !~ '\^\[a-f0-9\]\{64\}\$'/);
 assert.match(sql,/from app\.users where id=new\.owner_id for share/);
 assert.match(sql,/actor\.is_blocked or actor\.email_verified_at is null/);
 assert.match(sql,/from app\.sessions where token_hash=session_hash and user_id=new\.owner_id and auth_version=actor\.auth_version and scope='app'/);
 assert.match(sql,/expires_at>pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/last_seen_at>pg_catalog\.clock_timestamp\(\)-interval '30 minutes'/);
 assert.doesNotMatch(sql,/absolute_expires_at|session_token|raw_token/);
});

test('withdrawal locks actor then session then application and rechecks session after waiting',()=>{
 const sql=up(),userLock=sql.indexOf('from app.users'),sessionLock=sql.indexOf('from app.sessions'),applicationLock=sql.indexOf('from app.applications');
 assert.ok(userLock>0&&sessionLock>userLock&&applicationLock>sessionLock);
 assert.match(sql,/from app\.sessions[^;]+for share;/);
 assert.match(sql,/from app\.applications where id=new\.application_id for update;/);
 const finalSessionCheck=sql.lastIndexOf('from app.sessions');
 assert.ok(finalSessionCheck>sql.indexOf('from app.payment_orders'));
 assert.match(sql.slice(finalSessionCheck),/expires_at>pg_catalog\.clock_timestamp\(\).*last_seen_at>pg_catalog\.clock_timestamp\(\)-interval '30 minutes'/);
});

test('only own exact unpaid unsent pending application can be withdrawn',()=>{
 const sql=up();
 assert.match(sql,/item\.applicant_id<>new\.owner_id/);
 assert.match(sql,/item\.revision<>new\.withdrawn_revision/);
 assert.match(sql,/item\.is_paid or item\.sent_at is not null or item\.status<>'pending_payment'/);
 assert.match(sql,/target_type='application' and target_id=new\.application_id and status in \('created','pending','succeeded'\)/);
 assert.doesNotMatch(sql,/from app\.payment_orders[^;]+(?:created_at|interval)/);
});

test('runtime cannot modify or delete a marker while owner cascade deletion remains possible',()=>{
 const sql=up();
 assert.match(sql,/if tg_op='delete' then if current_user='blizhniy_runtime' or session_user='blizhniy_runtime' then raise exception/);
 assert.match(sql,/return old; end if; if tg_op<>'insert' then raise exception/);
 assert.match(sql,/create trigger application_withdrawal_guard before insert or update or delete on app\.application_withdrawals/);
 assert.match(sql,/alter table app\.application_withdrawals enable always trigger application_withdrawal_guard/);
});

test('migration adds no grants, roles, financial writes, privilege escalation or stored session context',()=>{
 const sql=up();
 assert.match(sql,/language plpgsql security invoker set search_path=''/);
 assert.match(sql,/revoke all on app\.application_withdrawals from public/);
 assert.match(sql,/revoke all on function app\.guard_application_withdrawal\(\) from public/);
 assert.doesNotMatch(sql,/\bgrant\b|security definer|create role|\bexecute\s+(?!function\b)|set_config\(/);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from) app\.(?:applications|users|sessions|payment_\w+)\b/);
 const table=sql.match(/create table app\.application_withdrawals \((.*?)\);/)[1];
 assert.doesNotMatch(table,/session|token|hash/);
 const source=read('0030-application-withdrawals.sql');
 assert.match(source,/defense-in-depth/);
 assert.match(source,/NOT protection against a compromised runtime database role/);
});

test('rollback serializes against inserts and refuses to discard existing withdrawals',()=>{
 const sql=executable(read('0030-application-withdrawals.down.sql'));
 const lock=sql.indexOf('lock table app.application_withdrawals in access exclusive mode'),check=sql.indexOf('if exists(select 1 from app.application_withdrawals)'),drop=sql.indexOf('drop table app.application_withdrawals');
 assert.ok(lock>0&&check>lock&&drop>check);
 assert.match(sql.slice(check,drop),/raise exception.*errcode='23514'/);
 assert.match(sql,/drop function app\.guard_application_withdrawal\(\)/);
 assert.doesNotMatch(sql,/\bcascade\b|\btruncate\b|delete from|\bgrant\b/);
});
