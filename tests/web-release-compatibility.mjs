// Both web processes have only a private loopback and access to disposable PostgreSQL by a Unix relay.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { enableRefundFixtureTls } from './local-refund-runtime-cases.mjs';

const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const canonicalHost=new URL(origin).host;
const dbHost='17e86f80f26733d39ef4b84d.twc1.net';
const previousBuild='e078fa5688b03780e4500d2e2fe017b6d214bab8';
const database='blizhniy_prod';
const role='blizhniy_runtime';

async function start(command,args,{env,cwd,log}) {
  const file=await open(log,'a',0o600);
  try {
    const child=spawn(command,args,{env,cwd,stdio:['ignore',file.fd,file.fd]});
    let error;
    const exited=new Promise(resolve=>{
      child.once('error',cause=>{error=cause;resolve();});
      child.once('exit',resolve);
    });
    return {
      assertRunning(){assert.equal(child.exitCode,null,'Fixture process exited; inspect its log');assert.equal(child.signalCode,null);if(error)throw error;},
      async stop(){
        if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
        await Promise.race([exited,delay(3000,undefined,{ref:false})]);
        if(child.exitCode===null&&child.signalCode===null&&!error)child.kill('SIGKILL');
        await exited;
      },
    };
  } finally {await file.close();}
}

async function http(socketPath,path,{method='GET',body,token}={}) {
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const outgoing=request({socketPath,path,method,agent:false,signal:AbortSignal.timeout(4000),headers:{
      Host:canonicalHost,'X-Real-IP':'192.0.2.41','X-Forwarded-Proto':'https',
      ...(bytes?{Origin:origin,'X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin',
        'Content-Type':'application/json','Content-Length':bytes.length}:{}),
      ...(token?{Cookie:'__Host-blizhniy_session='+token}:{}),
    }},async incoming=>{
      try{
        const chunks=[];let size=0;
        for await(const chunk of incoming){size+=chunk.length;assert.ok(size<=2*1024*1024);chunks.push(chunk);}
        const text=Buffer.concat(chunks).toString('utf8');
        resolve({status:incoming.statusCode,data:incoming.headers['content-type']?.includes('application/json')?JSON.parse(text):text});
      }catch(error){reject(error);}
    });
    outgoing.on('error',reject);
    outgoing.end(bytes??undefined);
  });
}

