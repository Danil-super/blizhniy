import assert from 'node:assert/strict';
import {testOwnedRefundComposition} from './local-primary-refund-composition-cases.mjs';
import {testLocalPrimaryRefundSchema} from './local-primary-refund-schema-cases.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {rootCertificates} from 'node:tls';
import pg from 'pg';
import {localPrimaryImage,validateLocalPrimaryContainerDefinition,validateLocalPrimaryContainer} from '../scripts/local-primary-config.mjs';
import {getRefundOperatorRolePlan} from '../scripts/refund-operator-role.mjs';

/** A new synthetic owned container only; never the persistent manual fixture or production. */
export async function testOwnedLocalPrimaryRefundRuntime(suite,{artifact,load}){
 const run=promisify(execFile),project=process.cwd(),owned=await mkdtemp(join(tmpdir(),'blizhniy-owned-refund-runtime-'));
 const name='blizhniy-primary-local-'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),rolePassword=randomBytes(32).toString('hex');
 const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
 let container,admin,runtime;const ca=join(owned,'server.crt'),key=join(owned,'server.key'),stateFile=join(owned,'state.json');
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.primary-local='+project,'--label','blizhniy.refund-owned-proof='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod',localPrimaryImage]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0],port=Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort);
  const state={version:1,project,origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:container,containerName:name,dbPort:port,database:'blizhniy_prod',runtimePassword:randomBytes(32).toString('hex'),ownerPassword:password,rateSecret:randomBytes(32).toString('hex')};
  validateLocalPrimaryContainerDefinition(metadata,state);validateLocalPrimaryContainer(metadata,state);assert.equal(metadata.Config.Labels['blizhniy.refund-owned-proof'],name);
  await writeFile(stateFile,JSON.stringify(state),{mode:0o600});const deadline=Date.now()+20000;
  for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_prod']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({host:'127.0.0.1',port,database:'blizhniy_prod',user:'postgres',password,ssl:false,max:2,connectionTimeoutMillis:3000});
  const plan=getRefundOperatorRolePlan('blizhniy_prod');for(const entry of plan.journal)await admin.query(await readFile(new URL('../database/migrations/'+entry.name,import.meta.url),'utf8'));
  await admin.query('create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls');
  await admin.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
  await admin.query("revoke all on database blizhniy_prod from public;create schema blizhniy_meta;revoke all on schema blizhniy_meta from public;create table blizhniy_meta.migrations(name text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'));revoke all on blizhniy_meta.migrations from public");
  for(const entry of plan.journal)await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[entry.name,entry.sha256]);
  await testLocalPrimaryRefundSchema(suite,{admin,plan,state});
  await admin.query(plan.createRole);await admin.query('alter role blizhniy_refund_operator login password '+pg.escapeLiteral(rolePassword));for(const sql of plan.grants)await admin.query(sql);
  await run('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=owned-local-refund-fixture','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',key,'-out',ca],{timeout:10000});await chmod(ca,0o644);
  for(const [source,base] of [[ca,'server.crt'],[key,'server.key']]){
   await docker(['cp',source,container+':/tmp/refund-'+base]);await docker(['exec','--user','0',container,'cp','/tmp/refund-'+base,'/var/lib/postgresql/refund-'+base]);
  }
  await docker(['exec','--user','0',container,'chown','postgres:postgres','/var/lib/postgresql/refund-server.key']);await docker(['exec','--user','0',container,'chmod','600','/var/lib/postgresql/refund-server.key']);
  await admin.query("alter system set ssl_cert_file='/var/lib/postgresql/refund-server.crt'");await admin.query("alter system set ssl_key_file='/var/lib/postgresql/refund-server.key'");await admin.query("alter system set ssl='on'");await admin.query('select pg_reload_conf()');
  const sslDeadline=Date.now()+5000;while((await admin.query("select current_setting('ssl') as ssl")).rows[0].ssl!=='on'){assert.ok(Date.now()<sslDeadline);await new Promise(r=>setTimeout(r,20));}
  const actor=randomUUID(),token=randomBytes(32).toString('hex');await admin.query("insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,'admin',clock_timestamp())",[actor,actor+'@owned.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),actor]);
  const environment={NODE_ENV:'production',BLIZHNIY_REFUND_OPERATOR:'local-test',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:String(port),BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_refund_operator',BLIZHNIY_DB_PASSWORD:rolePassword,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_PAYMENT_SHOP_ID:'owned-local-fixture',BLIZHNIY_PAYMENT_SECRET_KEY:'test_synthetic_only'};
  const modules=await import(pathToFileURL(join(artifact,'scripts/local-refund-operator-runtime.mjs')).href);
  await suite.test('separate owned entry admits exact local-primary identity and TLS while the default factory still refuses the prod-named database',async()=>{
   let reads=0;const fetcher=async(url,init)=>{reads++;assert.equal(init.method,'GET');assert.equal(url,'https://api.yookassa.ru/v3/me');return Response.json({account_id:environment.BLIZHNIY_PAYMENT_SHOP_ID,test:true,status:'enabled',fiscalization:{enabled:false}});};
   await assert.rejects(modules.createLocalRefundOperatorRuntime(environment,{fetcher}),{message:'Local refund operator unavailable'});assert.equal(reads,0);
   runtime=await modules.createLocalPrimaryRefundOperatorRuntime(environment,{stateFile,project,fetcher});assert.equal(reads,0);
   assert.deepEqual(await runtime.listForAdmin(token,actor,null),{items:[],nextAfter:null});assert.equal(reads,0);await runtime.preflight();assert.equal(reads,1);
   const sessions=(await admin.query("select s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where a.application_name='blizhniy-local-refund-operator'")).rows;assert.ok(sessions.length>0);assert.ok(sessions.every(row=>row.ssl));await runtime.close();runtime=undefined;
  });
  await suite.test('owned entry refuses wrong project, port and a changed Pool CA before creating any connection or provider request',async()=>{
   let pools=0,http=0;const options={stateFile,project,fetcher:async()=>{http++;throw Error('Unexpected provider I/O');},loadModules:()=>({readPostgresConfig:()=>({database:'blizhniy_prod',ssl:{ca:rootCertificates[0],rejectUnauthorized:true}}),Pool:class{constructor(){pools++;}}})};
   for(const change of [{project:'/foreign'},{stateFile:join(owned,'absent')}])await assert.rejects(modules.createLocalPrimaryRefundOperatorRuntime(environment,{...options,...change}),{message:'Local refund operator unavailable'});
   await assert.rejects(modules.createLocalPrimaryRefundOperatorRuntime({...environment,BLIZHNIY_DB_PORT:String(port+1)},options),{message:'Local refund operator unavailable'});
   await assert.rejects(modules.createLocalPrimaryRefundOperatorRuntime(environment,options),{message:'Local refund operator unavailable'});assert.equal(pools,0);assert.equal(http,0);
  });
  await testOwnedRefundComposition(suite,{admin,owned,environment,stateFile,project,load,artifact,actor,token});
 }finally{
  try{await runtime?.close();}finally{try{await admin?.end();}finally{
   if(container){const ownedMetadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(ownedMetadata.Id,container);assert.equal(ownedMetadata.Config.Labels['blizhniy.refund-owned-proof'],name);await docker(['rm','--force',container]);}
   await rm(owned,{recursive:true,force:true});
  }}
 }
}
