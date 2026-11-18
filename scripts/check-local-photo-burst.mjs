// Owned loopback PostgreSQL + actual WebP files/HTTP handlers. No production or external traffic.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {createServer,request as httpRequest} from 'node:http';
import {lstat,writeFile,mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
assert.equal(process.env.NODE_ENV,'test','run only with explicit NODE_ENV=test');
const suffix=randomBytes(8).toString('hex'),name='blizhniy-photo-burst-'+suffix,label='blizhniy.photo-burst',password=randomBytes(24).toString('hex');
const run=promisify(execFile),docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1048576})).stdout.trim();
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const stateDirectory=await mkdtemp(join(tmpdir(),'blizhniy-photo-burst-')),directory=await lstat(stateDirectory);
const email=`photo-burst-${suffix}@local.invalid`,records=[],fixtures=[];
let db,runtime,containerId,files,user,category,server;
try{
 containerId=await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
 const metadata=JSON.parse(await docker(['inspect',containerId]))[0];assert.equal(metadata.Id,containerId);assert.equal(metadata.Config.Labels[label],name);
 const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
 for(const end=Date.now()+20000;;){try{await docker(['exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<end);}await new Promise(resolve=>setTimeout(resolve,100));}
 const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false};
 db=new pg.Client(config);await db.connect();assert.match((await db.query('show server_version')).rows[0].server_version,/^18\.6/);
 for(const migration of getBootstrapPlan({includeListingContactMethod:true}))await db.query(migration.sql);
 await db.query(await readFile(new URL('../database/migrations/0026-listing-blocks.sql',import.meta.url),'utf8'));
 const runtimePassword=randomBytes(24).toString('hex');
 await db.query(`create role burst_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
  grant connect on database blizhniy_test to burst_runtime;grant usage on schema app to burst_runtime;
  grant select on app.users,app.cities,app.categories,app.cabinet_profiles,app.listings,app.listing_photos,app.listing_blocks,app.listing_moderation,app.media_objects to burst_runtime;
  grant select(id,target_type,target_id,owner_id,is_test,request_body) on app.payment_checkout_intents to burst_runtime;
  grant select(intent_id,published_at,expires_at) on app.payment_fulfillments to burst_runtime`);
 runtime=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'burst_runtime',password:runtimePassword,max:5}));
 await mkdir(join(stateDirectory,'media'),{mode:0o700});files=await load('media-files').createLocalMediaFileStore(join(stateDirectory,'media'));
 const region=(await db.query("insert into app.regions(slug,name) values('burst-region','Синтетический регион') returning id")).rows[0].id;
 const city=(await db.query("insert into app.cities(region_id,slug,name) values($1,'burst-city','Краснодар') returning id",[region])).rows[0].id;
 user=(await db.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128)])).rows[0].id;
 const phone='+7999'+String(randomBytes(4).readUInt32BE()%10000000).padStart(7,'0');
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify({name:'Проверка фотографий',phone})]);
 category=(await db.query("insert into app.categories(slug,name) values($1,'Синтетические фотографии') returning id",['photo-burst-'+suffix])).rows[0].id;
 for(const [width,height]of[[512,384],[1280,960],[1920,1440]]){
  const bytes=await sharp(randomBytes(width*height*3),{raw:{width,height,channels:3}}).webp({quality:78}).toBuffer();assert.ok(bytes.length>50000&&bytes.length<=2097152);
  const record={id:randomUUID(),mimeType:'image/webp',width,height,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  await files.write(record,bytes);records.push({...record,inode:await lstat(join(stateDirectory,'media',record.id+'.webp'))});
  await db.query("insert into app.media_objects(id,owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,$3,'image/webp',$4,$5,$6,$7)",[record.id,user,randomUUID(),width,height,record.size,record.sha256]);
  await db.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[record.id]);
 }
 for(let index=0;index<24;index++){
  const record=records[index%records.length];
  const id=(await db.query(`insert into app.listings(author_id,listing_type,title,description,price,category_id,city_id,contact_phone,status,is_paid,created_at,published_at,expires_at)
   values($1,'sell',$2,'Синтетическая карточка проверки параллельных фотографий.',1500,$3,$4,'+79990000000','published',true,statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day') returning id`,[user,'Проверка фотографий '+suffix+' '+index,category,city])).rows[0].id;
  await db.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[id,record.id]);fixtures.push({id,record,path:`/api/listings/${id}/photos/${record.id}`});
 }
 const admission=load('production-media-http').productionMediaAdmission,store=new(load('postgres-public-listings').PostgresPublicListingStore)(runtime,{postmoderation:true});
 const source=execFileSync('git',['show','30dcce5:src/lib/production-public-work-photo-http.ts'],{encoding:'utf8'}),before={};
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  const modules={'node:crypto':require('node:crypto'),'./auth-http':load('auth-http'),'./trusted-proxy-ip':load('trusted-proxy-ip'),'./listing-draft-contract.ts':load('listing-draft-contract'),'./production-media-http':{productionMediaAdmission:admission}};
  assert.ok(Object.hasOwn(modules,name));return modules[name];
 },before);
 let handler,peak=0,active=0;
 server=createServer(async(req,res)=>{
  try{
   const item=fixtures.find(row=>row.path===req.url);assert.ok(item);
   const response=await handler(new Request(origin+item.path,{headers:{host:new URL(origin).host,'x-real-ip':req.headers['x-real-ip']}}),item.id,item.record.id);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503);res.end('Synthetic fixture failed');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const composition=()=>({store,files:{read:async record=>{active++;peak=Math.max(peak,active);try{const bytes=await files.read(record);await new Promise(resolve=>setTimeout(resolve,25));return bytes;}finally{active--;}}}});
 const get=(item,client)=>new Promise((resolve,reject)=>{
  const started=performance.now(),req=httpRequest(origin+item.path,{headers:{'x-real-ip':client}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('error',reject);res.on('end',()=>{
   const bytes=Buffer.concat(chunks);if(res.statusCode===200){assert.equal(bytes.length,item.record.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.record.sha256);assert.equal(res.headers['cache-control'],'no-store');}
   resolve({status:res.statusCode,ms:performance.now()-started});
  });});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('Owned burst timeout')));req.end();
 });
 const measurements=[];
 for(const [name,factory]of[['before',before.createProductionPublicWorkPhotoHandler],['after',load('production-public-work-photo-http').createProductionPublicWorkPhotoHandler]]){
  handler=factory({origin},composition,()=>{});assert.equal((await get(fixtures[0],'192.0.2.1')).status,200,'Warmup must serve a verified WebP');peak=0;
  const samples=[];let rss=process.memoryUsage().rss;const monitor=setInterval(()=>{rss=Math.max(rss,process.memoryUsage().rss);},5);
  try{for(let burst=0;burst<3;burst++){
   const start=performance.now(),result=await Promise.all(Array.from({length:48},(_,index)=>get(fixtures[index%24],'192.0.2.'+(index<24?'1':'2'))));
   const successes=result.filter(row=>row.status===200).length,busy=result.filter(row=>row.status===503).length,times=result.map(row=>row.ms).sort((a,b)=>a-b);
   if(name==='after'){assert.equal(successes,48);assert.equal(busy,0);}else assert.ok(busy>0);
   samples.push({requests:48,successes,busy,totalMs:performance.now()-start,p95ms:times[Math.ceil(times.length*.95)-1]});assert.equal(admission.reads,0);
  }}finally{clearInterval(monitor);}
  assert.ok(peak<=4);measurements.push({name,peakFileReads:peak,combinedHarnessRssPeak:rss,bursts:samples});
 }
 // Commit withdrawal while the fifth request waits behind four physical reads.
 const blocked=fixtures.at(-1);let ready,open,entered=0,lookups=0,settled=false;
 const allEntered=new Promise(resolve=>ready=resolve),barrier=new Promise(resolve=>open=resolve);
 const queuedHandler=load('production-public-work-photo-http').createProductionPublicWorkPhotoHandler({origin},()=>({
  store:{photoRecord:(id,file)=>{if(id===blocked.id)lookups++;return store.photoRecord(id,file);}},
  files:{read:async record=>{if(++entered===4)ready();await barrier;return files.read(record);}},
 }),()=>{});
 const request=item=>new Request(origin+item.path,{headers:{host:new URL(origin).host,'x-real-ip':'192.0.2.3'}});
 const held=fixtures.slice(0,4).map(item=>queuedHandler(request(item),item.id,item.record.id));
 await allEntered;const waiting=queuedHandler(request(blocked),blocked.id,blocked.record.id).then(value=>{settled=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(lookups,0);
 try{await db.query("update app.listings set status='archived' where id=$1",[blocked.id]);}finally{open();}
 assert.equal((await waiting).status,404);assert.equal(lookups,1);assert.equal(entered,4);
 assert.ok((await Promise.all(held)).every(response=>response.status===200));assert.equal(admission.reads,0);
 await db.query("update app.listings set status='published' where id=$1",[blocked.id]);
 const duringRead=load('production-public-work-photo-http').createProductionPublicWorkPhotoHandler({origin},()=>({store,files:{read:async record=>{
  const bytes=await files.read(record);await db.query("update app.listings set status='archived' where id=$1",[blocked.id]);return bytes;
 }}}),()=>{});
 assert.equal((await duringRead(request(blocked),blocked.id,blocked.record.id)).status,404);assert.equal(admission.reads,0);
 await new Promise(resolve=>server.close(resolve));server=undefined;
 const report={date:new Date().toISOString().slice(0,10),scope:'Own PG18.6 1CPU/512MiB, loopback HTTP, real restricted store and private WebP reader; two synthetic trusted IPs, 3 bursts of48requests, 25ms controlled read delay; combined server/client process RSS, not production capacity or leak proof.',files:records.map(({width,height,size})=>({width,height,size})),measurements,withdrawalWhileQueued:'404 without file read',withdrawalDuringFileRead:'404 without bytes'};
 const reportPath=join(await mkdtemp(join(tmpdir(),'blizhniy-photo-report-')),'blizhniy-f13-photo-burst.json');
 await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.error('Photo benchmark report:',reportPath);
 console.log(JSON.stringify(report));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await runtime?.close();await db?.end();
 if(containerId){const metadata=JSON.parse(await docker(['inspect',containerId]))[0];assert.equal(metadata.Id,containerId);assert.equal(metadata.Name,'/'+name);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',containerId]);}
 const current=await lstat(stateDirectory);assert.equal(current.ino,directory.ino);assert.equal(current.dev,directory.dev);assert.equal(current.uid,process.getuid());await rm(stateDirectory,{recursive:true});
}
