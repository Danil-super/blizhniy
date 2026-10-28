// Explicit operator step only. Never called by Next, startup or a production deploy.
import assert from 'node:assert/strict';
import pg from 'pg';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {stateFile,localPrimaryDatabaseConfig,docker,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const args=process.argv.slice(2);
if(args.length!==1||!['--plan','--apply-local'].includes(args[0]))throw Error('Use --plan or explicitly approved --apply-local');
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const grants='grant select on app.listing_owner_removals to blizhniy_runtime;grant insert(listing_id,owner_id,removed_revision) on app.listing_owner_removals to blizhniy_runtime';
try{
 const extras=await getLocalPrimaryExtraMigrations(),migration=extras.at(-1);
 assert.equal(migration.name,'0029-listing-owner-removals.sql');
 const expected=[...getBootstrapPlan({includeListingContactMethod:true}).map(({name,sha256})=>({name,sha256})),...extras.map(({name,sha256})=>({name,sha256}))];
 const journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 assert.ok(journal.length===28||journal.length===29);assert.deepEqual(journal,expected.slice(0,journal.length));
 const role=(await owner.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
 assert.ok(role&&Object.values(role).every(value=>value===false));
 const target={host:'127.0.0.1',port:state.dbPort,database:state.database,container:state.containerName,origin:state.origin};
 if(args[0]==='--plan'){console.log(JSON.stringify({target,currentSchema:journal.length,migration:{name:migration.name,sha256:migration.sha256},grants,willApply:false,productionTouched:false}));}
 else{
  await owner.query('begin');
  try{
   await owner.query("set local lock_timeout='3s';set local statement_timeout='10s'");
   await owner.query('select pg_advisory_xact_lock(187924,29)');
   const locked=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   assert.deepEqual(locked,journal);
   if(journal.length===28){await owner.query(migration.source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);}
   await owner.query(grants);await owner.query('commit');
  }catch(error){await owner.query('rollback');throw error;}
  console.log(JSON.stringify({target,status:'applied',schema:29,productionTouched:false}));
 }
}finally{await owner.end();}
