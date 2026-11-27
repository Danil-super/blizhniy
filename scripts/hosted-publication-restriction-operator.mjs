import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readActivatedOperatorSocket} from './hosted-operator-socket.mjs';
import {matchesHostedPostgresLocation} from './hosted-postgres-location.mjs';
import {publicationRestrictionRole,verifyPublicationRestrictionDatabase} from './publication-restriction-operator-role.mjs';

const require=createRequire(import.meta.url);
const status=value=>JSON.stringify({event:'hosted_publication_restriction',status:value});
const unavailable=()=>Error('Publication restriction operator unavailable');

async function main(env=process.env){
 const check=process.argv.length===3&&process.argv[2]==='--check';
 if((!check&&process.argv.length!==2)||process.platform!=='linux'||!process.getuid?.()||
  env.NODE_ENV!=='production'||env.BLIZHNIY_PUBLICATION_RESTRICTION_OPERATOR!=='hosted-v1'||
  env.BLIZHNIY_LOCAL_PRIMARY!==undefined||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||
  env.BLIZHNIY_DB_PLACEMENT!=='same-host'||!matchesHostedPostgresLocation(env)||
  env.BLIZHNIY_DB_NAME!=='blizhniy_prod'||env.BLIZHNIY_DB_USER!==publicationRestrictionRole||
  env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||env.NODE_TLS_REJECT_UNAUTHORIZED!==undefined||
  env.NODE_OPTIONS!==undefined||Object.keys(env).some(key=>key.startsWith('PG')))throw unavailable();
 const {hostedPublicationRestrictionSocket}=require('../compiled/lib/publication-restriction-operator-client.js');
 const activation=check?undefined:await readActivatedOperatorSocket(env,hostedPublicationRestrictionSocket);
 const {PostgresDatabase,readPostgresConfig}=require('../compiled/lib/postgres.js');
 const config=readPostgresConfig(env);
 const db=new PostgresDatabase(new (require('pg').Pool)({
  ...config,max:3,application_name:'blizhniy-publication-operator',
  options:'-c search_path=pg_catalog -c transaction_timeout=9000',
  statement_timeout:3000,lock_timeout:1000,idle_in_transaction_session_timeout:2500,query_timeout:6000,
 }));
 const preflight=()=>verifyPublicationRestrictionDatabase(db,{database:config.database});
 let server,closing;
 const close=()=>closing??=db.close();
 const stop=()=>{void server?.close().catch(()=>{process.exitCode=1;});};
 try{
  await preflight();
  if(check){console.log(status('checked'));return;}
  const {startLocalPublicationRestrictionOperator}=await import('./local-publication-restriction-operator.mjs');
  server=await startLocalPublicationRestrictionOperator(db,{activation,preflight,close});
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  console.log(status('ready'));
  if(await server.done!==0)throw unavailable();
 }finally{
  process.removeListener('SIGTERM',stop);
  process.removeListener('SIGINT',stop);
  if(server)await server.close();else await close();
 }
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}
 catch{
  console.error(status('unavailable'));
  process.exitCode=1;
 }
}
