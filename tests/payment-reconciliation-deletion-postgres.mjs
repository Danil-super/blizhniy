// Opt-in owned PG18 fixture; never reads dotenv, the manual stand or production.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import pg from 'pg';
import {getBootstrapPlan} from '../scripts/postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from '../scripts/cabinet-release-plan.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-worker33-'+randomBytes(8).toString('hex'),label='blizhniy.worker33',password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('PG18 worker retains exact rights across32 to restricted-owner33 and fails closed on drift',{timeout:90000},async()=>{
 let id,admin,db;
 try{
  id=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  assert.match(id,/^[a-f0-9]{64}$/);
  const metadata=JSON.parse(await docker(['inspect',id]))[0];assert.equal(metadata.Id,id);assert.equal(metadata.Config.Image,image);assert.equal(metadata.Config.Labels[label],name);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const end=Date.now()+20000;
  for(;;){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{if(Date.now()>end)throw Error('Owned PG18 fixture not ready');}await new Promise(r=>setTimeout(r,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  admin=new pg.Client(config);await admin.connect();
  assert.match((await admin.query("select current_setting('server_version') as version")).rows[0].version,/^18\.6/);
  await admin.query('create schema blizhniy_meta;revoke all on schema blizhniy_meta from public;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on blizhniy_meta.migrations from public');
  for(const m of [...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan()]){await admin.query(m.sql);await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[m.name,m.sha256]);}
  const plan=getPaymentReconciliationRolePlan(config.database,{cabinet:true}),workerPassword=randomBytes(24).toString('hex');
  await admin.query("revoke all on database blizhniy_test from public;create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;create role gen_user nologin nosuperuser nocreatedb createrole noinherit;grant usage,create on schema app to gen_user;grant references(id) on app.users to gen_user");
  await admin.query(plan.createRole);await admin.query(`alter role ${plan.role} login password ${pg.escapeLiteral(workerPassword)}`);
  for(const sql of plan.grants)await admin.query(sql);
  await admin.query(`grant ${plan.role} to gen_user with admin true,inherit false,set false`);
  const {PostgresDatabase}=load('postgres');db=new PostgresDatabase(new pg.Pool({...config,user:plan.role,password:workerPassword,max:1}));
  const check=()=>verifyPaymentReconciliationDatabase(db,{database:config.database});
  await check();
  const source=readFileSync(new URL('../database/migrations/0033-account-deletion.sql',import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex');
  await admin.query('begin');await admin.query('set local role gen_user');
  await admin.query(source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));
  await admin.query('reset role');await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',['0033-account-deletion.sql',hash]);await admin.query('commit');
  await admin.query(readFileSync(new URL('../database/permissions/account-deletion.sql',import.meta.url),'utf8'));
  assert.deepEqual((await admin.query("select pg_get_userbyid(relowner) as owner from pg_class where oid in ('app.account_deletion_requests'::regclass,'app.account_deletion_events'::regclass)")).rows,[{owner:'gen_user'},{owner:'gen_user'}]);
  await check();
  for(const table of ['account_deletion_requests','account_deletion_events']){await assert.rejects(db.query('select * from app.'+table+' limit 0'),{code:'42501'});}
  await admin.query(`grant select(id) on app.account_deletion_requests to ${plan.role}`);await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});await admin.query(`revoke select(id) on app.account_deletion_requests from ${plan.role}`);await check();
  await admin.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0033-account-deletion.sql'");await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0033-account-deletion.sql'",[hash]);await check();
  await admin.query("insert into blizhniy_meta.migrations(name,sha256) values('0034-checkout-edit-fence.sql',repeat('1',64))");await assert.rejects(check(),{message:'Payment reconciliation database preflight failed'});await admin.query("delete from blizhniy_meta.migrations where name='0034-checkout-edit-fence.sql'");await check();
  assert.equal((await admin.query('select count(*)::int as n from app.payment_orders')).rows[0].n,0);
 }finally{
  await db?.close();await admin?.end();
  if(id){const metadata=JSON.parse(await docker(['inspect',id]))[0];assert.equal(metadata.Id,id);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',id]);}
 }
});
