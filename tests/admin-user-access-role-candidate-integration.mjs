// Opt-in review candidate only: separate tmpfs Docker, no installed stand or guard changes.
import {createServer,request as httpsRequest} from 'node:https';
import assert from 'node:assert/strict';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {randomBytes} from 'node:crypto';import {readFile,writeFile,copyFile,chmod,mkdtemp,cp,rm,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
const root=process.cwd(),candidate=await mkdtemp(join(tmpdir(),'blizhniy-user-access-review-'));await chmod(candidate,0o700);
await cp(join(root,'database'),join(candidate,'database'),{recursive:true});await cp(join(root,'scripts'),join(candidate,'scripts'),{recursive:true});
for(const name of ['admin-user-access-release.mjs','user-access-role.mjs','financial-catalog-privileges.mjs','refund-worker-schema.mjs','local-user-access-runtime.mjs','build-user-access-operator.mjs','local-user-access-request.mjs'])await copyFile(join(root,'docs/review/user-access61',name+'.candidate'),join(candidate,'scripts',name));
await copyFile(join(root,'docs/review/user-access61/admin-user-access-schema-v1.json.candidate'),join(candidate,'database/admin-user-access-schema-v1.json'));
await copyFile(join(root,'docs/review/user-access61/0061-admin-user-access.sql.candidate'),join(candidate,'database/candidates/0061-admin-user-access.sql'));
await cp(join(root,'src'),join(candidate,'src'),{recursive:true});await copyFile(join(root,'package.json'),join(candidate,'package.json'));
await symlink(join(root,'node_modules'),join(candidate,'node_modules'),'dir');
await copyFile(join(root,'docs/review/user-access61/postgres-admin-user-access.ts.candidate'),join(candidate,'src/lib/postgres-admin-user-access.ts'));


const req=createRequire(join(root,'package.json')),pg=req('pg'),load=req('./scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {getRefundWorkerRolePlan,verifyRefundWorkerDatabase}=await import(pathToFileURL(join(candidate,'scripts/refund-worker-role.mjs'))),{getRefundOperatorRolePlan,verifyRefundOperatorDatabase}=await import(pathToFileURL(join(candidate,'scripts/refund-operator-role.mjs')));
const {getUserAccessRolePlan,verifyUserAccessDatabase}=await import(pathToFileURL(join(candidate,'scripts/user-access-role.mjs'))),{readRefundSchema,assertRefundSchema}=await import(pathToFileURL(join(candidate,'scripts/refund-worker-schema.mjs')));
const {getMediaRetentionRolePlan,verifyMediaRetentionDatabase}=await import(pathToFileURL(join(candidate,'scripts/media-retention-role.mjs')));
const run=promisify(execFile),password=randomBytes(32).toString('hex'),rolePassword=randomBytes(32).toString('hex'),name='blizhniy-primary-local-'+randomBytes(6).toString('hex'),label='blizhniy.admin-schema-proof';
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1048576})).stdout.trim();
let container,owner;const pools=[];const {PostgresDatabase}=load('postgres');
try{
 container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--label','blizhniy.primary-local='+root,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod','postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873']);
 assert.match(container,/^[a-f0-9]{64}$/);const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels[label],name);const binding=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
 for(const deadline=Date.now()+20000;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_prod']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
 const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_prod',user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};owner=new pg.Client(config);await owner.connect();
 await owner.query('create schema blizhniy_meta;revoke all on schema blizhniy_meta from public;create table blizhniy_meta.migrations(name text primary key,sha256 text not null)');
 const mainPlan=getRefundWorkerRolePlan('blizhniy_prod',{schema:60,localPrimary:true});
 for(const row of mainPlan.journal){const folder=/^(0058|0060)-/.test(row.name)?'candidates':'migrations';await owner.query(await readFile(join(candidate,'database',folder,row.name),'utf8'));await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[row.name,row.sha256]);}
 await owner.query('create role blizhniy_runtime nologin');
 await owner.query(await readFile(join(candidate,'database/permissions/telegram-phone.sql'),'utf8'));
 await owner.query(await readFile(join(candidate,'database/local-primary-payment.sql'),'utf8'));await owner.query(await readFile(join(candidate,'database/local-primary-refunds.sql'),'utf8'));
 await owner.query('begin read only');const before=await readRefundSchema(owner);const expectedApp=JSON.parse(await readFile(join(candidate,'database/refund-schema-local-primary-0060.json'),'utf8'));console.log(JSON.stringify({appDifference:Object.fromEntries(Object.keys({...before,...expectedApp}).filter(k=>JSON.stringify(before[k])!==JSON.stringify(expectedApp[k])).map(k=>[k,{actual:before[k],expected:expectedApp[k]}]))}));await assertRefundSchema(owner,60,{localPrimary:true});await owner.query('rollback');
 const plan=getUserAccessRolePlan('blizhniy_prod'),migration=await readFile(join(candidate,'database/candidates/0061-admin-user-access.sql'),'utf8');await owner.query(migration);await owner.query('insert into app_admin.migrations values($1,$2)',[plan.journal[0].name,plan.journal[0].sha256]);
 await owner.query('begin read only');assert.deepEqual(await readRefundSchema(owner),before);const adminSchema=await readRefundSchema(owner,{namespace:'app_admin'});await owner.query('rollback');
 assert.deepEqual(adminSchema,JSON.parse(await readFile(join(candidate,'database/admin-user-access-schema-v1.json'),'utf8')));
 await owner.query('revoke all on database blizhniy_prod from public');
 const checks=[];
 for(const [rolePlan,verify,options] of [[mainPlan,verifyRefundWorkerDatabase,{database:'blizhniy_prod',merchant:{shopId:'local-fixture-shop',isTest:true},localPrimary:true}],
  [getRefundOperatorRolePlan('blizhniy_prod',{schema:60,localPrimary:true}),verifyRefundOperatorDatabase,{database:'blizhniy_prod',merchant:{shopId:'local-fixture-shop',isTest:true},localPrimary:true}],
  [getMediaRetentionRolePlan('blizhniy_prod',{schema:60}),verifyMediaRetentionDatabase,{database:'blizhniy_prod'}],
  [plan,verifyUserAccessDatabase,{database:'blizhniy_prod'}]]){
  await owner.query(rolePlan.createRole);for(const grant of rolePlan.grants)await owner.query(grant);await owner.query('alter role '+rolePlan.role+' login password '+pg.escapeLiteral(rolePassword));
  const db=new PostgresDatabase(new pg.Pool({...config,user:rolePlan.role,password:rolePassword,max:2}));pools.push(db);await verify(db,options);checks.push(rolePlan.role);console.log(JSON.stringify({admitted:rolePlan.role}));
 }

 const userDb=pools.at(-1),signature='app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
 const badCases=[
  ['public-function','grant execute on function '+signature+' to public','revoke all on function '+signature+' from public'],
  ['other-function','grant execute on function '+signature+' to blizhniy_runtime','revoke all on function '+signature+' from blizhniy_runtime'],
  ['public-namespace','grant usage on schema app_admin to public','revoke all on schema app_admin from public'],
  ['other-ledger','grant select on app_admin.user_changes to blizhniy_runtime','revoke all on app_admin.user_changes from blizhniy_runtime'],
  ['extra-user-read','grant select on app.users to blizhniy_user_operator','revoke all on app.users from blizhniy_user_operator'],
  ['extra-role-write','grant update(role) on app.users to blizhniy_user_operator','revoke update(role) on app.users from blizhniy_user_operator'],
  ['extra-function','grant execute on function app.guard_auth_version() to blizhniy_user_operator','revoke all on function app.guard_auth_version() from blizhniy_user_operator'],
  ['schema-write','grant create on schema app_admin to blizhniy_user_operator','revoke create on schema app_admin from blizhniy_user_operator'],
  ['system-file-function','grant execute on function pg_catalog.pg_read_file(text) to blizhniy_user_operator','revoke all on function pg_catalog.pg_read_file(text) from blizhniy_user_operator'],
  ['system-auth-table','grant select on pg_catalog.pg_authid to blizhniy_user_operator','revoke all on pg_catalog.pg_authid from blizhniy_user_operator'],
  ['temp','grant temporary on database blizhniy_prod to blizhniy_user_operator','revoke temporary on database blizhniy_prod from blizhniy_user_operator'],
  ['inherit','alter role blizhniy_user_operator inherit','alter role blizhniy_user_operator noinherit'],
  ['connection-limit','alter role blizhniy_user_operator connection limit 5','alter role blizhniy_user_operator connection limit 4'],
  ['incoming-membership','grant blizhniy_user_operator to blizhniy_refund_worker','revoke blizhniy_user_operator from blizhniy_refund_worker'],
  ['future-admin-object','create table app_admin.future_object(id int)','drop table app_admin.future_object'],
  ['future-main-journal',"insert into blizhniy_meta.migrations values('0062-unreviewed.sql',repeat('0',64))","delete from blizhniy_meta.migrations where name='0062-unreviewed.sql'"],
  ['missing-capability','revoke all on function '+signature+' from blizhniy_user_operator','grant execute on function '+signature+' to blizhniy_user_operator'],
 ];
 for(const [caseName,mutation,restore] of badCases){
  await owner.query(mutation);try{await assert.rejects(verifyUserAccessDatabase(userDb,{database:'blizhniy_prod'}));console.log(JSON.stringify({rejected:caseName}));}
  finally{await owner.query(restore);}
 }
 await verifyUserAccessDatabase(userDb,{database:'blizhniy_prod'});
 await verifyRefundWorkerDatabase(pools[0],{database:'blizhniy_prod',merchant:{shopId:'local-fixture-shop',isTest:true},localPrimary:true});
 await verifyRefundOperatorDatabase(pools[1],{database:'blizhniy_prod',merchant:{shopId:'local-fixture-shop',isTest:true},localPrimary:true});
 await verifyMediaRetentionDatabase(pools[2],{database:'blizhniy_prod'});


 const {buildUserAccessOperator}=await import(pathToFileURL(join(candidate,'scripts/build-user-access-operator.mjs'))),packagePath=join(candidate,'operator-package');
 const manifest=buildUserAccessOperator(packagePath);assert.ok(manifest.sources.length>3);await symlink(join(root,'node_modules'),join(packagePath,'node_modules'),'dir');
 const cert=join(candidate,'db-ca.pem'),key=join(candidate,'db-key.pem');
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1,DNS:xn----9sbphbgks4a4a.xn--p1ai','-addext','basicConstraints=critical,CA:TRUE','-keyout',key,'-out',cert],{timeout:10000,maxBuffer:1048576});
 await chmod(key,0o600);await chmod(cert,0o600);
 for(const [source,target]of[[cert,'/var/lib/postgresql/refund-server.crt'],[key,'/var/lib/postgresql/refund-server.key']]){
  const bytes=await readFile(source);
  await new Promise((resolve,reject)=>{
   const child=spawn('docker',['--host','unix:///var/run/docker.sock','exec','--interactive','--user','root',container,'sh','-c','umask 077; cat > '+target],{env:{PATH:process.env.PATH,LANG:'C.UTF-8'},stdio:['pipe','ignore','ignore']});let finished=false;
   const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child.kill();reject(Error('Temporary TLS copy failed'));}else resolve();};
   const timer=setTimeout(()=>finish(Error()),10000);child.on('error',finish);child.stdin.on('error',finish);child.on('close',code=>finish(code===0?null:Error()));child.stdin.end(bytes);
  });
 }

 await docker(['exec','--user','root',container,'chown','postgres:postgres','/var/lib/postgresql/refund-server.crt','/var/lib/postgresql/refund-server.key']);
 await docker(['exec','--user','root',container,'chmod','600','/var/lib/postgresql/refund-server.key']);
 for(const [key,value]of[['ssl','on'],['ssl_cert_file','/var/lib/postgresql/refund-server.crt'],['ssl_key_file','/var/lib/postgresql/refund-server.key']])await owner.query('alter system set '+key+'='+pg.escapeLiteral(value));
 await owner.query('select pg_reload_conf()');const ca=await readFile(cert,'utf8');
 for(const deadline=Date.now()+10000;;){const probe=new pg.Client({...config,ssl:{ca,rejectUnauthorized:true}});try{await probe.connect();await probe.end();break;}catch{await probe.end();assert.ok(Date.now()<deadline,'TLS did not become available');await new Promise(resolve=>setTimeout(resolve,100));}}
 const state={version:1,project:root,origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:container,containerName:name,dbPort:Number(binding.HostPort),database:'blizhniy_prod',runtimePassword:randomBytes(32).toString('hex'),ownerPassword:password,rateSecret:randomBytes(32).toString('hex')};
 const stateFile=join(candidate,'state.json');await writeFile(stateFile,JSON.stringify(state),{mode:0o600});
 const environment={NODE_ENV:'test',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:String(state.dbPort),BLIZHNIY_DB_NAME:state.database,BLIZHNIY_DB_USER:'blizhniy_user_operator',BLIZHNIY_DB_PASSWORD:rolePassword,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:cert};
 const {createLocalUserAccessRuntime}=await import(pathToFileURL(join(packagePath,'scripts/local-user-access-runtime.mjs'))),{startLocalUserAccessOperator}=await import(pathToFileURL(join(packagePath,'scripts/local-user-access-operator.mjs')));
 const id=randomBytes(16).toString('hex'),targetId=randomBytes(16).toString('hex'),uuid=value=>value.slice(0,8)+'-'+value.slice(8,12)+'-'+value.slice(12,16)+'-'+value.slice(16,20)+'-'+value.slice(20),actor=uuid(id),target=uuid(targetId),token=randomBytes(32).toString('hex');
 for(const [userId,role]of[[actor,'admin'],[target,'user']])await owner.query("insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())",[userId,userId+'@example.invalid','scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128),role]);
 await owner.query("insert into app.sessions(token_hash,user_id,auth_version,expires_at) values($1,$2,0,clock_timestamp()+interval '1 hour')",[req('node:crypto').createHash('sha256').update(token).digest('hex'),actor]);
 const runtime=await createLocalUserAccessRuntime(environment,{stateFile,project:root}),server=await startLocalUserAccessOperator(runtime);
 try{
  const {callLocalUserAccessOperator}=load('local-user-access-operator-client');
  const stopped=new AbortController();stopped.abort();await assert.rejects(runtime.execute(token,{action:'inspect',expectedAdminId:actor,targetId:target},stopped.signal),{message:'Local user operator unavailable'});
  assert.equal((await owner.query('select count(*)::int as n from app_admin.user_changes')).rows[0].n,0);
  const input={id:uuid(randomBytes(16).toString('hex')),targetId:target,expectedVersion:'0',role:'user',isBlocked:true,reason:'Проверка compiled TLS'};
  const result=await callLocalUserAccessOperator(server.socketPath,token,{action:'change',expectedAdminId:actor,input});assert.equal(result.user.isBlocked,true);assert.equal(result.user.authVersion,'1');
  const recovered=await callLocalUserAccessOperator(server.socketPath,token,{action:'recover',expectedAdminId:actor,targetId:target,id:input.id});assert.deepEqual(recovered.receipt,result.receipt);
  const {serveLocalUserAccessRequest:serve}=await import(pathToFileURL(join(candidate,'scripts/local-user-access-request.mjs')));
  const canonical='https://xn----9sbphbgks4a4a.xn--p1ai',httpHandler=load('admin-user-access-http').createAdminUserAccessHandler({origin:canonical},()=>({limiter:{allowProduction:async()=>true},execute:(...args)=>callLocalUserAccessOperator(server.socketPath,...args)}),()=>{});
  const ingress=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>serve(req,res,new Headers(req.headers),httpHandler,canonical+req.url).catch(()=>res.destroy()));
  try{
   await new Promise(resolve=>ingress.listen(0,'127.0.0.1',resolve));
   const reply=await new Promise((resolve,reject)=>{
    const outgoing=httpsRequest({host:'127.0.0.1',port:ingress.address().port,ca,rejectUnauthorized:true,path:'/api/admin/user-access',method:'POST',headers:{host:new URL(canonical).host,origin:canonical,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});
    outgoing.on('error',reject);outgoing.end(JSON.stringify({action:'recover',expectedAdminId:actor,targetId:target,id:input.id}));
   });assert.equal(reply.status,200);assert.deepEqual(reply.body.receipt,result.receipt);
  }finally{ingress.closeAllConnections();await new Promise(resolve=>ingress.close(resolve));}
  console.log(JSON.stringify({httpsIngress:true,compiledTlsRuntime:true,sourceModules:manifest.sources.length,privateIpc:true,oneReceipt:recovered.history.length===1}));
 }finally{await server.close();}
 assert.equal((await owner.query('select count(*)::int as n from blizhniy_meta.migrations')).rows[0].n,59);
console.log(JSON.stringify({passed:true,admitted:checks.length,appJournal:59,adminJournal:1}));
}finally{
 for(const db of pools)await db.close();await owner?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels[label],name);await docker(['rm','--force',container]);}await rm(candidate,{recursive:true,force:true});
}
