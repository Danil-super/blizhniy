import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAdminUserDirectoryClient} from '../src/lib/client-admin-user-directory.ts';
const input={expectedAdminId:'11111111-1111-4111-8111-111111111111',query:'Имя',role:'all',status:'all',cursor:null};
test('directory client sends only same-origin POST with canonical inputs and validates the bounded response',async()=>{
  let calls=0;const client=createAdminUserDirectoryClient(async(url,options)=>{
    calls++;assert.equal(url,'/api/admin/user-directory');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
    assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),input);
    return Response.json({items:[],nextCursor:null});
  });
  assert.deepEqual(await client.list(input),{items:[],nextCursor:null});
  await assert.rejects(client.list({...input,role:'organization'}));assert.equal(calls,1);
});
test('directory client discards raw errors, malformed/private DTOs and oversized streams, and honours abort',async()=>{
  for(const response of [Response.json({error:{code:'PRIVATE_ERROR',message:'private-host'}},{status:500}),
    Response.json({items:[{password_hash:'private'}],nextCursor:null}),new Response('x'.repeat(65537)),new Response('invalid-json')])
    await assert.rejects(createAdminUserDirectoryClient(async()=>response).list(input),error=>!error.message.includes('private'));
  const abort=new AbortController();abort.abort();let called=false;
  await assert.rejects(createAdminUserDirectoryClient(async()=>{called=true;return Response.json({items:[],nextCursor:null});}).list(input,{signal:abort.signal}));assert.equal(called,false);
  await assert.rejects(createAdminUserDirectoryClient(async()=>Response.json({error:{code:'ADMIN_REQUIRED'}},{status:403})).list(input),error=>error.code==='ADMIN_REQUIRED');
});