async function exerciseWeb(root,fixture,{token,owner,readsAs,writesAs,peer,bookingId,guarded=false}) {
  const build=(await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim();
  assert.match(build,/^[a-f0-9]{40}$/);
  const {commit,buildId}=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));
  assert.equal(commit,build);
  assert.equal(buildId,build);
  const socketPath=join(fixture.directory,'web.sock');
  const script=join(fixture.directory,'serve.sh');
  await writeFile(script,`set -eu
/usr/bin/socat TCP4-LISTEN:5432,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:"$1/pg.sock" &
/usr/bin/socat UNIX-LISTEN:"$1/web.sock",mode=0600,fork TCP4:127.0.0.1:3045 &
exec "$2" server.js
`,{mode:0o600});
  const env={
    PATH:'/usr/bin:/bin',LANG:'C.UTF-8',NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'3045',
    NEXT_TELEMETRY_DISABLED:'1',__NEXT_PROCESSED_ENV:'true',
    BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_AUTH_RATE_SECRET:fixture.rateSecret,
    BLIZHNIY_AUTH_MAIL_KEY_FILE:join(fixture.directory,'mail-key'),
    BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@'+canonicalHost,BLIZHNIY_SMTP_PASSWORD:'synthetic-fixture-only',
    TURNSTILE_SECRET_KEY:'synthetic-fixture-only-captcha',
    BLIZHNIY_DB_HOST:fixture.dbHost??dbHost,BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:database,BLIZHNIY_DB_USER:role,
    BLIZHNIY_DB_PASSWORD:fixture.password,BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:fixture.ca,
    BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_BOOKING_LIFECYCLE:'production-v1',
    ...(fixture.sameHost?{BLIZHNIY_DB_PLACEMENT:'same-host'}:{}),
    ...(guarded?{BLIZHNIY_USER_ACCESS_OPERATOR:'hosted-passkey-v1',BLIZHNIY_ADMIN_PASSKEYS:'hosted-v1',
      BLIZHNIY_REFUND_ADMIN:'hosted-passkey-test-v1',BLIZHNIY_ADMIN_PAYMENT_JOURNAL:'test-v1',
      BLIZHNIY_PAYMENT_SHOP_ID:'synthetic-fixture'}:{}),
  };
  const isolatedApp=join(fixture.directory,'app'),isolatedNode=join(fixture.directory,'node');
  const web=await start('/usr/bin/bwrap',[
    '--die-with-parent','--unshare-net','--unshare-pid','--ro-bind','/','/','--proc','/proc','--dev','/dev',
    '--tmpfs','/home','--tmpfs','/run','--tmpfs','/tmp',
    '--bind',fixture.directory,fixture.directory,'--ro-bind',join(fixture.directory,'hosts'),'/etc/hosts',
    '--ro-bind',root,isolatedApp,'--ro-bind',process.execPath,isolatedNode,
    '--chdir',isolatedApp,'/bin/bash',script,fixture.directory,isolatedNode,
  ],{env,cwd:root,log:join(fixture.evidence,`${fixture.phase}-${build.slice(0,8)}.log`)});
  try {
    for(const deadline=Date.now()+16000;;){
      web.assertRunning();
      const ready=await http(socketPath,'/api/ready').catch(()=>null);
      if(ready?.status===200&&ready.data?.ok===true)break;
      if(Date.now()>=deadline)throw Error('Archived web build never reached PostgreSQL readiness');
      await delay(150);
    }
    for(const path of ['/','/poisk?q='+encodeURIComponent('ремонт'),'/cabinet','/cabinet/bronirovaniya']){
      const reply=await http(socketPath,path,{token});
      assert.equal(reply.status,200,path);
      assert.match(reply.data,/<h1[\s>]/,path);
      assert.doesNotMatch(reply.data,/id="__next_error__"|Application error:/,path);
    }
    const profilePath='/api/account/profile';
    const body={expectedOwnerId:owner},requestProfile=(data=body,cookie=token,method='POST')=>http(socketPath,profilePath,{method,body:data,token:cookie});
    assert.equal((await http(socketPath,profilePath,{method:'POST',body})).status,401);
    assert.equal((await requestProfile({expectedOwnerId:peer})).status,409);
    const profile=await requestProfile();
    assert.equal(profile.status,200);
    assert.equal(profile.data.profile.name,readsAs);
    const saved=await requestProfile({...body,expectedRevision:profile.data.revision,profile:{...profile.data.profile,name:writesAs}},token,'PUT');
    assert.equal(saved.status,200);
    assert.equal(saved.data.profile.name,writesAs);
    const booking=await http(socketPath,'/api/account/bookings',{method:'POST',token,
      body:{action:'list',expectedOwnerId:owner,mode:'guest',after:null}});
    assert.equal(booking.status,200);
    assert.deepEqual(booking.data.items.map(row=>[row.id,row.status]),[[bookingId,'pending']]);
    const tls=(await fixture.ownerDb.query(`select exists(select 1 from pg_stat_activity join pg_stat_ssl using(pid)
      where datname=$1 and usename=$2 and ssl) as admitted`,[database,role])).rows[0].admitted;
    assert.equal(tls,true);
    let passkeyStatus,refundStatus;
    if(fixture.sameHost){
      const options=await http(socketPath,'/api/admin/passkey',{method:'POST',token,
        body:{action:'enroll-options',code:randomBytes(32).toString('base64url')}});
      passkeyStatus=options.status;
      assert.equal(passkeyStatus,guarded?503:404);
      const refundRead=await http(socketPath,'/api/admin/refunds',{method:'POST',token,
        body:{action:'read',expectedAdminId:owner,input:randomUUID()}});
      refundStatus=refundRead.status;
      assert.equal(refundStatus,guarded?503:404);
    }
    return {build,tls,readRoutes:5,authenticatedProfile:true,deniedGuest:true,deniedWrongOwner:true,profileWrite:true,bookingRead:true,
      ...(passkeyStatus===undefined?{}:{guarded,passkeyStatus,refundStatus})};
  } finally {
    await web.stop();
    await rm(socketPath,{force:true});
  }
}

