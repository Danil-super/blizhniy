import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {readBody} from '../scripts/local-primary-proxy.mjs';
test('refund ingress bounds native request bytes and slow upload before constructing the Fetch request',{timeout:8000},async()=>{
 let commands=0;const server=createServer(async(req,res)=>{try{const body=await readBody(req,4096,2000);commands++;res.end(String(body.length));}catch{if(!res.destroyed){res.writeHead(413);res.end();}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const send=(body,stall=false)=>new Promise((resolve,reject)=>{
  const outgoing=request({hostname:'127.0.0.1',port,method:'POST',agent:false},incoming=>{let text='';incoming.setEncoding('utf8');incoming.on('data',chunk=>text+=chunk);incoming.on('end',()=>resolve({status:incoming.statusCode,text}));incoming.on('error',reject);});
  outgoing.on('error',reject);if(stall)outgoing.write(body);else outgoing.end(body);
 });
 try{
  assert.deepEqual(await send('x'.repeat(4096)),{status:200,text:'4096'});
  assert.deepEqual(await send('x'.repeat(4097)),{status:413,text:''});assert.equal(commands,1);
  const started=performance.now();await assert.rejects(send('x',true));assert.ok(performance.now()-started<5000);assert.equal(commands,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
