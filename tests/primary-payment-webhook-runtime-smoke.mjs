// Published route guard only; deliberately no database, SMTP or merchant configuration.
import assert from 'node:assert/strict';import {test} from 'node:test';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:net';
test('built primary callback defaults off and both legacy paths refuse the postgres backend before credentials',{timeout:30000},async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const origin=`http://127.0.0.1:${port}`;let app,output='';
 try{
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',BLIZHNIY_AUTH_MODE:'postgres'},detached:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [app.stdout,app.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-8000);});
  const deadline=Date.now()+15000;for(;;){assert.equal(app.exitCode,null,output);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch(error){assert.ok(error.cause?.code==='ECONNREFUSED'||error.name==='TimeoutError');}assert.ok(Date.now()<deadline,'owned app starts');await new Promise(resolve=>setTimeout(resolve,100));}
  for(const [path,code] of [['/api/payments/yookassa/primary-webhook','WEBHOOK_DISABLED'],['/api/payments/yookassa/webhook','LEGACY_WEBHOOK_DISABLED'],['/api/webhooks/yookassa','LEGACY_WEBHOOK_DISABLED']]){
   const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'notification',event:'payment.succeeded',object:{id:'11111111-1111-4111-8111-111111111111'}}),signal:AbortSignal.timeout(3000)});
   assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{error:{code}});
  }
  assert.equal((await fetch(origin+'/api/payments/yookassa/primary-webhook',{signal:AbortSignal.timeout(3000)})).status,405);
 }finally{if(app&&app.exitCode===null){process.kill(-app.pid,'SIGTERM');await once(app,'exit');}}
});
