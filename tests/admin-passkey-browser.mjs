import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {generateRegistrationOptions,verifyRegistrationResponse} from '@simplewebauthn/server';
import pg from 'pg';
import {chromium} from 'playwright';
import {AdminPasskeyError,createAdminPasskeyOptions,verifyAdminPasskeyAssertion} from '../src/lib/admin-passkey.ts';
import {createAdminUserAccessPasskey} from '../src/lib/admin-user-access-passkey.ts';
import {createAdminPasskeyHandler} from '../src/lib/admin-passkey-http.ts';
import {callLocalAdminPasskey} from '../src/lib/admin-passkey-operator-client.ts';
import {generateSessionToken,hashSessionToken} from '../src/lib/identity.ts';
import {AdminPasskeyStore} from '../src/lib/postgres-admin-passkey.ts';
import {AdminPasskeyEnrollment,issueAdminPasskeyApproval} from '../src/lib/postgres-admin-passkey-enrollment.ts';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {startLocalUserAccessOperator} from '../scripts/local-user-access-operator.mjs';
import {startAdminPasskeyOperator} from '../scripts/admin-passkey-operator.mjs';
import {verifyAdminPasskeyDatabase} from '../scripts/admin-passkey-verifier-role.mjs';
import {createAdminArchivePasskey} from '../src/lib/admin-archive-passkey.ts';
import {authorizeReviewedAccountExport,reviewedAccountExportOptions} from '../scripts/prepare-approved-account-export.mjs';

const origin='https://admin.example.test';
const rpID=new URL(origin).hostname;
const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const require=createRequire(import.meta.url),ts=require('typescript');

async function withPostgres(work){
 const run=promisify(execFile),password=randomBytes(24).toString('hex');
 const name='blizhniy-passkey-'+randomBytes(8).toString('hex');
 const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
 const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
  env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1048576,
 })).stdout.trim();
 let container,owner,pool,verifierPool;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.test=admin-passkey','--memory','256m',
   '--tmpfs','/var/lib/postgresql:rw,size=134217728','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const info=JSON.parse(await docker(['inspect',container]))[0];
  assert.equal(info.Config.Labels['blizhniy.test'],'admin-passkey');
  const binding=info.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  for(const deadline=Date.now()+20000;;){
   try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}
   catch(error){if(Date.now()>deadline)throw error;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,connectionTimeoutMillis:2000};
  owner=new pg.Client(config);pool=new pg.Pool({...config,max:4});
  await owner.connect();
  for (const migration of ['migrations/0001-identity.sql','candidates/0089-admin-passkeys.sql']) {
   await owner.query(await readFile(new URL('../database/'+migration,import.meta.url),'utf8'));
  }
  const operatorPassword=randomBytes(24).toString('hex'),verifierPassword=randomBytes(24).toString('hex');
  await owner.query(await readFile(new URL('../database/candidates/0061-admin-user-access.sql',import.meta.url),'utf8'));
  await owner.query(`create role blizhniy_user_operator login noinherit password ${pg.escapeLiteral(operatorPassword)};
    create role blizhniy_passkey_verifier login noinherit connection limit 4 password ${pg.escapeLiteral(verifierPassword)};
    revoke all on database blizhniy_test from public;
    grant connect on database blizhniy_test to blizhniy_passkey_verifier,blizhniy_user_operator;
    grant usage on schema app_admin to blizhniy_user_operator;
    grant execute on function app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text) to blizhniy_user_operator`);
  const signature='app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
  const priorDefinition=(await owner.query('select pg_get_functiondef($1::regprocedure) as sql',[signature])).rows[0].sql;
  for(const migration of ['0090-user-access-passkey.sql','0091-admin-passkey-enrollment.sql','0092-admin-passkey-verifier.sql']){
   await owner.query(await readFile(new URL('../database/candidates/'+migration,import.meta.url),'utf8'));
  }
  verifierPool=new pg.Pool({...config,user:'blizhniy_passkey_verifier',password:verifierPassword,max:4,statement_timeout:4000,
   application_name:'blizhniy-passkey-verifier-test'});
  await work(owner,new PostgresDatabase(verifierPool),{config,operatorPassword,priorDefinition,ownerDb:new PostgresDatabase(pool)});
 }finally{
  await verifierPool?.end();
  await pool?.end();
  await owner?.end();
  if(container)await docker(['rm','-f',container]);
 }
}

