// Local acceptance only. No deploy imports, production credentials or migrations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {randomInt,randomBytes,randomUUID,createHmac,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,open,cp,lstat,realpath,symlink,readlink,rename,rm,readdir,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {boundedHandoffRequest as http} from './handoff-http.mjs';
import {probeWebSlot} from './handoff-probe.mjs';
import {createWebHandoff} from './rolling-web-handoff.mjs';
import {openHandoffJournal} from './handoff-journal.mjs';
import {createCaddyWebRoute} from './caddy-web-route.mjs';
import {verifyHandoffAssets} from './handoff-assets.mjs';

const root=await realpath(fileURLToPath(new URL('..',import.meta.url)));
const cache=join(homedir(),'.cache','blizhniy-audit-f17');
const image='caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb';
const canonical='https://xn----9sbphbgks4a4a.xn--p1ai';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,ms=20000){const end=Date.now()+ms;for(;;){try{if(await check())return;}catch{ /* Bounded local startup observation, never a write retry. */ }if(Date.now()>=end)throw Error('Local startup deadline');await pause(100);}}
async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function privateDirectory(path){await mkdir(path,{mode:0o700,recursive:true});const info=await lstat(path);assert.ok(info.isDirectory()&&info.uid===process.getuid()&&(info.mode&0o7777)===0o700&&await realpath(path)===path,'private owned fixture directory');}
async function freezeFixtureAssets(path){
 const info=await lstat(path);assert.ok(info.uid===process.getuid()&&!info.isSymbolicLink(),'only new owned asset copies are normalized');
 if(info.isDirectory()){await chmod(path,0o700);for(const name of await readdir(path))await freezeFixtureAssets(join(path,name));}
 else{assert.ok(info.isFile()&&info.nlink===1);await chmod(path,0o600);}
}

// Copy only a pinned, never-started tool image; rewrite bytes to drop file caps.
async function caddyBinary(directory){
 const name='blizhniy-handoff-tool-'+randomBytes(8).toString('hex');
 const id=await docker(['create','--pull','never','--network','none','--name',name,'--label',`blizhniy.handoff-tool=${directory}`,image]);
 const verify=async()=>{const meta=JSON.parse(await docker(['inspect',id]))[0];assert.equal(meta.Id,id);assert.equal(meta.Name,'/'+name);assert.equal(meta.Config.Image,image);assert.equal(meta.Config.Labels['blizhniy.handoff-tool'],directory);assert.equal(meta.State.Running,false);};
 try{await verify();const copied=join(directory,'caddy.image');await docker(['cp',`${id}:/usr/bin/caddy`,copied]);const binary=join(directory,'caddy-tool');await writeFile(binary,await readFile(copied),{mode:0o700,flag:'wx'});return binary;}
 finally{await verify();await docker(['rm',id]);}
}

