// Explicit approved operator invocation only; no application startup or deploy hook.
import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';import pg from 'pg';
import {getBootstrapPlan} from './bootstrap-postgres.mjs';import {readPostgresConfig} from '../src/lib/postgres.ts';import {applyRestrictedTableGrants} from './operator-table-grants.mjs';
export function getInteractionGrantPlan(){return{
 migrations:getBootstrapPlan({includeInteractions:true}).map(({name,sha256})=>({name,sha256})),
 tables:[{name:'applications',insert:['applicant_id','work_publication_id','specialist_publication_id','creation_key','target_revision','specialist_revision','snapshot','message'],
  update:['message','snapshot','specialist_publication_id','target_revision','specialist_revision','status','revision','updated_at'],delete:false},
  {name:'booking_requests',insert:['listing_id','guest_id','creation_key','mode','start_date','end_date','guests','total','details_snapshot'],update:['status','decided_at','revision','updated_at'],delete:false},
  {name:'notifications',insert:['user_id','event_key','category','tone','title','body','action_href','booking_request_id'],update:['read_at','dismissed_at'],delete:false}],
};}
export function grantInteractionPermissions(client,confirmation){return applyRestrictedTableGrants(client,confirmation,getInteractionGrantPlan());}
async function main(){
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(getInteractionGrantPlan()));return;}
 if(args.length!==2||args[0]!=='--apply')throw Error('Usage: grant-interactions.mjs --plan | --apply HOST:DATABASE');
 const client=new pg.Client(readPostgresConfig(process.env));try{await client.connect();console.log(JSON.stringify(await grantInteractionPermissions(client,args[1])));}finally{await client.end();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Interaction privilege operation failed');process.exitCode=1;});
