// Explicit operator command, never called during startup or deployment.
import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';import pg from 'pg';
import {getBootstrapPlan} from './bootstrap-postgres.mjs';import {readPostgresConfig} from '../src/lib/postgres.ts';
export function getServicePublicationGrantPlan(){return{
 migrations:getBootstrapPlan({includeServicePublications:true}).map(({name,sha256})=>({name,sha256})),
 tables:[{name:'service_publications',insert:['author_id','kind','creation_key','form','city_id','profession_id'],update:['form','city_id','profession_id','revision','updated_at'],delete:false},
  {name:'service_publication_photos',insert:['publication_id','media_id','position'],update:[],delete:true},
  {name:'service_moderation',insert:['publication_id','revision'],update:['state','decided_at','decided_by','decision_note'],delete:false}],
};}
const invalid=()=>{throw Error('Service publication privileges unavailable or unexpected');};
async function inspect(client,table,complete){
 const columns=(await client.query(`select a.attname as name,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT') as read,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'INSERT') as insert,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'UPDATE') as update,
  has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'REFERENCES') as reference,
  (has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'SELECT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'INSERT WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'UPDATE WITH GRANT OPTION') or
   has_column_privilege('blizhniy_runtime',c.oid,a.attnum,'REFERENCES WITH GRANT OPTION')) as delegate
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app' and c.relname=$1 and a.attnum>0 and not a.attisdropped`,[table.name])).rows;
 if(!columns.length)invalid();
 for(const column of columns){
  if(column.reference||column.delegate||column.insert&&!table.insert.includes(column.name)||column.update&&!table.update.includes(column.name))invalid();
  if(complete&&(!column.read||column.insert!==table.insert.includes(column.name)||column.update!==table.update.includes(column.name)))invalid();
 }
 const caps=(await client.query(`select has_table_privilege('blizhniy_runtime',c.oid,'DELETE') as delete,
  has_table_privilege('blizhniy_runtime',c.oid,'TRUNCATE') as truncate,has_table_privilege('blizhniy_runtime',c.oid,'TRIGGER') as trigger,
  has_table_privilege('blizhniy_runtime',c.oid,'MAINTAIN') as maintain,
  (has_table_privilege('blizhniy_runtime',c.oid,'SELECT WITH GRANT OPTION') or has_table_privilege('blizhniy_runtime',c.oid,'DELETE WITH GRANT OPTION')) as delegate
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname=$1`,[table.name])).rows[0];
 if(!caps||caps.truncate||caps.trigger||caps.maintain||caps.delegate||caps.delete&&!table.delete||complete&&caps.delete!==table.delete)invalid();
}
export async function grantServicePublicationPermissions(client,confirmation){
 const {host,database}=client.connectionParameters;if(typeof confirmation!=='string'||confirmation!==`${host}:${database}`)throw Error('Missing or mismatched target confirmation');
 const plan=getServicePublicationGrantPlan();let began=false;
 try{
  await client.query('begin');began=true;await client.query("set local lock_timeout='3s';set local statement_timeout='10s'");await client.query('select pg_advisory_xact_lock(187924,1)');
  const target=(await client.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];
  if(target?.name!==database||target.version<180000||target.version>=190000)invalid();
  const history=(await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;if(JSON.stringify(history)!==JSON.stringify(plan.migrations))invalid();
  const role=(await client.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
  if(!role||Object.values(role).some(value=>value!==false))invalid();
  for(const table of plan.tables){
   await inspect(client,table,false);await client.query(`grant select on app.${table.name} to blizhniy_runtime`);
   if(table.insert.length)await client.query(`grant insert(${table.insert.join(',')}) on app.${table.name} to blizhniy_runtime`);
   if(table.update.length)await client.query(`grant update(${table.update.join(',')}) on app.${table.name} to blizhniy_runtime`);
   if(table.delete)await client.query(`grant delete on app.${table.name} to blizhniy_runtime`);await inspect(client,table,true);
  }
  await client.query('commit');began=false;return{tables:plan.tables.length};
 }catch(error){if(began)await client.query('rollback');throw error;}
}
async function main(){
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(getServicePublicationGrantPlan()));return;}
 if(args.length!==2||args[0]!=='--apply')throw Error('Usage: grant-service-publications.mjs --plan | --apply HOST:DATABASE');
 const config=readPostgresConfig(process.env),client=new pg.Client(config);try{await client.connect();console.log(JSON.stringify(await grantServicePublicationPermissions(client,args[1])));}finally{await client.end();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Service publication privilege operation failed');process.exitCode=1;});
