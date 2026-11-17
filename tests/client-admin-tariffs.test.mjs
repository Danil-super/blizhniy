import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAdminTariffClient} from '../src/lib/client-admin-tariffs.ts';
const actor='11111111-1111-4111-8111-111111111111';
const command={resource:'tariffs',action:'list',expectedAdminId:actor},result={tariffs:[],receipt:null,history:[]};
test('tariff client uses bounded validated same-origin POST without automatic retries',async()=>{
  let calls=0;const client=createAdminTariffClient(async(path,options)=>{calls++;assert.equal(path,'/api/admin/tariff-management');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),command);return Response.json(result);});
  assert.deepEqual(await client.execute(command),result);assert.equal(calls,1);
  await assert.rejects(client.execute({...command,role:'admin'}));assert.equal(calls,1);
});
test('tariff client maps known status/code pairs, fences aborts and discards private or malformed responses',async()=>{
  for(const [status,code,expected] of [[401,'UNAUTHENTICATED','ADMIN_REQUIRED'],[403,'ADMIN_REQUIRED','ADMIN_REQUIRED'],[409,'STALE_TARIFF','STALE_TARIFF'],[429,'RATE_LIMITED','RATE_LIMITED'],[503,'PRIVATE_HOST','TARIFF_UNAVAILABLE']]){
    let calls=0;await assert.rejects(createAdminTariffClient(async()=>{calls++;return Response.json({error:{code,message:'private-host'}},{status});}).execute(command),error=>error.code===expected&&!error.message.includes('private'));assert.equal(calls,1);
  }
  for(const response of [Response.json({...result,private:'private'}),new Response('x'.repeat(65537)),new Response('not json'),Response.json(result,{status:201})])
    await assert.rejects(createAdminTariffClient(async()=>response).execute(command));
  const abort=new AbortController();abort.abort();let calls=0;
  await assert.rejects(createAdminTariffClient(async()=>{calls++;return Response.json(result);}).execute(command,{signal:abort.signal}));assert.equal(calls,0);
});