test('administrator passkey assertions use the exact challenge, relying party, key and user verification',{timeout:30000},async suite=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().url()===origin+'/'
   ?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated admin passkey fixture</title>'})
   :route.abort());
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{
   protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,
  }});
  await page.goto(origin);
  const browserClientSource=await readFile(new URL('../src/lib/client-admin-passkey.ts',import.meta.url),'utf8');
  const browserClient=ts.transpileModule(browserClientSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  await page.addScriptTag({type:'module',content:browserClient+'\nglobalThis.fixturePasskeys=adminPasskeys;'});
  await page.waitForFunction(()=>!!globalThis.fixturePasskeys);
  await suite.test('passkey transport rejects a non-HTTPS origin and an oversized reply',async()=>{
   assert.throws(()=>createAdminPasskeyHandler({origin:'http://admin.example.test'},()=>assert.fail('runtime called')),AdminPasskeyError);
   const path=origin+'/api/admin/passkey';
   const oversized=route=>route.fulfill({contentType:'application/json',body:JSON.stringify({value:'x'.repeat(40000)})});
   await page.route(path,oversized);
   try{
    await assert.rejects(page.evaluate(code=>globalThis.fixturePasskeys.enroll(code),randomBytes(32).toString('base64url')),
     /Ответ сервера превышает допустимый размер/);
   }finally{await page.unroute(path,oversized);}
  });

  async function withPasskeyHttp(token,runtime,work){
   const path=origin+'/api/admin/passkey',events=[],requests=[];
   const operator=await startAdminPasskeyOperator(runtime,async()=>{});
   const handler=createAdminPasskeyHandler({origin},()=>({
    limiter:runtime.limiter??{allowProduction:async()=>true},
    execute:(session,command,signal)=>callLocalAdminPasskey(operator.socketPath,session,command,signal),
   }),event=>events.push(event));
   const intercept=async route=>{
    const request=route.request(),headers=await request.allHeaders();
    headers.host=rpID;headers['x-real-ip']='127.0.0.1';
    const body=request.postData()??'';
    requests.push(JSON.parse(body).action);
    const response=await handler(new Request(path,{method:request.method(),headers,body}));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   };
   await context.addCookies([{name:'__Host-blizhniy_session',value:token,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
   await page.route(path,intercept);
   try{await work({events,requests,handler,path,socketPath:operator.socketPath});}
   finally{
    try{await page.unroute(path,intercept);await context.clearCookies();}
    finally{await operator.close();}
   }
  }

  const create=options=>page.evaluate(async options=>(await navigator.credentials.create({
   publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(options),
  })).toJSON(),options);
  const enroll=async()=>{
   const handle=randomBytes(32),userHandle=handle.toString('base64url');
   const registration=await generateRegistrationOptions({rpID,rpName:'Local fixture',userID:handle,userName:'synthetic-admin',
    authenticatorSelection:{residentKey:'required',userVerification:'required'}});
   const created=await create(registration);
   const enrollment=await verifyRegistrationResponse({response:created,expectedChallenge:registration.challenge,expectedOrigin:origin,
    expectedRPID:rpID,requireUserVerification:true});
   assert.equal(enrollment.verified,true);
   return {credential:enrollment.registrationInfo.credential,userHandle};
  };
  const {credential,userHandle}=await enroll();
  const options=await createAdminPasskeyOptions(origin,[credential.id]);
  const get=options=>page.evaluate(async options=>(await navigator.credentials.get({
   publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(options),
  })).toJSON(),options);
  const assertion=await get(options);
  const args={origin,challenge:options.challenge,credential,userHandle,assertion};

  await suite.test('gets a verified user assertion and an updated authenticator counter',async()=>{
   assert.equal(options.rpId,rpID);
   assert.equal(options.userVerification,'required');
   assert.deepEqual(options.allowCredentials.map(item=>item.id),[credential.id]);
   assert.ok(await verifyAdminPasskeyAssertion(args)>credential.counter);
  });

  await suite.test('rejects a valid assertion for a different challenge, origin, credential or account',async()=>{
   const otherOptions=await createAdminPasskeyOptions(origin,[credential.id]);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,challenge:otherOptions.challenge}),AdminPasskeyError);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,origin:'https://admin.example.test:8443'}),AdminPasskeyError);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,origin:'https://other.example.test'}),AdminPasskeyError);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,credential:{...credential,id:randomBytes(32).toString('base64url')}}),AdminPasskeyError);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,userHandle:randomBytes(32).toString('base64url')}),AdminPasskeyError);
  });

  await suite.test('rejects reused nonzero authenticator counters and signatures without user verification',async()=>{
   const counter=await verifyAdminPasskeyAssertion(args);
   await assert.rejects(verifyAdminPasskeyAssertion({...args,credential:{...credential,counter}}),AdminPasskeyError);
   await cdp.send('WebAuthn.setUserVerified',{authenticatorId,isUserVerified:false});
   const unverified=await get({...options,userVerification:'discouraged'});
   await assert.rejects(verifyAdminPasskeyAssertion({...args,assertion:unverified}),AdminPasskeyError);
  });

  await suite.test('takes a current admin session and accepts one exact action in PostgreSQL',async()=>{
   await cdp.send('WebAuthn.setUserVerified',{authenticatorId,isUserVerified:true});
   await withPostgres(async(owner,db)=>{
    const actor=randomUUID(),token=generateSessionToken(),otherToken=generateSessionToken(),revokedToken=generateSessionToken();
    const passwordHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
    await owner.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,\'admin\',clock_timestamp())',
     [actor,'passkey-fixture@example.invalid',passwordHash]);
    await owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$4,0),($2,$4,0),($3,$4,0)',
     [hashSessionToken(token),hashSessionToken(otherToken),hashSessionToken(revokedToken),actor]);
    await owner.query('insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter) values($1,$2,$3,$4,$5)',
     [credential.id,actor,userHandle,Buffer.from(credential.publicKey),credential.counter]);
    await owner.query('create table public.test_effects(actor uuid not null); grant insert on public.test_effects to blizhniy_passkey_verifier');
    const store=new AdminPasskeyStore(db,origin);
    const action={kind:'user-access',digest:randomBytes(32).toString('hex')};
    const revokedSessionProof=await get(await store.begin(revokedToken,action));
    await owner.query('delete from app.sessions where token_hash=$1',[hashSessionToken(revokedToken)]);
    await assert.rejects(store.accept(revokedToken,action,revokedSessionProof,()=>assert.fail('revoked session accepted')),AdminPasskeyError);
    const proof=await get(await store.begin(token,action));
    await assert.rejects(owner.query(`insert into app_admin_passkey.challenges
     (session_hash,auth_version,kind,command_digest,credential_ids,challenge,expires_at)
     select $1,auth_version,kind,command_digest,credential_ids,challenge,expires_at
     from app_admin_passkey.challenges where session_hash=$2`,[hashSessionToken(otherToken),hashSessionToken(token)]),
     error=>error.code==='23505');
    const effect=(tx,id)=>tx.query('insert into public.test_effects(actor) values($1)',[id]);
    await assert.rejects(store.accept(otherToken,action,proof,effect),AdminPasskeyError);
    await assert.rejects(store.accept(token,{...action,digest:randomBytes(32).toString('hex')},proof,effect),AdminPasskeyError);
    await assert.rejects(store.accept(token,action,proof,async tx=>{
     await effect(tx,actor);throw Error('Synthetic rollback');
    }),/Synthetic rollback/);
    assert.equal((await owner.query('select actor from public.test_effects')).rowCount,0);
    const results=await Promise.allSettled([store.accept(token,action,proof,effect),store.accept(token,action,proof,effect)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.ok(results.find(result=>result.status==='rejected').reason instanceof AdminPasskeyError);
    assert.deepEqual((await owner.query('select actor from public.test_effects')).rows,[{actor}]);

    const expiring=await get(await store.begin(token,action));
    await owner.query("update app_admin_passkey.challenges set expires_at=clock_timestamp()+interval '1 second'");
    let entered=false;
    await assert.rejects(store.accept(token,action,expiring,async tx=>{
     entered=true;
     await tx.query('select pg_sleep(1.2)');
     await effect(tx,actor);
    }),AdminPasskeyError);
    assert.equal(entered,true);
    assert.equal((await owner.query('select actor from public.test_effects')).rowCount,1);

    const issued=await store.begin(token,action);
    const next=await enroll();
    await owner.query('insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter) values($1,$2,$3,$4,$5)',
     [next.credential.id,actor,next.userHandle,Buffer.from(next.credential.publicKey),next.credential.counter]);
    const addedAfterIssue=await get({...issued,allowCredentials:[{id:next.credential.id,type:'public-key'}]});
    await assert.rejects(store.accept(token,action,addedAfterIssue,effect),AdminPasskeyError);

    const revoked=await get(issued);
    await owner.query('update app_admin_passkey.credentials set revoked_at=clock_timestamp() where admin_id=$1',[actor]);
    await assert.rejects(store.accept(token,action,revoked,effect),AdminPasskeyError);
    await assert.rejects(store.begin(token,action),AdminPasskeyError);
    assert.equal((await owner.query('select actor from public.test_effects')).rowCount,1);
   });
  });

  await suite.test('the archive operator consumes one browser assertion for the reviewed case and active session',async()=>{
   await withPostgres(async(owner,db)=>{
    const actor=randomUUID(),subject=randomUUID(),token=generateSessionToken(),otherToken=generateSessionToken();
    const passwordHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
    await owner.query("insert into app.users(id,email,password_hash,role,email_verified_at) values($1,'actor@example.invalid',$2,'admin',clock_timestamp())",[actor,passwordHash]);
    await owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$3,0),($2,$3,0)',
     [hashSessionToken(token),hashSessionToken(otherToken),actor]);
    await owner.query('insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter) values($1,$2,$3,$4,$5)',
     [credential.id,actor,userHandle,Buffer.from(credential.publicKey),credential.counter]);
    const archive=createAdminArchivePasskey(new AdminPasskeyStore(db,origin));
    const caseId='TEST_EXPORT_002',command={caseId,expectedAdminId:actor};
    const details=['purpose','basis','methods','operatorName','operatorAddress','sources','recipients','retention',
     'rights','internationalTransfers','processors','safeguards','otherInformation'];
    const disclosure={processingConfirmed:true,...Object.fromEntries(details.map(key=>[key,'Synthetic fixture']))};
    const review={approval:{caseId,operatorId:actor,ownerId:subject,emailSha256:'a'.repeat(64)},disclosure};
    await withPasskeyHttp(token,{archive},async({handler,path,socketPath})=>{
     const approve=(session,input)=>callLocalAdminPasskey(socketPath,session,input);
     await assert.rejects(reviewedAccountExportOptions({caseId,operatorToken:token},
      {...review,approval:{...review.approval,operatorId:randomUUID()}},approve),{code:'PASSKEY_REQUIRED'});
     const exportPath=origin+'/api/admin/account-export';
     const exportHandler=loadLocalPrimaryModule('admin-account-export-http').createAdminAccountExportHandler({origin},()=>({
      allow:async()=>true,resolve:async session=>session===token?{id:actor,role:'admin'}:null,
     }),(caseId,operatorToken)=>reviewedAccountExportOptions({caseId,operatorToken},review,approve));
     const intercept=async route=>{
      const request=route.request(),headers=await request.allHeaders();
      headers.host=rpID;headers['x-real-ip']='127.0.0.1';
      const response=await exportHandler(new Request(exportPath,{method:'POST',headers,body:request.postData()}));
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
     };
     await page.route(exportPath,intercept);
     let credential;
     try{credential=await page.evaluate(command=>globalThis.fixturePasskeys.archiveAssertion(command),command);}
     finally{await page.unroute(exportPath,intercept);}
     const frame={caseId,operatorToken:token,credential};
     const publicApproval=await handler(new Request(path,{method:'POST',headers:{host:rpID,origin,'content-type':'application/json',
      'x-real-ip':'127.0.0.1','x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+token},
      body:JSON.stringify({action:'archive-approve',command:{...command,reviewDigest:'0'.repeat(64)},credential})}));
     assert.equal(publicApproval.status,422);
     await assert.rejects(authorizeReviewedAccountExport({...frame,operatorToken:otherToken},review,approve),{code:'PASSKEY_REQUIRED'});
     await assert.rejects(authorizeReviewedAccountExport({...frame,caseId:'TEST_EXPORT_003'},
      {...review,approval:{...review.approval,caseId:'TEST_EXPORT_003'}},approve),{code:'PASSKEY_REQUIRED'});
     await assert.rejects(authorizeReviewedAccountExport(frame,
      {...review,approval:{...review.approval,ownerId:randomUUID()}},approve),{code:'PASSKEY_REQUIRED'});
     await assert.rejects(authorizeReviewedAccountExport(frame,
      {...review,approval:{...review.approval,emailSha256:'b'.repeat(64)}},approve),{code:'PASSKEY_REQUIRED'});
     await assert.rejects(authorizeReviewedAccountExport(frame,
      {...review,disclosure:{...review.disclosure,retention:'Changed synthetic retention'}},approve),{code:'PASSKEY_REQUIRED'});
     const authorizations=await Promise.allSettled([
      authorizeReviewedAccountExport(frame,review,approve),authorizeReviewedAccountExport(frame,review,approve),
     ]);
     assert.equal(authorizations.filter(item=>item.status==='fulfilled').length,1);
     await assert.rejects(authorizeReviewedAccountExport(frame,review,approve),{code:'PASSKEY_REQUIRED'});
    });
   });
  });

  await suite.test('owner authorization enrolls an administrator key once and recovers with an atomic replacement',async()=>{
   await withPostgres(async(owner,db)=>{
    await verifyAdminPasskeyDatabase(db,{database:'blizhniy_test'});
    await owner.query('grant select(password_hash) on app.users to blizhniy_passkey_verifier');
    try{await assert.rejects(verifyAdminPasskeyDatabase(db,{database:'blizhniy_test'}),/preflight failed/);}
    finally{await owner.query('revoke select(password_hash) on app.users from blizhniy_passkey_verifier');}
    await owner.query('grant usage on schema app_admin_passkey to public');
    try{await assert.rejects(verifyAdminPasskeyDatabase(db,{database:'blizhniy_test'}),/preflight failed/);}
    finally{await owner.query('revoke usage on schema app_admin_passkey from public');}
    const actor=randomUUID(),peer=randomUUID(),ordinary=randomUUID();
    const token=generateSessionToken(),otherToken=generateSessionToken(),peerToken=generateSessionToken();
    const passwordHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
    await owner.query(`insert into app.users(id,email,password_hash,role,email_verified_at) values
     ($1,'actor@example.invalid',$4,'admin',clock_timestamp()),($2,'peer@example.invalid',$4,'admin',clock_timestamp()),
     ($3,'ordinary@example.invalid',$4,'user',clock_timestamp())`,[actor,peer,ordinary,passwordHash]);
    await owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$4,0),($2,$4,0),($3,$5,0)',
     [hashSessionToken(token),hashSessionToken(otherToken),hashSessionToken(peerToken),actor,peer]);
    const enrollment=new AdminPasskeyEnrollment(db,origin);
    const status=()=>owner.query('select id,user_handle,revoked_at from app_admin_passkey.credentials where admin_id=$1 order by created_at',[actor])
     .then(result=>result.rows);
    await owner.query('create role fixture_web nologin; set role fixture_web');
    try{await assert.rejects(issueAdminPasskeyApproval(owner,actor,origin,'add'),error=>error.code==='42501');}
    finally{await owner.query('reset role');}
    const forbidden=error=>error.code==='42501';
    await assert.rejects(issueAdminPasskeyApproval(db,actor,origin,'add'),forbidden);
    await assert.rejects(db.query('select password_hash from app.users'),forbidden);
    await assert.rejects(db.query('select token_hash from app.sessions'),forbidden);
    await assert.rejects(db.query('update app.users set role=role where false'),forbidden);
    await assert.rejects(db.query('select code_hash from app_admin_passkey.enrollments'),forbidden);
    await assert.rejects(db.query('select * from app_admin_passkey.user_access_permits'),forbidden);
    await assert.rejects(db.query("select app_admin.user_access(null,null,'inspect',null,null,null,null,null,null)"),forbidden);
    await assert.rejects(db.query('insert into app_admin_passkey.credentials(id) select id from app_admin_passkey.credentials where false'),forbidden);
    await assert.rejects(db.query('update app_admin_passkey.credentials set revoked_at=null where false'),forbidden);
    await assert.rejects(issueAdminPasskeyApproval(owner,ordinary,origin,'add'),AdminPasskeyError);
    const code=await issueAdminPasskeyApproval(owner,actor,origin,'add');
    assert.match(code,/^[A-Za-z0-9_-]{43}$/);
    await owner.query('set role blizhniy_passkey_verifier');
    try{
     const inherited=await owner.query('select * from app_admin_passkey.session_state($1,false)',[hashSessionToken(token)]);
     assert.equal(inherited.rowCount,0);
    }finally{await owner.query('reset role');}
    await assert.rejects(enrollment.begin(token,randomBytes(32).toString('base64url')),AdminPasskeyError);
    await assert.rejects(enrollment.begin(peerToken,code),AdminPasskeyError);
    await assert.rejects(new AdminPasskeyEnrollment(db,'https://another.example.test').begin(token,code),AdminPasskeyError);
    const options=await enrollment.begin(token,code);
    const registered=await create(options);
    await assert.rejects(enrollment.finish(otherToken,code,registered),AdminPasskeyError);
    const finished=await Promise.allSettled([enrollment.finish(token,code,registered),enrollment.finish(token,code,registered)]);
    assert.equal(finished.filter(result=>result.status==='fulfilled').length,1);
    assert.deepEqual(await status(),[{id:registered.id,user_handle:options.user.id,revoked_at:null}]);
    await assert.rejects(enrollment.begin(token,code),AdminPasskeyError);

    const store=new AdminPasskeyStore(db,origin);
    const action={kind:'user-access',digest:randomBytes(32).toString('hex')};
    const oldOptions=await store.begin(token,action);
    const oldProof=await get(oldOptions);
    const recoveryAuth=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{
     protocol:'ctap2',transport:'usb',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,
    }});
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId,enabled:false});
    try{
     const expiringCode=await issueAdminPasskeyApproval(owner,actor,origin,'replace');
     const expiredCredential=await create(await enrollment.begin(token,expiringCode));
     await owner.query("update app_admin_passkey.enrollments set challenge_expires_at=clock_timestamp()-interval '1 second' where admin_id=$1",[actor]);
     await assert.rejects(enrollment.finish(token,expiringCode,expiredCredential),AdminPasskeyError);
     const sessionCode=await issueAdminPasskeyApproval(owner,actor,origin,'replace');
     const revokedSessionCredential=await create(await enrollment.begin(otherToken,sessionCode));
     await owner.query('delete from app.sessions where token_hash=$1',[hashSessionToken(otherToken)]);
     await assert.rejects(enrollment.finish(otherToken,sessionCode,revokedSessionCredential),AdminPasskeyError);
     assert.deepEqual(await status(),[{id:registered.id,user_handle:options.user.id,revoked_at:null}]);

     const cancelledCode=await issueAdminPasskeyApproval(owner,actor,origin,'replace');
     const recoveryCode=await issueAdminPasskeyApproval(owner,actor,origin,'replace');
     await assert.rejects(enrollment.begin(token,cancelledCode),AdminPasskeyError);
     const recoveryOptions=await enrollment.begin(token,recoveryCode);
     assert.equal(recoveryOptions.user.id,options.user.id);
     assert.deepEqual(recoveryOptions.excludeCredentials.map(key=>key.id),[registered.id]);
     const replacement=await create(recoveryOptions);
     await enrollment.finish(token,recoveryCode,replacement);
     const keyRows=await status();
     assert.equal(keyRows.length,2);
     assert.equal(keyRows[0].id,registered.id);
     assert.ok(keyRows[0].revoked_at instanceof Date);
     assert.deepEqual(keyRows[1],{id:replacement.id,user_handle:options.user.id,revoked_at:null});
     await assert.rejects(store.accept(token,action,oldProof,()=>assert.fail('replaced key accepted')),AdminPasskeyError);
     const nextOptions=await store.begin(token,action);
     assert.deepEqual(nextOptions.allowCredentials.map(key=>key.id),[replacement.id]);
     const nextProof=await get(nextOptions);
     assert.equal(await store.accept(token,action,nextProof,async (_tx,id)=>id),actor);
     const extraCode=await issueAdminPasskeyApproval(owner,actor,origin,'replace');
     await cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId,enabled:true});
     await cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId:recoveryAuth.authenticatorId,enabled:false});
     let allowed=false;
     await withPasskeyHttp(token,{enrollment,limiter:{allowProduction:async()=>allowed}},async ({requests,events,handler,path})=>{
      const validHeaders={host:rpID,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1'};
      const body=JSON.stringify({action:'enroll-options',code:extraCode});
      const issue=headers=>handler(new Request(path,{method:'POST',headers,body}));
      assert.equal((await issue({...validHeaders,origin:'https://different.example.test'})).status,403);
      assert.equal((await issue(validHeaders)).status,401);
      assert.equal((await issue({...validHeaders,'content-length':'40000'})).status,413);
      const limited=await issue({...validHeaders,cookie:'__Host-blizhniy_session='+token});
      assert.equal(limited.status,429);
      assert.equal(limited.headers.get('retry-after'),'900');
      allowed=true;
      await page.evaluate(code=>globalThis.fixturePasskeys.enroll(code),extraCode);
      assert.deepEqual(requests,['enroll-options','enroll-finish']);
      assert.deepEqual(events.map(event=>event.status),[403,401,413,429,200,200]);
      assert.equal(JSON.stringify(events).includes(extraCode),false);
      assert.equal((await status()).filter(row=>row.revoked_at===null).length,1);
     });
    }finally{
     await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:recoveryAuth.authenticatorId});
     await cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId,enabled:true});
    }
   });
  });

  await suite.test('the PostgreSQL user operator requires an unexpired approval for the exact access change',async()=>{
   await withPostgres(async(owner,db,{config,operatorPassword,priorDefinition,ownerDb})=>{
    const actor=randomUUID(),target=randomUUID(),token=generateSessionToken(),otherToken=generateSessionToken(),expiringToken=generateSessionToken();
    const verifierExpiringToken=generateSessionToken();
    const passwordHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
    await owner.query(`insert into app.users(id,email,password_hash,role,email_verified_at)
     values($1,'actor@example.invalid',$3,'admin',clock_timestamp()),($2,'target@example.invalid',$3,'user',clock_timestamp())`,
     [actor,target,passwordHash]);
    await owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$5,0),($2,$5,0),($3,$5,0),($4,$5,0)',
     [hashSessionToken(token),hashSessionToken(otherToken),hashSessionToken(expiringToken),hashSessionToken(verifierExpiringToken),actor]);
    await owner.query('insert into app_admin_passkey.credentials(id,admin_id,user_handle,public_key,counter) values($1,$2,$3,$4,$5)',
     [credential.id,actor,userHandle,Buffer.from(credential.publicKey),credential.counter]);
    const definition=()=>owner.query(`select pg_get_functiondef(
     'app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)'::regprocedure) as sql`).then(row=>row.rows[0].sql);
    const operator=new pg.Pool({...config,user:'blizhniy_user_operator',password:operatorPassword,max:3,statement_timeout:4000,
     application_name:'blizhniy-passkey-role-test'});
    let server;
    try{
     const {PostgresAdminUserAccess}=loadLocalPrimaryModule('postgres-admin-user-access');
     const {callLocalUserAccessOperator}=loadLocalPrimaryModule('local-user-access-operator-client');
     const access=new PostgresAdminUserAccess(new PostgresDatabase(operator));
     server=await startLocalUserAccessOperator({
      execute:(session,operation)=>access.execute(session,operation),close:async()=>{},
     });
     const input={id:randomUUID(),targetId:target,expectedVersion:'0',role:'admin',isBlocked:false,reason:'Контроль смены роли'};
     const command={action:'change',expectedAdminId:actor,input};
     const passkey=createAdminUserAccessPasskey(new AdminPasskeyStore(db,origin));
     const sql='select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9) as result';
     const call=(session,operation)=>callLocalUserAccessOperator(server.socketPath,session,operation);
     const change=(entry=input,session=token)=>call(session,{...command,input:entry});
     const status=()=>owner.query('select role,auth_version from app.users where id=$1',[target]).then(result=>result.rows[0]);
     const recover=()=>call(token,{action:'recover',expectedAdminId:actor,targetId:target,id:input.id});
     const denied=error=>error.code==='PASSKEY_REQUIRED';
     async function waitForLock(applicationName){
      for(const deadline=Date.now()+1000;;){
       const waiting=await ownerDb.query(
        "select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",[applicationName]);
       if(waiting.rowCount)return;
       assert.ok(Date.now()<deadline,'fixture did not reach the credential lock');
       await new Promise(resolve=>setTimeout(resolve,20));
      }
     }
     assert.equal((await recover()).receipt,null);
     await assert.rejects(change(),denied);
     await assert.rejects(operator.query(sql.replace('user_access','user_access_before_passkey'),[
      hashSessionToken(token),actor,'change',target,input.id,input.expectedVersion,input.role,input.isBlocked,input.reason,
     ]),error=>error.code==='42501');
     await assert.rejects(operator.query('select * from app_admin_passkey.user_access_permits'),error=>error.code==='42501');

     const hash=hashSessionToken(verifierExpiringToken);
     await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1",[hash]);
     await owner.query('begin');
     let verifierExpiryResult;
     try{
      await owner.query('select id from app_admin_passkey.credentials where id=$1 for update',[credential.id]);
      const operands=JSON.stringify([actor,target,input.id,input.expectedVersion,input.role,input.isBlocked,input.reason]);
      verifierExpiryResult=db.query('select app_admin_passkey.store_access_permit($1,0,$2,$3::jsonb)',[hash,credential.id,operands])
       .then(value=>({value}),error=>({error}));
      await waitForLock('blizhniy-passkey-verifier-test');
      await owner.query('select pg_sleep(2.1)');
     }finally{await owner.query('rollback');}
     assert.equal((await verifierExpiryResult).error?.code,'PAP01');
     assert.equal((await owner.query('select 1 from app_admin_passkey.user_access_permits where session_hash=$1',[hash])).rowCount,0);

     await withPasskeyHttp(token,{access:passkey},async ({requests})=>{
      await page.evaluate(command=>globalThis.fixturePasskeys.approveAccess(command),command);
      assert.deepEqual(requests,['access-options','access-approve']);
     });
     await assert.rejects(change(input,otherToken),denied);
     await assert.rejects(change({...input,reason:'Иная причина для той же операции'}),denied);
     assert.deepEqual(await status(),{role:'user',auth_version:'0'});
     const results=await Promise.allSettled([change(),change()]);
     assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
     assert.deepEqual(await status(),{role:'admin',auth_version:'1'});
     assert.equal((await recover()).receipt.id,input.id);
     await assert.rejects(change(),denied);

     const next={...input,id:randomUUID(),expectedVersion:'1',role:'user'};
     const nextCommand={...command,input:next};
     await passkey.approve(token,nextCommand,await get(await passkey.begin(token,nextCommand)));
     await owner.query(`create function public.test_wait_before_receipt() returns trigger language plpgsql set search_path=pg_catalog as
      $$ begin perform pg_sleep(1.2); return new; end; $$;
      create trigger test_wait_before_receipt before insert on app_admin.user_changes
        for each row execute function public.test_wait_before_receipt()`);
     try{
      await owner.query("update app_admin_passkey.user_access_permits set expires_at=clock_timestamp()+interval '1 second'");
      await assert.rejects(change(next),denied);
      assert.deepEqual(await status(),{role:'admin',auth_version:'1'});
      assert.equal((await owner.query('select id from app_admin.user_changes')).rowCount,1);
     }finally{
      await owner.query('drop trigger test_wait_before_receipt on app_admin.user_changes; drop function public.test_wait_before_receipt()');
     }

     await passkey.approve(expiringToken,nextCommand,await get(await passkey.begin(expiringToken,nextCommand)));
     await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1",
      [hashSessionToken(expiringToken)]);
     await owner.query('begin');
     let expiryResult;
     try{
      await owner.query('select id from app_admin_passkey.credentials where id=$1 for update',[credential.id]);
      expiryResult=change(next,expiringToken).then(value=>({value}),error=>({error}));
      await waitForLock('blizhniy-passkey-role-test');
      await owner.query('select pg_sleep(2.1)');
     }finally{await owner.query('rollback');}
     assert.equal((await expiryResult).error?.code,'PASSKEY_REQUIRED');
     assert.deepEqual(await status(),{role:'admin',auth_version:'1'});

     await passkey.approve(token,nextCommand,await get(await passkey.begin(token,nextCommand)));
     await owner.query('update app_admin_passkey.credentials set revoked_at=clock_timestamp() where id=$1',[credential.id]);
     await assert.rejects(change(next),denied);
     assert.deepEqual(await status(),{role:'admin',auth_version:'1'});
     assert.equal((await owner.query('select id from app_admin.user_changes')).rowCount,1);
     await server.close();server=undefined;
     await owner.query(await readFile(new URL('../database/candidates/0092-admin-passkey-verifier.down.sql',import.meta.url),'utf8'));
     assert.equal((await owner.query('select id from app_admin_passkey.credentials')).rowCount,1);
     await assert.rejects(db.query('select id from app_admin_passkey.credentials'),error=>error.code==='42501');
     await owner.query(await readFile(new URL('../database/candidates/0090-user-access-passkey.down.sql',import.meta.url),'utf8'));
     assert.equal(await definition(),priorDefinition);
     assert.deepEqual(await status(),{role:'admin',auth_version:'1'});
     assert.deepEqual((await owner.query('select id from app_admin.user_changes')).rows,[{id:input.id}]);
    }finally{
     try{await server?.close();}finally{await operator.end();}
    }
   });
  });
 }finally{await browser.close();}
});

