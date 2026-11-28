import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {assertAdminPasskeyCatalog} from './admin-passkey-verifier-role.mjs';
import {matchesHostedPostgresLocation} from './hosted-postgres-location.mjs';

const require=createRequire(import.meta.url);
const databaseName='blizhniy_prod';
const unavailable=()=>Error('Administrator passkey issuer unavailable');
class InteractiveTerminalRequired extends Error {}

async function assertIssuer(tx,database){
 await tx.query("select pg_catalog.set_config('search_path','pg_catalog',true)");
 const {rows:[identity]}=await tx.query(`select current_database()=$1 and current_user=session_user
  and not pg_is_in_recovery() and current_setting('session_replication_role')='origin'
  and current_setting('default_transaction_read_only')='off'
  and current_setting('default_transaction_isolation')='read committed'
  and current_setting('server_version_num')::integer between 180000 and 189999
  and exists(select 1 from pg_database where datname=current_database() and datdba=current_user::regrole::oid)
  and exists(select 1 from pg_namespace where nspname='app_admin_passkey' and nspowner=current_user::regrole::oid)
  as allowed`,[database]);
 if(identity?.allowed!==true)throw unavailable();
 await assertAdminPasskeyCatalog(tx);
}

export function checkReviewedAdminPasskeyIssuer(db,database){
 return db.readTransaction(tx=>assertIssuer(tx,database),{timeoutMs:5000});
}

export function issueReviewedAdminPasskeyCode(db,{database,adminId,mode}){
 const {deletionId}=require('../compiled/lib/account-deletion-contract.js');
 const {productionAuthOrigin}=require('../compiled/lib/production-auth-config.js');
 const {issueAdminPasskeyApproval}=require('../compiled/lib/postgres-admin-passkey-enrollment.js');
 const id=deletionId(adminId);
 return db.transaction(async tx=>{
  await assertIssuer(tx,database);
  return issueAdminPasskeyApproval(tx,id,productionAuthOrigin,mode);
 });
}

async function main(argv,env){
 const [action]=argv,check=action==='--check';
 if(argv.length!==1||!['--check','--add','--replace'].includes(action))throw unavailable();
 if(!check&&(!process.stdin.isTTY||!process.stdout.isTTY||!process.stderr.isTTY))throw new InteractiveTerminalRequired();
 if(process.platform!=='linux'||env.NODE_ENV!=='production'||env.BLIZHNIY_DB_PLACEMENT!=='same-host'||
  !matchesHostedPostgresLocation(env)||env.BLIZHNIY_DB_NAME!==databaseName||
  env.BLIZHNIY_DB_SSL_MODE!=='verify-full'||env.BLIZHNIY_LOCAL_PRIMARY!==undefined||
  env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||env.NODE_OPTIONS!==undefined||
  env.NODE_TLS_REJECT_UNAUTHORIZED!==undefined)throw unavailable();
 const {PostgresDatabase,readPostgresConfig}=require('../compiled/lib/postgres.js');
 const db=new PostgresDatabase(new (require('pg').Pool)({
  ...readPostgresConfig(env),max:1,application_name:'blizhniy-passkey-issuer',
  options:'-c search_path=pg_catalog -c transaction_timeout=10000',
 }));
 let output;
 try{
  await checkReviewedAdminPasskeyIssuer(db,databaseName);
  if(check)output='Administrator passkey issuer ready.';
  else{
   const terminal=createInterface({input:process.stdin,output:process.stderr,terminal:true,historySize:0});
   try{
    const adminId=(await terminal.question('UUID проверенного администратора: ')).trim();
    output=await issueReviewedAdminPasskeyCode(db,{database:databaseName,adminId,mode:action.slice(2)});
   }finally{terminal.close();}
  }
 }finally{await db.close();}
 process.stdout.write(output+'\n');
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv.slice(2),process.env);}
 catch(error){
  process.stderr.write(error instanceof InteractiveTerminalRequired?
   'Use an interactive terminal for code issuance.\n':'Administrator passkey issuer unavailable.\n');
  process.exitCode=1;
 }
}