export async function testWebReleaseCompatibility({admin,config,docker,container,phase,evidence}) {
  assert.equal(config.host,'127.0.0.1');
  assert.equal(config.database,'blizhniy_test');
  assert.match(container,/^[a-f0-9]{64}$/);
  assert.ok(phase==='baseline'||phase==='expanded');
  assert.ok(isAbsolute(evidence)&&await realpath(evidence)===evidence);
  const newWeb=await realpath(join(evidence,'new-web'));
  const oldWeb=await realpath(join(evidence,'old-web'));
  assert.equal((await readFile(join(oldWeb,'.next/BUILD_ID'),'utf8')).trim(),previousBuild);
  return testWebAgainstRestoredDatabase({admin,config,docker,container,phase,evidence,newWeb,oldWeb});
}

export async function testRetainedPasskeyWeb({admin,config,docker,container,evidence}) {
  assert.equal(config.host,'127.0.0.1');
  assert.equal(config.database,'blizhniy_test');
  assert.match(container,/^[a-f0-9]{64}$/);
  assert.ok(isAbsolute(evidence)&&await realpath(evidence)===evidence);
  const newWeb=await realpath(join(evidence,'new-web'));
  return testWebAgainstRestoredDatabase({admin,config,docker,container,phase:'expanded',evidence,newWeb,sameHost:true});
}

