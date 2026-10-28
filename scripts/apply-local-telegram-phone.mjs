// Explicit owned loopback fixture only. No dotenv, remote hosts or production role.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {stateFile,localPrimaryDatabaseConfig,docker,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getLocalTelegramMigrations,withoutTransaction} from './local-telegram-migrations.mjs';
import {readLocalTelegramConfig} from './local-telegram-config.mjs';
async function main(){
 const action=process.argv[2];
 assert.ok(process.argv.length===3&&['--plan','--apply-local','--enable-local','--disable-local'].includes(action),'Use --plan, --apply-local, --enable-local or --disable-local');
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const migrations=await getLocalTelegramMigrations();
 const expected=[...getBootstrapPlan({includeListingContactMethod:true}),...await getLocalPrimaryExtraMigrations(),...migrations].map(({name,sha256})=>({name,sha256}));
 const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();let began=false;
 try{
  await db.query(action==='--plan'?'begin read only':'begin');began=true;
  await db.query("set local lock_timeout='3s';set local statement_timeout='10s'");
  if(action!=='--plan')await db.query('select pg_advisory_xact_lock(187924,31)');
  const identity=(await db.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];
  assert.ok(identity.name===state.database&&identity.version>=180000&&identity.version<190000);
  const role=(await db.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
  assert.ok(role&&Object.values(role).every(value=>value===false),'Unexpected runtime role');
  const journal=(await db.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  assert.ok(journal.length===30||journal.length===32,'Unexpected local schema');assert.deepEqual(journal,expected.slice(0,journal.length));
  if(action==='--apply-local'&&journal.length===30){
   assert.equal((await db.query("select to_regclass('app.telegram_phone_bindings') as binding")).rows[0].binding,null,'Unjournaled phone schema');
   for(const migration of migrations){await db.query(withoutTransaction(migration.source));await db.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);}
   await db.query(withoutTransaction(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8')));
  }else if(action==='--enable-local'||action==='--disable-local'){
   assert.equal(journal.length,32,'Apply reviewed local migrations first');
   if(action==='--enable-local'){
    const settings=readLocalTelegramConfig(process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG,state.origin);
    assert.equal(settings.BLIZHNIY_TELEGRAM_PHONE,'enabled','Explicit private Login client configuration required');
    await db.query('update app.phone_verification_policy set available=true,required=true where singleton');
   }else await db.query('update app.phone_verification_policy set required=false,available=false where singleton');
  }
  await db.query('commit');began=false;
  console.log(JSON.stringify({target:{origin:state.origin,host:'127.0.0.1',database:state.database},action,schema:action==='--apply-local'?32:journal.length,migrations:migrations.map(({name,sha256})=>({name,sha256})),productionTouched:false}));
 }catch(error){if(began)await db.query('rollback');throw error;}finally{await db.end();}
}
main().catch(()=>{console.error('Local Telegram operation refused. Inspect the owned fixture/schema/configuration; no automatic retry or remote operation.');process.exitCode=1;});