test('administrator passkey options require enrolled credentials and a canonical HTTPS origin',async()=>{
 await assert.rejects(createAdminPasskeyOptions(origin,[]),AdminPasskeyError);
 for(const invalid of ['http://admin.example.test',origin+'/cabinet','https://a:b@admin.example.test',origin+'?query'])
  await assert.rejects(createAdminPasskeyOptions(invalid,['b2ZmLXNpdGU']),AdminPasskeyError);
});

test('abandoned Unix requests retain their verifier slots until the database work settles',{timeout:10000},async()=>{
 let active=0,start,release,finish;
 const allStarted=new Promise(resolve=>{start=resolve;}),work=new Promise(resolve=>{release=resolve;});
 const allFinished=new Promise(resolve=>{finish=resolve;});
 const operator=await startAdminPasskeyOperator({enrollment:{async begin(){
  active++;if(active===4)start();
  await work;active--;if(active===0)finish();
  return {challenge:'a'.repeat(43)};
 }}},async()=>{});
 try{
  const token=generateSessionToken(),command={action:'enroll-options',code:randomBytes(32).toString('base64url')};
  const cancellation=Array.from({length:4},()=>new AbortController());
  const abandoned=cancellation.map(controller=>
   callLocalAdminPasskey(operator.socketPath,token,command,controller.signal).then(()=>false,()=>true));
  await allStarted;
  cancellation.forEach(controller=>controller.abort());
  assert.deepEqual(await Promise.all(abandoned),[true,true,true,true]);
  await assert.rejects(callLocalAdminPasskey(operator.socketPath,token,command),/unavailable/);
  assert.equal(active,4);
  release();
  await allFinished;
  assert.deepEqual(await callLocalAdminPasskey(operator.socketPath,token,command),{options:{challenge:'a'.repeat(43)}});
 }finally{release();await operator.close();}
});

