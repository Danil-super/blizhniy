// Explicit synthetic acceptance on the owned local stand; keeps immutable audit history.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,chmod,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {stateDirectory,stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
const root=process.cwd(),state=readLocalPrimaryState(stateFile,root),load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const ca=await readFile(join(stateDirectory,'tls-cert.pem')),directory=await mkdtemp(join(stateDirectory,'user-access61-acceptance-'));await chmod(directory,0o700);
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:3000});
const results=[],actors=[],endpoint='/api/admin/user-access',build=(await readFile('.next/BUILD_ID','utf8')).trim();let stage='starting';
function client(){const cookies=new Map();return async(path,body={},method='POST',expected=200)=>new Promise((resolve,reject)=>{
 const bytes=method==='GET'?null:Buffer.from(JSON.stringify(body));
 const req=request(new URL(path,state.origin),{method,ca,rejectUnauthorized:true,signal:AbortSignal.timeout(25000),headers:{origin:state.origin,'sec-fetch-site':'same-origin','x-blizhniy-request':'1',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{
  for(const cookie of res.headers['set-cookie']??[]){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
  let size=0;const parts=[];res.on('data',chunk=>{size+=chunk.length;if(size>2097152)req.destroy(Error('Response size bound'));else parts.push(chunk);});res.on('error',reject);
  res.on('end',()=>{try{assert.equal(res.statusCode,expected,path);const text=Buffer.concat(parts).toString();resolve({data:(res.headers['content-type']??'').includes('application/json')?JSON.parse(text):text,headers:res.headers});}catch(error){reject(error);}});
 });req.on('error',reject);req.end(bytes);
});}
async function waitReady(){for(const deadline=Date.now()+45000;;){try{await client()('/api/ready',{},'GET');return;}catch{assert.ok(Date.now()<deadline,'Local readiness timeout');await new Promise(resolve=>setTimeout(resolve,300));}}}
const check=(name,condition=true)=>{assert.ok(condition,name);results.push(name);};
async function login(actor,api){const r=await api('/api/account/login',{email:actor.email,password:actor.password,captchaToken:''});assert.equal(r.data.user.id,actor.id);}
async function account(role){const actor={role,email:'access-'+randomUUID()+'@local.invalid',password:'SyntheticAccess-'+randomUUID()+'!'};
 actor.id=(await db.query('insert into app.users(email,password_hash,role,email_verified_at) values($1,$2,$3,clock_timestamp()) returning id',[actor.email,await load('identity').hashPassword(actor.password),role])).rows[0].id;
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[actor.id,JSON.stringify(load('postgres-profile').parseProductionProfile({name:'Синтетическая Приёмка',city:'Краснодар'}))]);actors.push(actor);return actor;}
let admin,first,second,renewed;
try{
 await waitReady();await db.connect();const actor=await account('admin'),target=await account('user');
 admin=client();first=client();second=client();renewed=client();await login(actor,admin);await login(target,first);await login(target,second);
 const inspect={action:'inspect',expectedAdminId:actor.id,targetId:target.id},before=await admin(endpoint,inspect);check('inspect-current-user',before.data.user.authVersion==='0');check('private-no-store',before.headers['cache-control']==='no-store');
 await client()(endpoint,inspect,'POST',401);await first(endpoint,inspect,'POST',403);check('anonymous-and-ordinary-denied');
 const blocked={action:'change',expectedAdminId:actor.id,input:{id:randomUUID(),targetId:target.id,expectedVersion:'0',role:'user',isBlocked:true,reason:'Локальная проверка блокировки'}};
 const result=(await admin(endpoint,blocked)).data;check('block-one-version',result.user.isBlocked&&result.user.authVersion==='1');
 const replay=(await admin(endpoint,blocked)).data;assert.deepEqual(replay.receipt,result.receipt);check('one-receipt-on-replay',replay.history.length===1);
 const recover={action:'recover',expectedAdminId:actor.id,targetId:target.id,id:blocked.input.id};assert.deepEqual((await admin(endpoint,recover)).data.receipt,result.receipt);check('recover-original-receipt');
 for(const api of [first,second])await api('/api/account/profile',{expectedOwnerId:target.id},'POST',401);check('both-target-sessions-revoked');
 const stale=await admin(endpoint,{...blocked,input:{...blocked.input,id:randomUUID(),isBlocked:false}},'POST',409);check('stale-version-denied',stale.data.error.code==='STALE_ACCESS');
 const self=await admin(endpoint,{...blocked,input:{...blocked.input,id:randomUUID(),targetId:actor.id}},'POST',409);check('self-change-denied',self.data.error.code==='SELF_CHANGE');
 const conflict=await admin(endpoint,{...blocked,input:{...blocked.input,reason:'Иная причина'}},'POST',409);check('operation-payload-bound',conflict.data.error.code==='OPERATION_CONFLICT');
 const change=async(version,role,isBlocked)=> (await admin(endpoint,{action:'change',expectedAdminId:actor.id,input:{id:randomUUID(),targetId:target.id,expectedVersion:version,role,isBlocked,reason:'Локальная проверка изменения доступа'}})).data;
 const unblocked=await change('1','user',false);check('unblock',unblocked.user.authVersion==='2'&&!unblocked.user.isBlocked);await login(target,renewed);
 const promoted=await change('2','admin',false);check('promote',promoted.user.authVersion==='3'&&promoted.user.role==='admin');await renewed('/api/account/profile',{expectedOwnerId:target.id},'POST',401);await login(target,renewed);
 await renewed(endpoint,{action:'inspect',expectedAdminId:target.id,targetId:actor.id});check('fresh-promoted-session-admitted');
 const demoted=await change('3','user',false);check('demote',demoted.user.authVersion==='4'&&demoted.user.role==='user');await renewed(endpoint,{action:'inspect',expectedAdminId:target.id,targetId:actor.id},'POST',403);check('demoted-session-denied');
 const old=(await admin(endpoint,blocked)).data;assert.deepEqual(old.receipt,result.receipt);check('old-replay-does-not-reapply',old.user.authVersion==='4'&&!old.user.isBlocked&&old.user.role==='user');
 const html=(await admin('/admin/users',{},'GET')).data;check('server-view-opt-in',html.includes('accessManagement\\\":true'));
 const rows=await db.query('select id::text,actor_id::text,target_id::text,resulting_version::text from app_admin.user_changes where target_id=$1 order by resulting_version',[target.id]);check('exactly-four-audit-records',rows.rows.length===4&&new Set(rows.rows.map(r=>r.id)).size===4);
 await db.query('begin');try{await assert.rejects(db.query('delete from app_admin.user_changes where target_id=$1',[target.id]),error=>error.code==='23514');}finally{await db.query('rollback');}check('audit-immutable');
 stage='restart';const saved=JSON.parse(await readFile(join(stateDirectory,'launcher-process.json'),'utf8'));assert.equal(saved.project,root);assert.equal(saved.origin,state.origin);assert.equal(await readlink('/proc/'+saved.pid+'/cwd'),root);
 const args=(await readFile('/proc/'+saved.pid+'/cmdline','utf8')).split('\0');assert.ok(args.includes(join(root,'scripts/local-primary.mjs'))&&args.includes('--start')&&args.includes('--refunds'));
 const tariffMode=(await readFile('/proc/'+saved.pid+'/environ','utf8')).split('\0').find(value=>value.startsWith('BLIZHNIY_ADMIN_TARIFFS='))?.slice('BLIZHNIY_ADMIN_TARIFFS='.length);
 assert.ok(tariffMode===undefined||tariffMode==='local-v1');
 await admin('/api/admin/tariff-management',{},'GET',tariffMode?405:404);
 check('tariff-mode-before-restart');
 process.kill(saved.pid,'SIGTERM');for(const deadline=Date.now()+20000;;){try{const p=await readFile('/proc/'+saved.pid+'/status','utf8');if(/^State:\s+Z/m.test(p))break;}catch(error){if(error.code==='ENOENT')break;throw error;}assert.ok(Date.now()<deadline,'Owned shutdown timeout');await new Promise(resolve=>setTimeout(resolve,100));}
 await promisify(execFile)(process.execPath,['--experimental-strip-types',join(root,'scripts/local-primary.mjs'),'--background','--refunds'],{cwd:root,env:{...(tariffMode?{BLIZHNIY_ADMIN_TARIFFS:tariffMode}:{}),PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_SPECIALIST_CHECKOUT:'local-v1',BLIZHNIY_MEDIA_RETENTION:'local-v1',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_PLACEMENT_RENEWALS:'local-v1',BLIZHNIY_LOCAL_USER_ACCESS:'enabled',BLIZHNIY_LOCAL_TELEGRAM_CONFIG:join(stateDirectory,'telegram.json')},timeout:10000,maxBuffer:1048576});
 await waitReady();assert.deepEqual((await admin(endpoint,recover)).data.receipt,result.receipt);check('receipt-and-session-survive-restart');
 await admin('/api/admin/tariff-management',{},'GET',tariffMode?405:404);check('tariff-mode-survives-restart');
 assert.equal((await readFile('.next/BUILD_ID','utf8')).trim(),build);check('build-identity-preserved');
 for(const secret of [actor.email,target.email,actor.password,target.password])assert.equal(JSON.stringify(old).includes(secret),false);check('private-fields-absent');
 const report={date:new Date().toISOString(),passed:true,buildId:build,checks:results,mainJournal:(await db.query('select count(*)::int n from blizhniy_meta.migrations')).rows[0].n,adminJournal:(await db.query('select count(*)::int n from app_admin.migrations')).rows[0].n,productionTouched:false};assert.equal(report.mainJournal,59);assert.equal(report.adminJournal,2);
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,checks:results.length,buildId:build,report:join(directory,'report.json')}));
}catch(error){await writeFile(join(directory,'failed.json'),JSON.stringify({stage,checks:results,code:error?.code??error?.name??'Error'}),{mode:0o600});throw Error('Local user access acceptance failed');}
finally{await Promise.allSettled([admin?.('/api/account/logout'),first?.('/api/account/logout'),second?.('/api/account/logout'),renewed?.('/api/account/logout')]);await db.end();}
