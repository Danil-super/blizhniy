// Explicit approved operator only. Never invoked by a request, startup or deployment.
import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';import pg from 'pg';
import {getBootstrapPlan} from './bootstrap-postgres.mjs';import {readPostgresConfig} from '../src/lib/postgres.ts';
export const getBookingReadGrantPlan=()=>({migrations:getBootstrapPlan({includeInteractions:true}).map(({name,sha256})=>({name,sha256})),table:'app.listings',role:'blizhniy_runtime',columns:['is_paid','published_at','expires_at']});
const denied=()=>{throw Error('Booking read privileges unavailable or unexpected');};
async function inspect(client){
 const columns=(await client.query(`select a.attname as name,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,'SELECT') as read,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,'INSERT') as insert,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,'UPDATE') as update,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,'REFERENCES') as reference,
  has_column_privilege('blizhniy_runtime',a.attrelid,a.attnum,'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION, REFERENCES WITH GRANT OPTION') as delegate
  from pg_attribute a where a.attrelid='app.listings'::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`)).rows;
 if(!columns.length||columns.some(row=>row.reference||row.delegate))denied();
 for(const name of getBookingReadGrantPlan().columns){const row=columns.find(row=>row.name===name);if(!row||row.insert||row.update)denied();}
 const caps=(await client.query("select has_table_privilege('blizhniy_runtime','app.listings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') as broad")).rows[0];
 if(!caps||caps.broad!==false)denied();return columns;
}
export async function grantBookingPublicationRead(client,confirmation){
 const {host,database}=client.connectionParameters;if(typeof confirmation!=='string'||confirmation!==`${host}:${database}`)throw Error('Missing or mismatched target confirmation');
 const plan=getBookingReadGrantPlan();let began=false;
 try{
  await client.query('begin');began=true;await client.query("set local lock_timeout='3s';set local statement_timeout='10s'");await client.query('select pg_advisory_xact_lock(187924,1)');
  const target=(await client.query("select current_database() as name,current_setting('server_version_num')::integer as version")).rows[0];if(target?.name!==database||target.version<180000||target.version>=190000)denied();
  const history=(await client.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;if(JSON.stringify(history)!==JSON.stringify(plan.migrations))denied();
  const role=(await client.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];if(!role||Object.values(role).some(value=>value!==false))denied();
  const before=await inspect(client);await client.query('grant select(is_paid,published_at,expires_at) on app.listings to blizhniy_runtime');const after=await inspect(client);
  const expected=before.map(row=>({...row,read:row.read||plan.columns.includes(row.name)}));if(JSON.stringify(after)!==JSON.stringify(expected))denied();
  await client.query('commit');began=false;return{columns:3};
 }catch(error){if(began)await client.query('rollback');throw error;}
}
async function main(){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(getBookingReadGrantPlan()));return;}
 if(args.length!==2||args[0]!=='--apply')throw Error('Usage: grant-booking-read.mjs --plan | --apply HOST:DATABASE');
 const client=new pg.Client(readPostgresConfig(process.env));try{await client.connect();console.log(JSON.stringify(await grantBookingPublicationRead(client,args[1])));}finally{await client.end();}}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Booking read privilege operation failed');process.exitCode=1;});
