// Explicit one-shot local command; no HTTP, scheduling, installation or automatic retries.
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import pg from 'pg';
import {readMediaRetentionEnabled} from '../src/lib/media-retention-config.ts';
import {readLocalPrimaryState} from './local-primary-config.mjs';
import {stateFile,stateDirectory} from './local-primary-fixture.mjs';
import {readLocalMediaRetentionConfig} from './local-primary-media-retention-config.mjs';
import {readLocalPrimaryRefundConfig} from './local-primary-refund-config.mjs';
import {verifyLocalPrimaryRefundTarget,assertLocalPrimaryRefundTrust} from './local-primary-refund-target.mjs';
import {verifyMediaRetentionDatabase} from './media-retention-role.mjs';
const root=realpathSync(fileURLToPath(new URL('..',import.meta.url))),unavailable=()=>Error('Local media cleanup unavailable');
export async function retireLocalPrimaryMedia({id,signal}={}){
 let db;
 try{
  if(typeof window!=='undefined'||process.env.NODE_ENV!=='test'||!readMediaRetentionEnabled()||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||
   Object.keys(process.env).some(key=>key.startsWith('PG'))||typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw unavailable();
  signal?.throwIfAborted();const state=readLocalPrimaryState(stateFile,root);
  const credentials=readLocalMediaRetentionConfig(join(stateDirectory,'media-retention.json'),state,readLocalPrimaryRefundConfig(join(stateDirectory,'refunds.json'),state));
  const environment={NODE_ENV:'test',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:String(state.dbPort),BLIZHNIY_DB_NAME:state.database,
   BLIZHNIY_DB_USER:'blizhniy_media_cleanup',BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(stateDirectory,'refund-db-ca.pem')};
  const certificate=await verifyLocalPrimaryRefundTarget(environment,{stateFile,project:root});signal?.throwIfAborted();
  const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('./local-primary-modules.cjs');
  const {PostgresDatabase,readPostgresConfig}=load('postgres'),config=readPostgresConfig(environment);assertLocalPrimaryRefundTrust(config,certificate);
  db=new PostgresDatabase(new pg.Pool({...config,max:2,application_name:'blizhniy-local-media-cleanup'}));
  await verifyMediaRetentionDatabase(db,{database:state.database});signal?.throwIfAborted();
  const files=await load('media-file-worker').createLocalMediaFileWorker(root,join(stateDirectory,'media'));
  return await new(load('media-retirement').LocalMediaRetirement)(db,files).retire(id,signal);
 }catch{throw unavailable();}
 finally{try{await db?.close();}catch{throw unavailable();}}
}
if(import.meta.main){
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  if(process.argv.length!==3)throw unavailable();
  await retireLocalPrimaryMedia({id:process.argv[2],signal:controller.signal});console.log(JSON.stringify({status:'completed',objects:1}));
 }catch{console.error('Local media cleanup unavailable; no automatic retry');process.exitCode=1;}
 finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
