import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readActivatedOperatorSocket} from './hosted-operator-socket.mjs';
import {matchesHostedPostgresLocation} from './hosted-postgres-location.mjs';
import {verifyAdminPasskeyDatabase} from './admin-passkey-verifier-role.mjs';

const require=createRequire(import.meta.url);
const socketPath='/run/blizhniy-admin-passkey/operator.sock';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
async function main(env=process.env){
 if(process.argv.length!==2||process.platform!=='linux'||!process.getuid?.()||env.NODE_ENV!=='production'||
  env.BLIZHNIY_ADMIN_PASSKEYS!=='hosted-v1'||env.BLIZHNIY_AUTH_ORIGIN!==origin||
  env.BLIZHNIY_LOCAL_PRIMARY!==undefined||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||
  !matchesHostedPostgresLocation(env)||env.BLIZHNIY_DB_NAME!=='blizhniy_prod'||
  env.BLIZHNIY_DB_USER!=='blizhniy_passkey_verifier'||env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||
  env.NODE_TLS_REJECT_UNAUTHORIZED!==undefined||env.NODE_OPTIONS!==undefined||
  Object.keys(env).some(key=>key.startsWith('PG')))throw Error('Passkey verifier unavailable');
 const activation=await readActivatedOperatorSocket(env,socketPath);
 const {startAdminPasskeyOperator}=await import('./admin-passkey-operator.mjs');
 const {PostgresDatabase,readPostgresConfig}=require('../compiled/lib/postgres.js');
 const {AdminPasskeyEnrollment}=require('../compiled/lib/postgres-admin-passkey-enrollment.js');
 const {AdminPasskeyStore}=require('../compiled/lib/postgres-admin-passkey.js');
 const {createAdminUserAccessPasskey}=require('../compiled/lib/admin-user-access-passkey.js');
 const {createAdminArchivePasskey}=require('../compiled/lib/admin-archive-passkey.js');
 const {createAdminRefundPasskey}=require('../compiled/lib/admin-refund-passkey.js');
 const config=readPostgresConfig(env);
 const db=new PostgresDatabase(new (require('pg').Pool)({
  ...config,max:4,application_name:'blizhniy-passkey-verifier',options:'-c search_path=pg_catalog -c transaction_timeout=10000',
  statement_timeout:3000,lock_timeout:1000,idle_in_transaction_session_timeout:2500,
 }));
 let server,closing;
 const close=()=>closing??=db.close();
 const stop=()=>{void server?.close().catch(()=>{process.exitCode=1;});};
 const admit=()=>verifyAdminPasskeyDatabase(db,{database:config.database});
 try{
  await admit();
  const enrollment=new AdminPasskeyEnrollment(db,origin);
  const store=new AdminPasskeyStore(db,origin);
  const access=createAdminUserAccessPasskey(store),archive=createAdminArchivePasskey(store);
  const refund=createAdminRefundPasskey(store);
  server=await startAdminPasskeyOperator({enrollment,access,archive,refund},close,activation,admit);
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  console.log(JSON.stringify({event:'hosted_admin_passkey',status:'ready'}));
  if(await server.done!==0)throw Error('Passkey verifier unavailable');
 }finally{
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  if(server)await server.close();else await close();
 }
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}
 catch{
  console.error(JSON.stringify({event:'hosted_admin_passkey',status:'unavailable'}));
  process.exitCode=1;
 }
}
