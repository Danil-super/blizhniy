import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import ts from 'typescript';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {buildAdminPasskeyOperator} from '../scripts/build-admin-passkey-operator.mjs';
import {startAdminPasskeyOperator} from '../scripts/admin-passkey-operator.mjs';
import {createAdminPasskeyHandler} from '../src/lib/admin-passkey-http.ts';
import {callLocalAdminPasskey} from '../src/lib/admin-passkey-operator-client.ts';
import {createAdminRefundPasskey} from '../src/lib/admin-refund-passkey.ts';
import {AdminPasskeyStore} from '../src/lib/postgres-admin-passkey.ts';
import {AdminPasskeyEnrollment} from '../src/lib/postgres-admin-passkey-enrollment.ts';
import {productionAuthOrigin} from '../src/lib/production-auth-config.ts';
import {seedHostedRefundCommand} from './hosted-refund-workflow-cases.mjs';
import {provider} from './refund-worker-role-cases.mjs';

export async function testHostedRefundPasskey({admin,config,load,directory,PostgresDatabase,profiles,verifierPassword}){
 const merchant={shopId:'900000161',secretKey:'test_guarded_fixture',isTest:true};
 const {item,reviewer}=await seedHostedRefundCommand(admin,load,merchant);
 const approvalId=randomUUID();
 const command={action:'approve',expectedAdminId:reviewer.id,input:{id:approvalId,paymentIntentId:item.id,reason:'Синтетическая проверка ключа'}};
 const remote=provider(item,approvalId,merchant);
 const origin=productionAuthOrigin,rpID=new URL(origin).hostname;
 const operatorProfile=profiles.find(entry=>entry.role==='blizhniy_refund_operator');
 const workerProfile=profiles.find(entry=>entry.role==='blizhniy_refund_worker');
 const connect=(user,password)=>new pg.Pool({...config,user,password,max:2});
 const verifierDb=new PostgresDatabase(connect('blizhniy_passkey_verifier',verifierPassword));
 const issuerDb=new PostgresDatabase(connect(config.user,config.password));
 const workerDb=new PostgresDatabase(connect(workerProfile.role,workerProfile.password));
 const fetches=[];
 let browser,verifier,operator,runtime,offline=false;
 try{
  const passkeyPackage=join(directory,'passkey-verifier');
  buildAdminPasskeyOperator(passkeyPackage);
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(passkeyPackage,'node_modules'),'dir');
  const {checkReviewedAdminPasskeyIssuer,issueReviewedAdminPasskeyCode}=await import(
   pathToFileURL(join(passkeyPackage,'scripts/issue-admin-passkey.mjs')).href);
  await checkReviewedAdminPasskeyIssuer(issuerDb,config.database);
  const enrollmentRequest={adminId:reviewer.id,database:config.database,mode:'add'};
  await assert.rejects(issueReviewedAdminPasskeyCode(verifierDb,enrollmentRequest),/issuer unavailable/);
  await assert.rejects(issueReviewedAdminPasskeyCode(issuerDb,{...enrollmentRequest,database:'postgres'}),/issuer unavailable/);
  const enrollmentCode=await issueReviewedAdminPasskeyCode(issuerDb,enrollmentRequest);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(enrollmentCode));
  const enrollmentRecord=(await admin.query('select code_hash,origin from app_admin_passkey.enrollments where admin_id=$1',[reviewer.id])).rows[0];
  assert.equal(enrollmentRecord.origin,origin);
  assert.ok(/^[a-f0-9]{64}$/.test(enrollmentRecord.code_hash));
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().url()===origin+'/'
   ?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Refund fixture</title>'}):route.abort());
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{
   protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,
   isUserVerified:true,automaticPresenceSimulation:true,
  }});
  await page.goto(origin);
  verifier=await startAdminPasskeyOperator({enrollment:new AdminPasskeyEnrollment(verifierDb,origin),
   refund:createAdminRefundPasskey(new AdminPasskeyStore(verifierDb,origin))},async()=>{});
  const check=(token,input)=>callLocalAdminPasskey(verifier.socketPath,token,input);
  const artifact=join(directory,'refund-operator');
  buildRefundOperator(artifact,{schema:87});
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const script=name=>import(pathToFileURL(join(artifact,'scripts',name)).href);
  const {createHostedRefundOperatorRuntime}=await script('local-refund-operator-runtime.mjs');
  const {startLocalRefundOperatorServer}=await script('local-refund-operator-server.mjs');
  const {verifyRefundOperatorDatabase}=await script('refund-operator-role.mjs');
  const require=createRequire(join(artifact,'package.json'));
  const loadModules=()=>({
   ...Object.assign({},...['postgres','postgres-refund-approvals','primary-refund-recovery','refund-merchant-preflight',
    'placement-refund-approval','listing-draft-contract','identity','postgres-admin-refund-journal']
    .map(name=>require('./compiled/lib/'+name+'.js'))),
   verifyRefundOperatorDatabase,Pool:pg.Pool,
   readPostgresConfig:()=>({...config,user:operatorProfile.role,password:operatorProfile.password}),
   async authorizeRefundPasskey(token,command,credential){
    assert.equal((await check(token,{action:'refund-approve',command,credential})).status,'approved');
   },
  });
  runtime=await createHostedRefundOperatorRuntime({
   NODE_ENV:'production',BLIZHNIY_REFUND_OPERATOR:'hosted-passkey-test-v1',BLIZHNIY_ADMIN_PASSKEYS:'hosted-v1',
   BLIZHNIY_DB_PLACEMENT:'same-host',BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:'5432',
   BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:operatorProfile.role,BLIZHNIY_DB_PASSWORD:operatorProfile.password,
   BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/fixture/ca.pem',
   BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:merchant.secretKey,
  },{loadModules,fetcher:async(url,init)=>{
   assert.equal(init.method,'GET');
   fetches.push(String(url));assert.equal(offline,false,'No provider request on readback');
   return String(url).endsWith('/v3/me')
    ?Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization:{enabled:false}})
    :remote.fetcher(url,init);
  }});
  operator=await startLocalRefundOperatorServer(runtime);
  const {AuthRequestError}=load('auth-http');
  const forward=(token,command,_signal,credential)=>new Promise((resolve,reject)=>{
   const outgoing=request({socketPath:operator.socketPath,hostname:'refund-operator.invalid',path:'/command',method:'POST',agent:false,
    headers:{'Content-Type':'application/json'}},incoming=>{
    let response='';incoming.setEncoding('utf8');incoming.on('data',chunk=>{response+=chunk;});incoming.on('error',reject);
    incoming.on('end',()=>{
     const value=JSON.parse(response);
     if(incoming.statusCode===200)resolve(value);
     else if(incoming.statusCode===403)reject(new AuthRequestError(403,value.error.code));
     else reject(Error('Fixture refund request failed'));
    });
   });outgoing.on('error',reject);outgoing.end(JSON.stringify({shopId:merchant.shopId,token,command,credential}));
  });
  const limiter={allowProduction:async()=>true};
  const passkeyHandler=createAdminPasskeyHandler({origin,refundOptions:()=>true},()=>({limiter,execute:check}),()=>{});
  const refundHandler=load('admin-refund-http').createAdminRefundHandler({origin,passkey:true},()=>({limiter,command:forward}),()=>{});
  const header={host:rpID,origin,'x-real-ip':'127.0.0.1','x-blizhniy-request':'1','content-type':'application/json',
   cookie:'__Host-blizhniy_session='+reviewer.token};
  const refund=(command,credential)=>refundHandler(new Request(origin+'/api/admin/refunds',{
   method:'POST',headers:header,body:JSON.stringify({...command,credential}),
  }));
  await context.addCookies([{name:'__Host-blizhniy_session',value:reviewer.token,url:origin,httpOnly:true,secure:true}]);
  await page.route(origin+'/api/admin/passkey',async route=>{
   const response=await passkeyHandler(new Request(origin+'/api/admin/passkey',{
    method:'POST',headers:header,body:route.request().postData(),
   }));
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const source=await readFile(new URL('../src/lib/client-admin-passkey.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  await page.addScriptTag({type:'module',content:compiled+'\nglobalThis.refundKey=adminPasskeys;'});
  await page.waitForFunction(()=>!!globalThis.refundKey);
  await page.evaluate(code=>globalThis.refundKey.enroll(code),enrollmentCode);
  assert.equal((await admin.query('select 1 from app_admin_passkey.credentials where admin_id=$1 and revoked_at is null',[reviewer.id])).rowCount,1);
  assert.equal((await admin.query('select 1 from app_admin_passkey.enrollments where admin_id=$1',[reviewer.id])).rowCount,0);
  await assert.rejects(page.evaluate(code=>globalThis.refundKey.enroll(code),enrollmentCode),/недействителен/);
  const proof=command=>page.evaluate(command=>globalThis.refundKey.refundAssertion(command),command);
  await assert.rejects(forward(reviewer.token,command),{code:'PASSKEY_REQUIRED'});
  assert.equal((await refund(command)).status,403);
  const assertion=await proof(command);
  assert.equal((await refund({...command,input:{...command.input,reason:'Изменённая причина'}},assertion)).status,403);
  assert.equal(fetches.length,0);
  const accepted=await refund(command,assertion);
  assert.equal(accepted.status,200);const approval=await accepted.json();
  assert.equal(approval.id,approvalId);assert.equal(approval.amount,item.amount);
  assert.equal((await refund(command,assertion)).status,403);
  assert.deepEqual(await (await refund({action:'read',expectedAdminId:reviewer.id,input:approvalId})).json(),approval);
  const worker=load('placement-refund-worker').createPlacementRefundWorker(workerDb,{...merchant,marqueeRefunds:true,specialistRefunds:true},
   async(url,init)=>{
    if(init.method==='GET'&&String(url).includes('/v3/refunds/'))throw Error('Synthetic interrupted refund lookup');
    return remote.fetcher(url,init);
   });
  assert.deepEqual(await worker.tick(),{state:'deferred',code:'processing_unavailable'});
  const candidate=(await admin.query('select provider_refund_id from app.payment_refund_candidates where operation_id=$1',[approvalId])).rows[0];
  assert.ok(candidate);
  const recovery={action:'recover',expectedAdminId:reviewer.id,input:{
   id:randomUUID(),operationId:approvalId,providerRefundId:candidate.provider_refund_id,reason:'Синтетическая сверка',
  }};
  assert.equal((await refund(recovery)).status,403);
  assert.equal((await admin.query('select 1 from app.payment_refund_recovery_actions where action_id=$1',[recovery.input.id])).rowCount,0);
  const applied=await refund(recovery,await proof(recovery));
  assert.equal(applied.status,200);const receipt=await applied.json();
  assert.equal(receipt.state,'applied');
  const before=fetches.length;offline=true;
  const readback=await refund(recovery);
  assert.equal(readback.status,200);assert.deepEqual(await readback.json(),receipt);
  assert.equal(fetches.length,before);assert.equal(remote.posts(),1);
  assert.equal((await admin.query('select 1 from app.payment_refund_effects where operation_id=$1',[approvalId])).rowCount,1);
 }finally{
  if(operator)await operator.close();else await runtime?.close();
  await verifier?.close();await browser?.close();await verifierDb.close();await issuerDb.close();await workerDb.close();
 }
}
