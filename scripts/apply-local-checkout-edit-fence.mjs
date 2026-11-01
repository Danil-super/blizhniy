// Explicit operator action for the existing owned, synthetic Docker stand only.
import assert from 'node:assert/strict';
import pg from 'pg';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {stateFile,localPrimaryDatabaseConfig,getLocalPrimaryExtraMigrations,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getLocalTelegramMigrations,withoutTransaction} from './local-telegram-migrations.mjs';
import {getLocalDeletionMigrations} from './local-deletion-schema.mjs';
import {getLocalCheckoutEditMigrations} from './local-checkout-edit-schema.mjs';

assert.ok(process.argv.length===3&&['--plan','--apply-local'].includes(process.argv[2]),'Use --plan or --apply-local');
const apply=process.argv[2]==='--apply-local',state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const migration=(await getLocalCheckoutEditMigrations())[0];
const expected=[...getBootstrapPlan({includeListingContactMethod:true}),...await getLocalPrimaryExtraMigrations(),
 ...await getLocalTelegramMigrations(),...await getLocalDeletionMigrations(),migration].map(({name,sha256})=>({name,sha256}));
assert.equal(expected.length,34);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));
await owner.connect();
try{
 await owner.query(apply?'begin':'begin read only');
 try{
  await owner.query("set local lock_timeout='3s';set local statement_timeout='10s'");
  if(apply)await owner.query('select pg_advisory_xact_lock(187924,1)');
  const target=(await owner.query("select current_database() as database,current_user as role,current_setting('server_version_num')::int as version")).rows[0];
  assert.ok(target.database===state.database&&target.role==='postgres'&&target.version>=180000&&target.version<190000);
  const journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  assert.ok(journal.length===33||journal.length===34,'Unexpected local journal');
  assert.deepEqual(journal,expected.slice(0,journal.length));
  const role=(await owner.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
  assert.ok(role&&Object.values(role).every(value=>value===false),'Unexpected runtime authority');
  const acl=(await owner.query("select relname,relacl::text from pg_class where oid in ('app.payment_orders'::regclass,'app.payment_fulfillments'::regclass) order by relname")).rows;
  if(apply&&journal.length===33){
   await owner.query(withoutTransaction(migration.source));
   await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);
  }
  if(apply||journal.length===34){
   const guards=(await owner.query(`select p.proname,p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) as owner,
    has_function_privilege('blizhniy_runtime',p.oid,'EXECUTE') as callable,
    (select count(*)::int from pg_trigger t where t.tgfoid=p.oid and t.tgenabled='O') as triggers
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname in ('guard_checkout_edit','guard_checkout_photo_edit') order by p.proname`)).rows;
   assert.equal(guards.length,2);
   for(const guard of guards)assert.ok(guard.prosecdef&&guard.provolatile==='v'&&guard.owner==='postgres'&&!guard.callable&&guard.triggers===2&&guard.proconfig?.includes('search_path=""'));
  }
  assert.deepEqual((await owner.query("select relname,relacl::text from pg_class where oid in ('app.payment_orders'::regclass,'app.payment_fulfillments'::regclass) order by relname")).rows,acl,'No financial grants may change');
  await owner.query('commit');
  console.log(JSON.stringify({status:apply?'applied':'plan',schema:apply?34:journal.length,migration:migration.name,grantsChanged:false,productionTouched:false}));
 }catch(error){await owner.query('rollback');throw error;}
}finally{await owner.end();}
