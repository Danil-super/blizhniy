import assert from 'node:assert/strict';import{test}from'node:test';import{createRequire}from'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {createAdminTariffHandler}=load('admin-tariff-http'),{AdminTariffError}=load('admin-tariff-contract');
const origin='https://tariffs.example.invalid',actor='11111111-1111-4111-8111-111111111111',token='a'.repeat(64),command={resource:'tariffs',action:'list',expectedAdminId:actor},result={tariffs:[],receipt:null,history:[]};
function request(body=command,headers={},method='POST'){return new Request(origin+'/api/admin/tariff-management',{method,headers:{host:'tariffs.example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+token,...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});}
test('tariff HTTP blocks foreign origins, legacy auth, invalid input, methods and oversized bodies before dispatch',async()=>{
 let calls=0;const handler=createAdminTariffHandler({origin},()=>{calls++;assert.fail();},()=>{});
 for(const [body,headers,method,status]of[[command,{},'GET',405],[{...command,price:1},{},'POST',422],[command,{origin:'https://foreign.invalid'},'POST',403],[command,{'x-real-ip':''},'POST',403],[command,{cookie:'',authorization:'Bearer legacy'},'POST',401],[command,{'content-length':'9000'},'POST',413]])assert.equal((await handler(request(body,headers,method))).status,status);
 assert.equal(calls,0);
});
test('tariff HTTP limits traffic and returns only bound data or safe errors, never private diagnostics',async()=>{
 const events=[];let allowed=true,failure,calls=0;const handler=createAdminTariffHandler({origin},()=>({limiter:{allowProduction:async()=>allowed},execute:async(t,c)=>{calls++;assert.equal(t,token);assert.deepEqual(c,command);if(failure)throw failure;return result;}}),event=>events.push(event));
 const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),result);
 allowed=false;assert.equal((await handler(request())).status,429);assert.equal(calls,1);allowed=true;
 for(const[code,status]of[['ADMIN_REQUIRED',403],['STALE_TARIFF',409],['TARIFF_NOT_FOUND',404],['ACCESS_BUSY',409]]){failure=new AdminTariffError(code);const response=await handler(request());assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code}});}
 failure=Error('private-host');const denied=await handler(request());assert.equal(denied.status,503);assert.deepEqual(await denied.json(),{error:{code:'TARIFF_UNAVAILABLE'}});
 for(const secret of[token,actor,'private-host'])assert.equal(JSON.stringify(events).includes(secret),false);
});
test('tariff capability is local-only, requires owned user operator and defaults off',()=>{
 const {readLocalTariffOperatorConfig:read}=load('local-user-access-config');assert.equal(read({}),null);
 for(const env of[{BLIZHNIY_ADMIN_TARIFFS:'enabled'},{BLIZHNIY_ADMIN_TARIFFS:'local-v1'},{BLIZHNIY_ADMIN_TARIFFS:'local-v1',NODE_ENV:'production',BLIZHNIY_USER_ACCESS_OPERATOR:'local-v1'}])assert.throws(()=>read(env));
});
