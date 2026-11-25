// The packaged command keeps its real TLS configuration. Only this fixture can route to the disposable port.
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync} from 'node:fs';
import {Socket} from 'node:net';

const {host,port,item,approvalId,merchant,acceptStore,stopAfterTick,log}=JSON.parse(readFileSync(process.env.BLIZHNIY_TEST_REFUND_COMMAND,'utf8'));
assert.ok(Number.isSafeInteger(port)&&port>1024&&port<65536);
const connect=Socket.prototype.connect;
Socket.prototype.connect=function(service,destination,...args){
 assert.equal(service,5432);
 assert.equal(destination,host);
 return connect.call(this,port,'127.0.0.1',...args);
};
const {provider}=await import('../refund-worker-role-cases.mjs');
const fake=provider(item,approvalId,merchant);
globalThis.fetch=async(url,init)=>{
 if(String(url)==='https://api.yookassa.ru/v3/me'){
  assert.equal(init.method,'GET');
  assert.equal(init.headers.Authorization,'Basic '+Buffer.from(merchant.shopId+':'+merchant.secretKey).toString('base64'));
  appendFileSync(log,'merchant\n');
  return Response.json({account_id:merchant.shopId,test:acceptStore,status:'enabled',fiscalization:{enabled:false}});
 }
 const response=await fake.fetcher(url,init);
 const step=init.method==='POST'?'dispatch':String(url).includes('/v3/refunds/')?'verify':'inspect';
 appendFileSync(log,step+'\n');
 return response;
};
if(stopAfterTick){
 const write=process.stdout.write;
 process.stdout.write=function(chunk,...args){
  const line=JSON.parse(String(chunk));
  if(line.event==='refund_worker_service'&&line.status==='tick')setImmediate(()=>process.kill(process.pid,'SIGTERM'));
  return write.call(this,chunk,...args);
 };
}