function localWebEnvironment(state){
 return {PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_CSP_MODE:'enforce',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_STATE:stateFile,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,
  BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_REMEMBERED_CAPTCHA:'enabled',BLIZHNIY_AUTH_CONFIRMATION_NOTICE:'enabled',
  BLIZHNIY_AUTH_ORIGIN:canonical,BLIZHNIY_AUTH_RATE_SECRET:state.rateSecret,BLIZHNIY_AUTH_MAIL_KEY_FILE:join(stateDirectory,'mail-key.bin'),
  BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',
  BLIZHNIY_DB_PASSWORD:state.runtimePassword,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(stateDirectory,'tls-cert.pem'),
  BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-local-not-used-by-smtp',
  TURNSTILE_SECRET_KEY:'synthetic-local-not-used-by-provider',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'synthetic-local-primary-site-key',
  BLIZHNIY_LISTING_CONTACT_METHOD:'enabled',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test'};
}

// One ordinary HTTP body already being served by old Next, paused by the client.
async function heldStream(port,path,size){
 const req=request({hostname:'127.0.0.1',port,path,agent:false,headers:{'accept-encoding':'identity',connection:'close'}});
 const response=once(req,'response');req.end();const [res]=await response;
 assert.equal(res.statusCode,200);assert.equal(Number(res.headers['content-length']),size);res.pause();
 let bytes=0;const done=new Promise((resolve,reject)=>{res.on('data',chunk=>{bytes+=chunk.length;});res.once('error',reject);res.once('aborted',()=>reject(Error('Stream interrupted')));res.once('end',()=>{try{assert.equal(bytes,size);assert.equal(res.complete,true);resolve();}catch(error){reject(error);}});});
 // Cleanup observes any rejection even before resume; no unhandled rejection.
 done.catch(()=>{});
 return {resume:()=>res.resume(),done,abort:()=>{res.destroy();req.destroy();}};
}

async function acceptance(directory,unit){
 assert.match(unit,/^blizhniy-handoff-[a-f0-9]{16}\.service$/);
 const cgroup=(await readFile('/proc/self/cgroup','utf8')).trim().split('\n').find(line=>line.startsWith('0::'))?.slice(3);
 assert.ok(cgroup?.endsWith('/'+unit),'all web/proxy children are inside the owned cgroup');
 const memory=join('/sys/fs/cgroup',cgroup,'memory.max');assert.equal((await readFile(memory,'utf8')).trim(),'805306368');
 const state=readLocalPrimaryState(stateFile,root);validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const buildId=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim();assert.match(buildId,/^[A-Za-z0-9_-]{1,128}$/);
 const binary=await caddyBinary(directory),children=[],journals=[];
 const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner')),pool=new pg.Pool({...localPrimaryDatabaseConfig(state),max:2});
 const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('./local-primary-modules.cjs');
 const identity=new (load('identity').IdentityStore)(new (load('postgres').PostgresDatabase)(pool));
 let userId,stream,traffic,trafficRun=false,fixtureInfo,proxy;
 const fixture=join(root,'public/images','handoff-fixture-'+randomBytes(8).toString('hex'));
 const ip=`192.0.2.${randomInt(10, 250)}`;
 const key=createHmac('sha256',state.rateSecret).update('production:session:ip:'+ip).digest('hex');
 let ownedRateKey=false;
 async function child(command,args,env,label){
  const log=await open(join(directory,label+'.log'),'wx',0o600);
  const proc=spawn(command,args,{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
  const spawned=once(proc,'spawn'),exited=once(proc,'exit');spawned.catch(()=>{});exited.catch(()=>{});children.push({proc,exited});await log.close();await spawned;return {proc,exited};
 }
 const alive=value=>value.proc.exitCode===null&&value.proc.signalCode===null;
 const processes=new Map();
 async function start(slot){assert.ok(!processes.has(slot.slot)||!alive(processes.get(slot.slot)));const count=children.length;
  const value=await child(process.execPath,['--require',join(root,'scripts/local-primary-preload.cjs'),join(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(slot.port)],localWebEnvironment(state),slot.slot+'-'+count);
  processes.set(slot.slot,value);await waitFor(async()=>{assert.ok(alive(value),'new Next must stay alive');return (await http({hostname:'127.0.0.1',port:slot.port,path:'/api/health'},{deadlineMs:500})).status===200;});return true;
 }
 async function drain(slot){const value=processes.get(slot.slot);assert.ok(alive(value));value.proc.kill('SIGTERM');
  if(slot.slot==='blue'&&stream){await pause(200);assert.ok(alive(value),'old Next must wait for its in-flight response');stream.resume();await stream.done;stream=undefined;}
  const result=await Promise.race([value.exited,pause(10000).then(()=>null)]);return result?.[0]===0;
 }
 try{
  await owner.connect();assert.equal((await owner.query('select count(*)::int as count from app.auth_rate_limits where key_hash=$1',[key])).rows[0].count,0,'synthetic limiter key must be unused');ownedRateKey=true;
  const email='handoff-'+randomBytes(12).toString('hex')+'@local.invalid',password='Local-handoff-'+randomBytes(16).toString('hex')+'!';
  userId=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,await load('identity').hashPassword(password)])).rows[0].id;
  await writeFile(join(directory,'owned-fixture.json'),JSON.stringify({userId,rateKey:key,fixture}),{mode:0o600,flag:'wx'});
  const session=await identity.login(email,password);assert.equal(session?.user.id,userId);
  const ports=await Promise.all([freePort(),freePort(),freePort()]);assert.equal(new Set(ports).size,3);
  const blue={slot:'blue',port:ports[0],buildId},green={slot:'green',port:ports[1],buildId},front=ports[2];
  await mkdir(fixture,{mode:0o700});fixtureInfo=await lstat(fixture);
  const size=32*1024*1024;const file=await open(join(fixture,'stream.bin'),'wx',0o600);await file.truncate(size);await file.close();
  const roots=[join(directory,'green-assets'),join(directory,'blue-assets')];
  for(const assetRoot of roots){await mkdir(join(assetRoot,'_next'),{recursive:true,mode:0o700});await cp(join(root,'.next/static'),join(assetRoot,'_next/static'),{recursive:true,errorOnExist:true,force:false});await freezeFixtureAssets(assetRoot);}
  const late='/_next/static/handoff-old-'+randomBytes(8).toString('hex')+'.js';await writeFile(roots[1]+late,'/* owned old build late chunk */',{mode:0o600,flag:'wx'});
  const assets=verifyHandoffAssets(roots);assert.ok(assets.shared>0);
  await start(blue);assert.equal((await probeWebSlot(blue)).ready,true,'old real ready must query local PostgreSQL');
  assert.equal((await probeWebSlot({...blue,buildId:'wrong-build'})).ready,false,'actual HTML must prove the expected running build');
  const admin=join(directory,'admin');await privateDirectory(admin);const socketPath=join(admin,'admin.sock');
  const config={admin:{listen:`unix/${socketPath}|0600`,origins:['localhost']},apps:{http:{servers:{local:{listen:[`127.0.0.1:${front}`],routes:[
   {match:[{path:['/_next/static/*']}],handle:[{handler:'headers',response:{set:{'Cache-Control':['public, max-age=31536000, immutable']}}},...roots.map((assetRoot,index)=>({handler:'file_server',root:assetRoot,pass_thru:index===0}))],terminal:true},
   {handle:[{'@id':'blizhniy-web',handler:'reverse_proxy',upstreams:[{dial:`127.0.0.1:${blue.port}`}],headers:{request:{set:{Host:[new URL(canonical).host],'X-Real-IP':[ip]},delete:['Cf-Connecting-Ip']}}}]}]}}}}};
  const configPath=join(directory,'caddy.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
  proxy=await child(binary,['run','--config',configPath],{PATH:process.env.PATH,HOME:directory,XDG_DATA_HOME:directory,XDG_CONFIG_HOME:directory},'caddy');
  const route=createCaddyWebRoute({socketPath,ports:ports.slice(0,2)});await waitFor(async()=>{assert.ok(alive(proxy));return (await route.read()).port===blue.port;});
  const oldPage=await http({hostname:'127.0.0.1',port:front,path:'/'},{maxBytes:4*1024*1024});assert.equal(oldPage.status,200);
  const bundle=/<script\b[^>]*src="(\/_next\/static\/chunks\/[^"?]+\.js)"/.exec(oldPage.body.toString('utf8'))?.[1];assert.ok(bundle,'old HTML references a real Next chunk');
  const oldChunk=await http({hostname:'127.0.0.1',port:front,path:bundle},{maxBytes:4*1024*1024});assert.equal(oldChunk.status,200);
  const oldHash=createHash('sha256').update(oldChunk.body).digest('hex');
  const headers={host:new URL(canonical).host,origin:canonical,'x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+session.token,'x-real-ip':ip};
  const sessionAt=async port=>http({hostname:'127.0.0.1',port,path:'/api/account/session',method:'POST',headers,body:'{}'});
  const assertSession=async port=>{const response=await sessionAt(port);assert.equal(response.status,200,'same session is valid across web processes');assert.equal(JSON.parse(response.body).user.id,userId);};
  await assertSession(front);
  const count=async()=>(await owner.query('select coalesce(sum(attempts),0)::int as count from app.auth_rate_limits where key_hash=$1',[key])).rows[0].count;
  const before=await count();await assertSession(blue.port);assert.equal(await count(),before+1,'limiter is PostgreSQL-backed');
  stream=await heldStream(front,'/images/'+fixture.split('/').at(-1)+'/stream.bin',size);
  const responses=[];trafficRun=true;traffic=(async()=>{while(trafficRun){try{responses.push((await http({hostname:'127.0.0.1',port:front,path:'/api/health'},{deadlineMs:2000})).status);}catch{responses.push(0);}await pause(20);}})();
  const active=join(directory,'active');await symlink('blue',active);
  const journalDir=join(directory,'journals');await privateDirectory(journalDir);
  async function operation(previous,next,mode){
   const operationId=randomUUID();
   const journal=openHandoffJournal(journalDir,operationId);journals.push(journal);
   const result=await createWebHandoff({operationId,previous,next},{journal,
    admission:async(a,b)=>a.buildId===buildId&&b.buildId===buildId&&verifyHandoffAssets(roots).shared===assets.shared,
    start,probe:probeWebSlot,route:mode==='unknown'?{read:route.read,switch:async(...args)=>{await route.switch(...args);throw Error('Synthetic lost acknowledgement');}}:route,
    confirm:async()=>{await assertSession(front);return mode!=='rollback';},
    promote:async(a,b)=>{assert.equal(await readlink(active),a.slot);const pending=active+'.next';await symlink(b.slot,pending);await rename(pending,active);return await readlink(active)===b.slot;},drain}).run();
   const released=journal.finish(result);assert.equal(released,['complete','not-started','not-promoted','rolled-back'].includes(result.state));journal.close();return result;
  }
  const complete=await operation(blue,green,'success');assert.equal(complete.state,'complete');assert.equal(alive(processes.get('blue')),false);await assertSession(front);
  assert.equal((await http({hostname:'127.0.0.1',port:front,path:late})).status,200,'old-only asset survives old process exit');
  const retained=await http({hostname:'127.0.0.1',port:front,path:bundle},{maxBytes:4*1024*1024});assert.equal(retained.status,200);assert.equal(createHash('sha256').update(retained.body).digest('hex'),oldHash,'real chunk referenced by old HTML survives unchanged');assert.match(retained.headers['cache-control'],/immutable/);
  const manifest=await http({hostname:'127.0.0.1',port:front,path:`/_next/static/${buildId}/_buildManifest.js`});assert.equal(manifest.status,200);assert.match(manifest.headers['cache-control'],/immutable/);
  const rollback=await operation(green,blue,'rollback');assert.equal(rollback.state,'rolled-back');assert.equal((await route.read()).port,green.port);assert.equal(alive(processes.get('blue')),false);await assertSession(front);
  const unknown=await operation(green,blue,'unknown');assert.equal(unknown.state,'recovery-required');assert.ok(alive(processes.get('green'))&&alive(processes.get('blue')),'unknown switch retains both processes and lease');
  assert.throws(()=>openHandoffJournal(journalDir,randomUUID()),/Handoff journal unavailable/,'unknown result blocks the next operation against this ingress');
  const sharedBefore=await count();await assertSession(blue.port);await assertSession(green.port);assert.equal(await count(),sharedBefore+2,'both instances increment the same limiter row');
  await identity.revokeSession(session.token);assert.equal((await sessionAt(blue.port)).status,401);assert.equal((await sessionAt(green.port)).status,401,'revocation is shared immediately');
  trafficRun=false;await traffic;assert.ok(responses.length>=10,'observe requests through the whole operation');assert.ok(responses.every(status=>status===200),'no request outage during local handoff/rollback');
  const peak=Number((await readFile(join(dirname(memory),'memory.peak'),'utf8')).trim());assert.ok(peak<=768*1024*1024);
  console.log(JSON.stringify({sameBuild:true,states:[complete.state,rollback.state,unknown.state],healthRequests:responses.length,failedRequests:responses.filter(s=>s!==200).length,streamBytes:size,oldAssets:true,oldBundle:true,sharedSessionAndLimiter:true,webProxyPeakMiB:Math.ceil(peak/1024/1024),memoryLimitMiB:768}));
 }finally{
  trafficRun=false;if(traffic)await traffic;stream?.abort();
  // Fixture cleanup only, after observations end. Never a production drain policy.
  for(const value of [...children].reverse())if(alive(value))value.proc.kill('SIGTERM');
  await Promise.all(children.map(async value=>{if(!alive(value))return;const result=await Promise.race([value.exited,pause(3000).then(()=>null)]);if(!result&&alive(value)){value.proc.kill('SIGKILL');await value.exited;}}));
  for(const journal of journals)journal.close();
  if(userId)await owner.query('delete from app.users where id=$1',[userId]);
  if(ownedRateKey)await owner.query('delete from app.auth_rate_limits where key_hash=$1',[key]);
  await pool.end();await owner.end();
  if(fixtureInfo){const now=await lstat(fixture);assert.ok(now.uid===process.getuid()&&now.ino===fixtureInfo.ino&&now.dev===fixtureInfo.dev,'only owned stream fixture is removed');await rm(fixture,{recursive:true});}
 }
}

async function main(){
 if(process.argv.length===5&&process.argv[2]==='--inside'){
  const directory=process.argv[3];assert.equal(dirname(directory),cache);await privateDirectory(directory);await acceptance(directory,process.argv[4]);return;
 }
 assert.equal(process.argv.length,2,'no external host/config arguments accepted');assert.equal(process.versions.node.split('.')[0],'22');
 await privateDirectory(cache);const directory=await mkdtemp(join(cache,'run-'));
 const unit='blizhniy-handoff-'+randomBytes(8).toString('hex')+'.service';
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
 const child=spawn('/usr/bin/systemd-run',['--user','--quiet','--pipe','--wait','--collect','--service-type=exec','--unit='+unit,
  '--property=MemoryMax=768M','--property=MemorySwapMax=0','--property=CPUQuota=200%','--property=TasksMax=128','--property=RuntimeMaxSec=180','--property=TimeoutStopSec=2','--property=KillMode=control-group','--property=NoNewPrivileges=yes','--property=LimitCORE=0',
  '--working-directory='+root,'/usr/bin/env','-i','NODE_ENV=test','LANG=C.UTF-8','PATH='+process.env.PATH,process.execPath,'--experimental-strip-types',fileURLToPath(import.meta.url),'--inside',directory,unit],{env,stdio:'inherit'});
 const [code]=await once(child,'exit');assert.equal(code,0,'owned cgroup acceptance failed; inspect private run logs');
}
main().catch(error=>{console.error('Local web handoff acceptance failed:',error.message);process.exitCode=1;});
