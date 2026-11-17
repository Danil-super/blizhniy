import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {createAdminUserAccessHandler}=load('admin-user-access-http'),{AdminUserAccessError}=load('admin-user-access-contract');
const origin='https://access.example.invalid',actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',token='a'.repeat(64);
const command={action:'inspect',expectedAdminId:actor,targetId:target};
function request(body=command,headers={},method='POST'){
  return new Request(origin+'/api/admin/user-access',{method,headers:{host:'access.example.invalid',origin,'content-type':'application/json',
    'x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+token,...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
test('user-access HTTP fences method/origin/ingress/cookie/input before the private operator',async()=>{
  let calls=0;const handler=createAdminUserAccessHandler({origin},()=>{calls++;assert.fail();},()=>{});
  for(const [body,headers,method,status] of [[command,{},'GET',405],[{...command,role:'admin'},{},'POST',422],
    [command,{origin:'https://foreign.example.invalid'},'POST',403],[command,{'x-real-ip':''},'POST',403],
    [command,{cookie:'',authorization:'Bearer legacy'},'POST',401],[command,{'content-length':'9000'},'POST',413]])
    assert.equal((await handler(request(body,headers,method))).status,status);
  assert.equal(calls,0);
});
test('user-access HTTP shares limits, propagates only safe errors and does not audit private identity or command payloads',async()=>{
  const events=[];let allowed=true,failure,calls=0;
  const result={user:{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'},receipt:null,history:[]};
  const handler=createAdminUserAccessHandler({origin},()=>({limiter:{allowProduction:async()=>allowed},execute:async(...args)=>{
    calls++;assert.equal(args[0],token);assert.deepEqual(args[1],command);if(failure)throw failure;return result;
  }}),event=>events.push(event));
  const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),result);
  allowed=false;assert.equal((await handler(request())).status,429);assert.equal(calls,1);allowed=true;
  for(const [code,status] of [['ADMIN_REQUIRED',403],['SELF_CHANGE',409],['USER_UNAVAILABLE',404],['ACCESS_BUSY',409]]){
    failure=new AdminUserAccessError(code);const response=await handler(request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});
  }
  failure=Error('private-db-host');const unavailable=await handler(request());assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:{code:'ACCESS_UNAVAILABLE'}});
  for(const secret of [token,actor,target,'private-db-host'])assert.equal(JSON.stringify(events).includes(secret),false);
});
