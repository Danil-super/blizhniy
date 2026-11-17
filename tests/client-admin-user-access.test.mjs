import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAdminUserAccessClient} from '../src/lib/client-admin-user-access.ts';
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
const command={action:'inspect',expectedAdminId:actor,targetId:target},result={user:{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'},receipt:null,history:[]};
test('access client uses bounded validated same-origin POST without automatic retries',async()=>{
  let calls=0;const client=createAdminUserAccessClient(async(path,options)=>{calls++;assert.equal(path,'/api/admin/user-access');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),command);return Response.json(result);});
  assert.deepEqual(await client.execute(command),result);assert.equal(calls,1);
  await assert.rejects(client.execute({...command,role:'admin'}));assert.equal(calls,1);
});
test('access client maps known status/code pairs, fences aborts and discards private or malformed responses',async()=>{
  for(const [status,code,expected] of [[401,'UNAUTHENTICATED','ADMIN_REQUIRED'],[403,'ADMIN_REQUIRED','ADMIN_REQUIRED'],[409,'STALE_ACCESS','STALE_ACCESS'],[429,'RATE_LIMITED','RATE_LIMITED'],[503,'PRIVATE_HOST','ACCESS_UNAVAILABLE']]){
    let calls=0;await assert.rejects(createAdminUserAccessClient(async()=>{calls++;return Response.json({error:{code,message:'private-host'}},{status});}).execute(command),error=>error.code===expected&&!error.message.includes('private'));assert.equal(calls,1);
  }
  for(const response of [Response.json({...result,user:{...result.user,password_hash:'private'}}),new Response('x'.repeat(65537)),new Response('not json'),Response.json(result,{status:201})])
    await assert.rejects(createAdminUserAccessClient(async()=>response).execute(command));
  const abort=new AbortController();abort.abort();let calls=0;
  await assert.rejects(createAdminUserAccessClient(async()=>{calls++;return Response.json(result);}).execute(command,{signal:abort.signal}));assert.equal(calls,0);
});