async function testWebAgainstRestoredDatabase({admin,config,docker,container,phase,evidence,newWeb,oldWeb,sameHost=false}) {
  const evidencePhase=sameHost?'retained-passkeys':phase;
  const password=randomBytes(32).toString('hex'),directory=await mkdtemp(join(tmpdir(),'blizhniy-web-rollback-'));
  const ca=join(directory,'pg-ca.crt'),key=join(directory,'pg-key');
  let relay,ownerDb,created=false,roleChanged=false,originalLogin;
  try {
    // The owned fixture may have used this exact role for earlier authenticated checks.
    originalLogin=(await admin.query('select rolcanlogin,rolpassword from pg_authid where rolname=$1',[role])).rows[0];
    assert.ok(originalLogin&&typeof originalLogin.rolcanlogin==='boolean');
    await admin.query('create database blizhniy_prod template template0');
    created=true;
    await docker(['exec',container,'bash','-euo','pipefail','-c',
      'pg_dump --format=custom --username=postgres --dbname=blizhniy_test | pg_restore --single-transaction --exit-on-error --username=postgres --dbname=blizhniy_prod']);
    await admin.query(`alter role ${role} login password ${pg.escapeLiteral(password)};
      revoke all on database blizhniy_prod from public; grant connect on database blizhniy_prod to ${role}`);
    roleChanged=true;
    ownerDb=new pg.Client({...config,database});
    await ownerDb.connect();
    const journal=async()=>(await ownerDb.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
    const before=await journal();
    assert.equal(before.length,phase==='baseline'?43:78);
    assert.equal(before.at(-1).name,phase==='baseline'?'0067-paid-response-test.sql':'0087-push-delivery.sql');
    const adminJournal=async()=>(await ownerDb.query('select name,sha256 from app_admin.migrations order by name')).rows;
    const restoredAdmin=phase==='baseline'?[]:await adminJournal();
    if(phase==='expanded')assert.equal(restoredAdmin.at(-1).name,'0088-hosted-tariff-policy.sql');
    const passkeyCount=async()=>(await ownerDb.query('select count(*)::int as count from app_admin_passkey.credentials')).rows[0].count;
    const retained=sameHost?await passkeyCount():null;
    if(sameHost)assert.ok(retained>0);
    // Match the restricted production auth/profile grants for the paths exercised here.
    await ownerDb.query(`revoke create on schema public from public;
      grant usage on schema app to ${role};
      grant select on app.categories,app.regions,app.cities,app.users,app.sessions,app.mail_outbox,app.auth_rate_limits,
        app.cabinet_profiles,app.listings,app.listing_photos,app.listing_moderation,app.listing_blocks,app.work_publications,
        app.work_publication_photos,app.work_moderation,app.specialist_categories,app.service_publications,
        app.service_publication_photos,app.service_moderation,app.media_objects,app.tariffs,app.booking_requests to ${role};
      grant select(work_publication_id,status,is_paid,sent_at) on app.applications to ${role};
      grant select(id,target_type,target_id,target_revision,owner_id,is_test,request_body) on app.payment_checkout_intents to ${role};
      grant select(intent_id,published_at,expires_at) on app.payment_fulfillments to ${role};
      grant update(auth_version) on app.users to ${role};
      grant update(last_seen_at) on app.sessions to ${role};
      grant insert,delete on app.auth_rate_limits to ${role}; grant update(attempts) on app.auth_rate_limits to ${role};
      grant insert,update(profile,updated_at) on app.cabinet_profiles to ${role}`);
    const owner=randomUUID(),peer=randomUUID(),token=randomBytes(32).toString('hex');
    for(const id of [owner,peer])await ownerDb.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
      [id,id+'@rollback.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
    const tokenHash=createHash('sha256').update(token).digest('hex');
    await ownerDb.query(`insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at)
      values($1,$2,'app',0,clock_timestamp()+interval '30 minutes')`,[tokenHash,owner]);
    const baseline='Синтетический Профиль',changed='Профиль После Обновления';
    await ownerDb.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:baseline,city:'Краснодар'}]);
    const listingId=(await ownerDb.query(`insert into app.listings(author_id,listing_type,title,description)
      values($1,'rent','Синтетическая аренда','Проверка совместимости чтения брони') returning id`,[peer])).rows[0].id;
    const bookingId=await (async()=>{
      await ownerDb.query('begin');
      try {
        await ownerDb.query("select set_config('blizhniy.booking_actor',$1,true)",[owner]);
        const result=await ownerDb.query(`insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot)
          values($1,$2,$3,'stay',current_date+3,current_date+4,1,100,$4) returning id`,
          [listingId,owner,randomUUID(),{title:'Синтетическая аренда'}]);
        await ownerDb.query('commit');
        return result.rows[0].id;
      }catch(error){await ownerDb.query('rollback');throw error;}
    })();
    await enableRefundFixtureTls(admin,{docker,container},ca,key,sameHost?undefined:dbHost);
    await writeFile(join(directory,'hosts'),`127.0.0.1 localhost${sameHost?'':' '+dbHost}\n`,{mode:0o600});
    await writeFile(join(directory,'mail-key'),randomBytes(32),{mode:0o600});
    relay=await start('/usr/bin/socat',[`UNIX-LISTEN:${join(directory,'pg.sock')},mode=0600,fork`,`TCP4:127.0.0.1:${config.port}`],
      {cwd:directory,env:{PATH:'/usr/bin:/bin'},log:join(evidence,evidencePhase+'-relay.log')});
    const fixture={directory,ca,evidence,phase:evidencePhase,password,ownerDb,sameHost,...(sameHost?{dbHost:'127.0.0.1'}:{}),
      rateSecret:randomBytes(32).toString('hex')};
    const customer={token,owner,peer,bookingId};
    const results=[await exerciseWeb(newWeb,fixture,{...customer,readsAs:baseline,writesAs:changed,guarded:sameHost})];
    if(oldWeb&&phase==='expanded')results.push(await exerciseWeb(oldWeb,fixture,{...customer,readsAs:changed,writesAs:baseline}));
    assert.deepEqual(await journal(),before);
    if(sameHost){
      results.push(await exerciseWeb(newWeb,fixture,{...customer,readsAs:changed,writesAs:baseline}));
      assert.equal(await passkeyCount(),retained);
      assert.deepEqual(await journal(),before);
      assert.deepEqual(await adminJournal(),restoredAdmin);
    }
    if(phase==='expanded')assert.deepEqual(await adminJournal(),restoredAdmin);
    await writeFile(join(evidence,evidencePhase+'-web-compatibility.json'),JSON.stringify({
      phase:evidencePhase,journal:before,adminJournal:restoredAdmin,web:results,networkNamespace:true,synthetic:true,
      ...(sameHost?{retainedPasskeys:retained}:{}),
    },null,2)+'\n',{mode:0o600,flag:'wx'});
  } finally {
    await relay?.stop();
    await ownerDb?.end();
    if(roleChanged)await admin.query(`alter role ${role} ${originalLogin.rolcanlogin?'login':'nologin'} password
      ${originalLogin.rolpassword===null?'null':pg.escapeLiteral(originalLogin.rolpassword)}`);
    if(created)await admin.query('drop database blizhniy_prod');
    await rm(directory,{recursive:true,force:true});
  }
}
