// Explicit operator command, never called during startup or deployment.
import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';import pg from 'pg';
import {getBootstrapPlan} from './bootstrap-postgres.mjs';import {readPostgresConfig} from '../src/lib/postgres.ts';
import {applyRestrictedTableGrants} from './operator-table-grants.mjs';
export function getServicePublicationGrantPlan(){return{
 migrations:getBootstrapPlan({includeServicePublications:true}).map(({name,sha256})=>({name,sha256})),
 tables:[{name:'service_publications',insert:['author_id','kind','creation_key','form','city_id','profession_id'],update:['form','city_id','profession_id','revision','updated_at'],delete:false},
  {name:'service_publication_photos',insert:['publication_id','media_id','position'],update:[],delete:true},
  {name:'service_moderation',insert:['publication_id','revision'],update:['state','decided_at','decided_by','decision_note'],delete:false}],
};}
export function grantServicePublicationPermissions(client,confirmation){return applyRestrictedTableGrants(client,confirmation,getServicePublicationGrantPlan());}
async function main(){
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--plan'){console.log(JSON.stringify(getServicePublicationGrantPlan()));return;}
 if(args.length!==2||args[0]!=='--apply')throw Error('Usage: grant-service-publications.mjs --plan | --apply HOST:DATABASE');
 const config=readPostgresConfig(process.env),client=new pg.Client(config);try{await client.connect();console.log(JSON.stringify(await grantServicePublicationPermissions(client,args[1])));}finally{await client.end();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Service publication privilege operation failed');process.exitCode=1;});
