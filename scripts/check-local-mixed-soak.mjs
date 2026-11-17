// Fixed local-only rehearsal; real credentials/providers and production are never loaded.
import assert from 'node:assert/strict';
import {Agent,request} from 'node:https';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,chmod,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import pg from 'pg';
import {stateDirectory,stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const root=process.cwd(),state=readLocalPrimaryState(stateFile,root);
assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const directory=await mkdtemp(join(stateDirectory,'mixed-soak-'));await chmod(directory,0o700);
const build=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim(),load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const ca=await readFile(join(stateDirectory,'tls-cert.pem')),agent=new Agent({ca,keepAlive:true,maxSockets:100,maxFreeSockets:100}),privateAgent=new Agent({ca,keepAlive:true,maxSockets:2,maxFreeSockets:2});
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:2000});
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
const durationMs=1800000,thinkMs=5000,paths=['/','/obyavleniya','/rabota','/rabota/vakansii','/rabota/zakazy','/poisk?q='+encodeURIComponent('ремонт')];
const initialLauncher=JSON.parse(await readFile(join(stateDirectory,'launcher-process.json'),'utf8'));
const samples=[],resources=[],actors=[],jobs=[];let started,ended,status='preparing',failure;
const pause=ms=>wait(Math.max(1,ms),undefined,{signal:controller.signal});
function http(path,{method='GET',body,cookies,privateRequest=false,allowAfterStop=false}={}){
 const startedRequest=performance.now();
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body)),start=performance.now();
  if(!allowAfterStop)controller.signal.throwIfAborted();
  const req=request(new URL(path,state.origin),{agent:privateRequest?privateAgent:agent,method,signal:allowAfterStop?AbortSignal.timeout(5000):AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),headers:{'accept-encoding':'identity',
   ...(privateRequest?{origin:state.origin,'sec-fetch-site':'same-origin','x-blizhniy-request':'1',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),
   ...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{
   const parts=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>(privateRequest?262144:2097152))req.destroy(Error('Response size bound'));else parts.push(chunk);});
   res.on('error',reject);res.on('end',()=>{
    if(!res.complete){reject(Error('Incomplete reply'));return;}
    const text=Buffer.concat(parts).toString('utf8');
    for(const cookie of res.headers['set-cookie']??[]){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies?.set(pair.slice(0,i),pair.slice(i+1));}
    try{resolve({status:res.statusCode,ms:performance.now()-start,bytes:size,data:privateRequest?JSON.parse(text):undefined,
     valid:privateRequest||text.includes('<h1')&&!text.includes('id="__next_error__"')&&!text.includes('Application error:')});}catch{reject(Error('Invalid JSON reply'));}
   });
  });req.on('error',reject);req.end(bytes);
 }).catch(()=>({status:0,ms:performance.now()-startedRequest,valid:false}));
}
async function api(actor,path,body={},method='POST',expected=200,scope='read',cookies=actor.cookies){
 const reply=await http(path,{method,body,cookies,privateRequest:true,allowAfterStop:scope==='cleanup'});
 if(started)samples.push({scope,path,status:reply.status,ms:reply.ms,valid:reply.status===expected});
 assert.equal(reply.status,expected,path);return reply.data;
}
const summary=()=>{
 const groups=new Map();for(const row of samples){const key=row.scope+' '+row.path;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups].map(([key,rows])=>{const times=rows.map(row=>row.ms).sort((a,b)=>a-b);return{key,count:rows.length,failures:rows.filter(row=>!row.valid).length,p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1),statuses:rows.reduce((all,row)=>(all[row.status]=(all[row.status]??0)+1,all),{})};});
};
async function save(){await writeFile(join(directory,'report.json'),JSON.stringify({version:1,date:new Date().toISOString(),origin:state.origin,buildId:build,status,durationMs,elapsedMs:started?performance.now()-started:0,visitors:100,anonymousReaders:98,syntheticActors:2,thinkMs,groups:summary(),resources,failure,productionTouched:false,realProviderRequests:false},null,2)+'\n',{mode:0o600});}
async function monitor(){
 const current=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim();assert.equal(current,build,'Build changed during soak');
 const launcher=JSON.parse(await readFile(join(stateDirectory,'launcher-process.json'),'utf8'));assert.equal(launcher.project,root);assert.equal(launcher.origin,state.origin);assert.equal(launcher.pid,initialLauncher.pid,'Launcher changed during soak');assert.equal(await readlink('/proc/'+launcher.pid+'/cwd'),root);
 const queue=[launcher.pid],pids=new Set();let rssKiB=0;
 while(queue.length){const pid=queue.shift();assert.ok(!pids.has(pid)&&pids.size<32);pids.add(pid);
  let info,children;try{info=await readFile('/proc/'+pid+'/status','utf8');children=await readFile('/proc/'+pid+'/task/'+pid+'/children','utf8');}
  catch(error){if(error.code==='ENOENT'&&pid!==launcher.pid)continue;throw error;}
  rssKiB+=Number(/^VmRSS:\s+(\d+)/m.exec(info)?.[1]??0);
  for(const child of children.trim().split(/\s+/).filter(Boolean))queue.push(Number(child));
 }
 const pgState=(await db.query("select count(*)::int as connections,count(*) filter(where state='active')::int as active,count(*) filter(where wait_event_type='Lock')::int as lock_wait from pg_stat_activity where datname=current_database()")).rows[0];
 resources.push({elapsedMs:performance.now()-started,processes:pids.size,rssMiB:rssKiB/1024,...pgState});
}
try{
 await db.connect();assert.equal((await db.query('select ssl from pg_stat_ssl where pid=pg_backend_pid()')).rows[0].ssl,true);
 for(const name of ['Синтетический Нагрузочный Альфа','Синтетический Нагрузочный Бета']){
  const actor={email:'soak-'+randomUUID()+'@local.invalid',password:'SyntheticSoak-'+randomUUID()+'!',cookies:new Map()};
  await db.query('begin');try{
   actor.id=(await db.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[actor.email,await load('identity').hashPassword(actor.password)])).rows[0].id;
   await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[actor.id,JSON.stringify(load('postgres-profile').parseProductionProfile({name,city:'Краснодар'}))]);await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  actors.push(actor);const login=await api(actor,'/api/account/login',{email:actor.email,password:actor.password,captchaToken:''});assert.equal(login.user.id,actor.id);
 }
 for(const path of paths){const p=await http(path);assert.equal(p.status,200,path);assert.equal(p.valid,true,path);}
 await api(actors[0],'/api/account/profile',{expectedOwnerId:actors[1].id},'POST',409,'negative');
 status='running';started=performance.now();ended=started+durationMs;await monitor();await save();
 jobs.push(...Array.from({length:98},async(_,index)=>{await pause(index*thinkMs/98);let next=index;while(performance.now()<ended&&!controller.signal.aborted){const path=paths[next++%paths.length];const r=await http(path);samples.push({scope:'public',path,status:r.status,ms:r.ms,valid:r.status===200&&r.valid});await pause(Math.min(thinkMs,ended-performance.now()));}}));
 jobs.push((async()=>{let turn=0;const actor=actors[0];while(performance.now()<ended&&!controller.signal.aborted){
  const current=await api(actor,'/api/account/profile',{expectedOwnerId:actor.id}),name=turn%2?'Синтетический Профиль Альфа':'Синтетический Профиль Бета';
  const changed={...current.profile,name,city:turn%2?'Краснодар':'Армавир'},saved=await api(actor,'/api/account/profile',{expectedOwnerId:actor.id,expectedRevision:current.revision,profile:changed},'PUT',200,'write');
  const reread=await api(actor,'/api/account/profile',{expectedOwnerId:actor.id});assert.equal(reread.profile.name,name);assert.equal(reread.profile.city,changed.city);assert.equal(reread.revision,saved.revision);
  await api(actor,'/api/account/profile',{expectedOwnerId:actor.id,expectedRevision:current.revision,profile:changed},'PUT',409,'negative');
  turn++;if(turn%20===0){const old=new Map(actor.cookies);await api(actor,'/api/account/logout',{},'POST',200,'session');await api(actor,'/api/account/profile',{expectedOwnerId:actor.id},'POST',401,'negative',old);
   const login=await api(actor,'/api/account/login',{email:actor.email,password:actor.password,captchaToken:''},'POST',200,'auth');assert.equal(login.user.id,actor.id);assert.equal((await api(actor,'/api/account/profile',{expectedOwnerId:actor.id})).profile.name,name);
  }
  await pause(Math.min(30000,ended-performance.now()));
 }})());
 jobs.push((async()=>{const actor=actors[1];while(performance.now()<ended&&!controller.signal.aborted){const p=await api(actor,'/api/account/profile',{expectedOwnerId:actor.id});assert.equal(p.profile.name,'Синтетический Нагрузочный Бета');await pause(Math.min(30000,ended-performance.now()));}})());
 jobs.push((async()=>{while(performance.now()<ended&&!controller.signal.aborted){await pause(Math.min(60000,ended-performance.now()));await monitor();await save();console.log(JSON.stringify({status,elapsedSeconds:Math.round((performance.now()-started)/1000),requests:samples.length,failures:samples.filter(row=>!row.valid).length}));}})());
 await Promise.all(jobs);assert.equal(controller.signal.aborted,false);assert.ok(performance.now()-started>=durationMs);
 for(const row of summary()){assert.equal(row.failures,0,row.key);if(!row.key.startsWith('negative '))assert.ok(row.p95<=(row.key.startsWith('write ')?1500:row.key.startsWith('auth ')?2000:800),row.key+' p95');}
 status='passed';
}catch(error){failure=typeof error?.code==='string'?error.code:'CHECK_FAILED';status=controller.signal.aborted?'interrupted':'failed';process.exitCode=1;}
finally{
 controller.abort();agent.destroy();await Promise.allSettled(jobs);
 for(const actor of actors)try{await api(actor,'/api/account/logout',{},'POST',200,'cleanup');}catch{if(status==='passed'){status='failed';failure='CLEANUP_FAILED';process.exitCode=1;}}
 privateAgent.destroy();await db.end();await save();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
 console.log(JSON.stringify({status,report:join(directory,'report.json'),groups:summary(),failure}));
}
