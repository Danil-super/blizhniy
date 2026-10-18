// Real compiled Next route, isolated synthetic configuration, no DB connection or third-party traffic.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';import {request as httpRequest} from 'node:http';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',host='xn----9sbphbgks4a4a.xn--p1ai',publicOrigin='https://'+host;
test('compiled application route rejects unsafe requests before private credentials, SQL or payment runtime',{timeout:30000},async()=>{
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`;
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:publicOrigin,
  BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:'synthetic-ui-db-password',
  BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:'/not-read-by-route/root.crt',BLIZHNIY_AUTH_MAIL_KEY_FILE:'/not-read-by-route/mail-key.bin',BLIZHNIY_AUTH_RATE_SECRET:'synthetic-route-only-rate-secret-not-used-by-api',
  BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-ui-smtp-password',TURNSTILE_SECRET_KEY:'synthetic-ui-captcha-secret'};
 let output='';const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,detached:true,stdio:['ignore','pipe','pipe']});
 app.stdout.on('data',chunk=>{output=(output+chunk).slice(-8000);});app.stderr.on('data',chunk=>{output=(output+chunk).slice(-8000);});
 function request(body,method='POST',headers={},query=''){return new Promise((resolve,reject)=>{
  const request=httpRequest(origin+'/api/account/applications'+query,{method,headers:{host,origin:publicOrigin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',...headers}},response=>{
   let text='';response.on('data',chunk=>{text+=chunk;if(text.length>4096)request.destroy(Error('Oversized refusal'));});response.on('end',()=>resolve({status:response.statusCode,body:text,headers:response.headers}));response.on('error',reject);
  });request.on('error',reject);request.setTimeout(5000,()=>request.destroy(Error('Route timeout')));request.end(JSON.stringify(body));
 });}
 try{
  const deadline=Date.now()+15000;for(;;){assert.equal(app.exitCode,null);let ready=false;try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}if(ready)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
  const body={action:'read',expectedOwnerId:owner,applicationId:id};
  for(const [value,method,headers,query,status,code] of [[body,'POST',{},'',401,'UNAUTHENTICATED'],[body,'POST',{authorization:'Bearer synthetic'},'',401,'UNAUTHENTICATED'],
   [body,'POST',{origin:'https://foreign.invalid'},'',403,'FORBIDDEN_ORIGIN'],[body,'POST',{},'?owner=other',400,'QUERY_NOT_ALLOWED'],[{...body,status:'sent'},'POST',{},'',422,'INVALID_INPUT'],
   [{action:'create',expectedOwnerId:owner,input:{paid:true}},'PUT',{},'',422,'INVALID_INPUT']]){
   const result=await request(value,method,headers,query);assert.equal(result.status,status);assert.deepEqual(JSON.parse(result.body),{error:{code}});assert.equal(result.headers['cache-control'],'no-store');
  }
  assert.equal(output.includes('PostgreSQL idle connection failed'),false);
 }finally{if(app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}}
});
