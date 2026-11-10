import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {createWorkOwnerActionsHandler}=load('work-owner-actions-http'),{createWorkOwnerActionsClient}=load('client-work-owner-actions');
const owner='10000000-0000-4000-8000-000000000001',operationId='10000000-0000-4000-8000-000000000002',publicationId='10000000-0000-4000-8000-000000000003',origin='https://actions.example.invalid';
const input={operationId,publicationId,kind:'workRequest',expectedRevision:'9007199254740993',action:'withdraw',reason:'Работы больше не требуются.'};
const result={...input,ownerId:owner,resultingRevision:'9007199254740994',status:'archived',occurredAt:'2026-11-10T10:00:00.000001Z'};
function request(body={...input,expectedOwnerId:owner},headers={}){return new Request(origin+'/api/account/work-actions',{method:'POST',headers:{host:'actions.example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.1',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},body:JSON.stringify(body)});}
test('work actions reject forged authority/financial input, foreign origin and missing cookie before runtime',async()=>{
 let calls=0;const handler=createWorkOwnerActionsHandler({origin},async()=>{calls++;assert.fail('No runtime expected');});
 for(const [body,headers,status] of [[{...input,expectedOwnerId:owner,isPaid:true},{},422],[{...input,expectedOwnerId:'invalid'},{},422],[{...input,expectedOwnerId:owner},{origin:'https://foreign.invalid'},403],[{...input,expectedOwnerId:owner},{cookie:''},401]])assert.equal((await handler(request(body,headers))).status,status);
 assert.equal(calls,0);
});
test('work actions preserve cookie, original operation and bigint revision and hide internal failures',async()=>{
 const handler=createWorkOwnerActionsHandler({origin},async()=>({limiter:{allowProduction:async()=>true},store:{change:async(token,actor,value)=>{assert.equal(token,'a'.repeat(64));assert.equal(actor,owner);assert.deepEqual(value,input);throw Error('private-sql-detail');}}}));
 const response=await handler(request());assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{error:{code:'ACTION_UNAVAILABLE'}});
});
test('client rejects invalid input before sending and validates the returned operation identity',async()=>{
 let sent=0;const client=createWorkOwnerActionsClient(async(_url,options)=>{sent++;assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{...input,expectedOwnerId:owner});return Response.json(result);});
 await assert.rejects(client.change(owner,{...input,reason:'<script>x</script>'}),{code:'INVALID_INPUT'});assert.equal(sent,0);
 assert.deepEqual(await client.change(owner,input),result);
 for(const patch of [{operationId:publicationId},{ownerId:publicationId},{resultingRevision:'9007199254740995'},{status:'published'},{reason:'Другая причина'}])await assert.rejects(createWorkOwnerActionsClient(async()=>Response.json({...result,...patch})).change(owner,input),{code:'UNKNOWN'});
});
test('a lost HTTP response retries the identical operation and never invents a new key',async()=>{
 const bodies=[];let first=true;const client=createWorkOwnerActionsClient(async(_url,options)=>{bodies.push(options.body);if(first){first=false;throw Error('Synthetic lost HTTP response');}return Response.json(result);});
 await assert.rejects(client.change(owner,input),{code:'UNKNOWN'});assert.deepEqual(await client.change(owner,input),result);assert.equal(bodies[0],bodies[1]);
});