test('a malformed success reply is reported as unavailability through the passkey HTTP route',async()=>{
 const handler=createAdminPasskeyHandler({origin},()=>({
  limiter:{allowProduction:async()=>true},execute:async()=>({status:'unexpected'}),
 }),()=>{});
 const response=await handler(new Request(origin+'/api/admin/passkey',{
  method:'POST',headers:{host:rpID,origin,'content-type':'application/json','x-real-ip':'127.0.0.1',
   'x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+generateSessionToken()},
  body:JSON.stringify({action:'enroll-options',code:randomBytes(32).toString('base64url')}),
 }));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:{code:'PASSKEY_UNAVAILABLE'}});
});

test('disabled TEST refunds issue no challenge and public HTTP cannot consume a refund assertion',async()=>{
 const handler=createAdminPasskeyHandler({origin,refundOptions:()=>false},
  ()=>assert.fail('The private verifier was invoked'),()=>{});
 const command={action:'approve',expectedAdminId:randomUUID(),
  input:{id:randomUUID(),paymentIntentId:randomUUID(),reason:'Synthetic fixture'}};
 const credential={id:'fixture_key',rawId:'fixture_key',type:'public-key',
  response:{clientDataJSON:'fixture',authenticatorData:'fixture',signature:'fixture'}};
 const send=(body)=>handler(new Request(origin+'/api/admin/passkey',{
  method:'POST',headers:{host:rpID,origin,'content-type':'application/json','x-real-ip':'127.0.0.1',
   'x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+generateSessionToken()},
  body:JSON.stringify(body),
 }));
 assert.equal((await send({action:'refund-options',command})).status,404);
 assert.equal((await send({action:'refund-approve',command,credential})).status,422);
});
