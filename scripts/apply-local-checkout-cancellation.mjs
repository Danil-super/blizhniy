// Explicit owned local operation only; never imports dotenv or connects remotely.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createConnection} from 'node:net';
import pg from 'pg';
import {stateFile,docker,localPrimaryDatabaseConfig,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryState,validateLocalPrimaryContainer,validateLocalPrimaryContainerDefinition} from './local-primary-config.mjs';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {getLocalTelegramMigrations,withoutTransaction} from './local-telegram-migrations.mjs';
import {getLocalDeletionMigrations} from './local-deletion-schema.mjs';
import {getLocalCheckoutEditMigrations} from './local-checkout-edit-schema.mjs';
import {getLocalApplicationContactMigrations} from './local-application-contact-schema.mjs';
import {getLocalBookingLifecycleMigrations} from './local-booking-lifecycle-schema.mjs';
import {getLocalWorkOwnerActionsMigrations} from './local-work-owner-actions-schema.mjs';
import {getLocalResponseCheckoutMigrations} from './local-response-checkout-schema.mjs';
import {getLocalCheckoutCancellationMigrations} from './local-checkout-cancellation-schema.mjs';
assert.deepEqual(process.argv.slice(2),['--apply']);
const root=realpathSync(fileURLToPath(new URL('..',import.meta.url))),saved=readLocalPrimaryState(stateFile,root);
const metadata=JSON.parse(await docker(['inspect',saved.containerId]))[0];validateLocalPrimaryContainerDefinition(metadata,saved);
if(!metadata.State.Running)await docker(['start',saved.containerId]);
const running=JSON.parse(await docker(['inspect',saved.containerId]))[0];
const state=validateLocalPrimaryState({...saved,dbPort:Number(running.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort)},root);
validateLocalPrimaryContainer(running,state);
const readyDeadline=Date.now()+20000;
for(;;){try{await docker(['exec',state.containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d',state.database]);break;}
 catch{assert.ok(Date.now()<readyDeadline,'Owned local database is not ready');await new Promise(resolve=>setTimeout(resolve,150));}}
async function closed(port){return new Promise((resolve,reject)=>{
 const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(500);
 socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('timeout',()=>{socket.destroy();resolve(false);});
 socket.once('error',error=>error.code==='ECONNREFUSED'?resolve(true):reject(Error('Cannot verify local web quiescence')));
});}
assert.ok((await Promise.all([closed(Number(new URL(state.origin).port)),closed(state.upstreamPort)])).every(Boolean),'Stop the owned local web and upstream before applying checkout cancellation');
const config=localPrimaryDatabaseConfig(state,'owner');assert.equal(config.host,'127.0.0.1');
const prefix=[...getBootstrapPlan({includeListingContactMethod:true}),...await getLocalPrimaryExtraMigrations(),...await getLocalTelegramMigrations(),...await getLocalDeletionMigrations(),...await getLocalCheckoutEditMigrations(),...await getLocalApplicationContactMigrations(),...await getLocalBookingLifecycleMigrations(),...await getLocalWorkOwnerActionsMigrations(),...await getLocalResponseCheckoutMigrations()].map(({name,sha256})=>({name,sha256}));
assert.equal(prefix.length,38);const migrations=await getLocalCheckoutCancellationMigrations();
const after=[...prefix,...migrations.map(({name,sha256})=>({name,sha256}))];
const client=new pg.Client(config);await client.connect();let committing=false;
try{
 await client.query('begin');await client.query("set local lock_timeout='3s';set local statement_timeout='10s';select pg_advisory_xact_lock(187924,1)");
 const target=(await client.query("select current_database() as database,current_user as role,current_setting('server_version_num')::int as version")).rows[0];
 assert.ok(target.database===state.database&&target.role==='postgres'&&target.version>=180000&&target.version<190000);
 const role=(await client.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
 assert.ok(role&&Object.values(role).every(value=>value===false));
 const financeSql="select relname,relacl::text from pg_class where relnamespace='app'::regnamespace and relname like 'payment_%' and relname not in ('payment_checkout_cancellations','payment_checkout_cancellations_pkey') order by relname";
 const financeBefore=(await client.query(financeSql)).rows;
 const relationAclSql="select relname,relacl::text from pg_class where relnamespace='app'::regnamespace and relname not in ('payment_checkout_cancellations','payment_checkout_cancellations_pkey') order by relname";
 const relationAcls=(await client.query(relationAclSql)).rows;
 const journal=(await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 if(JSON.stringify(journal)===JSON.stringify(after)){await client.query('rollback');console.log(JSON.stringify({local:true,alreadyInstalled:true,migration:'0047',productionTouched:false}));}
 else{
  assert.deepEqual(journal,prefix,'Owned local schema differs; data preserved');
  for(const m of migrations){await client.query(withoutTransaction(m.source));await client.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[m.name,m.sha256]);}
  await client.query(withoutTransaction(await readFile(new URL('../database/permissions/checkout-cancellation.sql',import.meta.url),'utf8')));
  assert.deepEqual((await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,after);
  assert.deepEqual((await client.query(financeSql)).rows,financeBefore,'Financial grants must remain unchanged');
  assert.deepEqual((await client.query(relationAclSql)).rows,relationAcls,'Existing table grants must not change');
  const journalRights=(await client.query("select has_table_privilege('blizhniy_runtime','app.payment_checkout_cancellations','SELECT') as readable,has_column_privilege('blizhniy_runtime','app.payment_checkout_cancellations','payment_id','INSERT') as insert_id,has_table_privilege('blizhniy_runtime','app.payment_checkout_cancellations','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as broad_write,exists(select 1 from pg_attribute where attrelid='app.payment_checkout_cancellations'::regclass and attnum>0 and not attisdropped and attname<>'payment_id' and has_column_privilege('blizhniy_runtime','app.payment_checkout_cancellations',attname,'INSERT')) as metadata_insert")).rows[0];
  assert.deepEqual(journalRights,{readable:true,insert_id:true,broad_write:false,metadata_insert:false});
  committing=true;await client.query('commit');committing=false;
  console.log(JSON.stringify({local:true,installed:true,migration:'0047',oldWebStopped:true,rebuildAndRestartRequired:true,existingFinancialGrantsChanged:false,cancellationJournalSelectInsertOnly:true,refundMigrationsInstalled:false,productionTouched:false}));
 }
}catch(error){if(!committing)await client.query('rollback');throw error;}
finally{await client.end();}
