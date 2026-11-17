import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {createAdminUserDirectoryHandler}=load('admin-user-directory-http');
const {AdminAccessError}=load('admin-authorization');
const origin='https://directory.example.invalid',actor='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
const input={expectedAdminId:actor,query:'',role:'all',status:'all',cursor:null};
function request(body=input,headers={},method='POST'){
  return new Request(origin+'/api/admin/user-directory',{method,headers:{host:'directory.example.invalid',origin,
    'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+token,...headers},
    ...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
test('user directory rejects forged authority, noncanonical requests and unsupported methods before runtime',async()=>{
  let calls=0;const handle=createAdminUserDirectoryHandler({origin},()=>{calls++;assert.fail('Invalid request accessed runtime');},()=>{});
  for(const [body,headers,method,status] of [[input,{},'GET',405],[{...input,role:'specialist'},{},'POST',422],
    [{...input,expectedAdminId:'bad'},{},'POST',422],[{...input,isAdmin:true},{},'POST',422],
    [input,{cookie:'',authorization:'Bearer legacy'},'POST',401],[input,{cookie:'__Host-blizhniy_session='+token+'; __Host-blizhniy_session='+token},'POST',401],
    [input,{origin:'https://foreign.example.invalid'},'POST',403],[input,{'x-blizhniy-request':''},'POST',403],
    [input,{'x-real-ip':''},'POST',403],[input,{'content-length':'999999'},'POST',413]])
    assert.equal((await handle(request(body,headers,method))).status,status);
  assert.equal(calls,0);
});
test('directory response is no-store, shares the rate limiter and never exposes private errors in logs',async()=>{
  let allowed=true,failure,calls=0;const events=[];
  const handle=createAdminUserDirectoryHandler({origin},()=>({limiter:{allowProduction:async(...args)=>{assert.deepEqual(args,['session','192.0.2.4']);return allowed;}},
    store:{list:async(...args)=>{calls++;assert.deepEqual(args,[token,input]);if(failure)throw failure;return{items:[],nextCursor:null};}}}),event=>events.push(event));
  const response=await handle(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{items:[],nextCursor:null});assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  allowed=false;const limited=await handle(request());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');assert.equal(calls,1);
  allowed=true;failure=new AdminAccessError();assert.equal((await handle(request())).status,403);
  failure=Error('private-database-host');const bad=await handle(request());assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{error:{code:'DIRECTORY_UNAVAILABLE'}});
  for(const value of [actor,token,'private-database-host'])assert.equal(JSON.stringify(events).includes(value),false);
});
