import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {createLocalPrimaryHttpsClient} from '../scripts/local-primary-https.mjs';

function transport(replies,seen){return(url,options,receive)=>{
 const req=new EventEmitter();req.end=bytes=>{
  seen.push({url:String(url),options,body:bytes?.toString()});
  queueMicrotask(()=>{const value=replies.shift(),res=new EventEmitter();res.statusCode=value.status??200;res.headers=value.headers??{'content-type':'application/json'};res.complete=value.complete??true;res.destroy=()=>{};
   receive(res);for(const chunk of value.chunks??[Buffer.from(value.body??'{}')])res.emit('data',chunk);res.emit('end');});
 };req.destroy=error=>req.emit('error',error);return req;
};}
test('HTTPS acceptance stays on the owned origin, verifies TLS and keeps independent cookie jars',async()=>{
 const seen=[],ca=Buffer.from('synthetic CA'),send=transport([{headers:{'content-type':'application/json','set-cookie':['__Host-session=synthetic; Path=/; Secure']},body:'{"ok":true}'},{},{}],seen);
 const first=createLocalPrimaryHttpsClient(ca,send),second=createLocalPrimaryHttpsClient(ca,send);
 assert.deepEqual((await first('/api/test',{body:{a:1}})).data,{ok:true});await first('/api/test');await second('/api/test');
 assert.equal(seen[0].url,'https://127.0.0.1:3045/api/test');assert.equal(seen[0].options.ca,ca);assert.equal(seen[0].options.rejectUnauthorized,true);
 assert.equal(seen[1].options.headers.cookie,'__Host-session=synthetic');assert.equal(seen[2].options.headers.cookie,'');
 for(const path of ['https://example.invalid/','//example.invalid/','/\\example.invalid/'])await assert.rejects(first(path));
 assert.equal(seen.length,3);
});
test('HTTPS acceptance checks status and complete bounded replies without following redirects',async()=>{
 const seen=[],api=createLocalPrimaryHttpsClient(Buffer.from('CA'),transport([{status:302},{chunks:[Buffer.alloc(2097153)]},{body:'broken'},{complete:false}],seen));
 await assert.rejects(api('/redirect'));await assert.rejects(api('/large'));await assert.rejects(api('/invalid-json'));await assert.rejects(api('/incomplete'));assert.equal(seen.length,4);
});
test('HTTPS acceptance encodes native payment forms and can deliberately lose the body after headers',async()=>{
 const seen=[],api=createLocalPrimaryHttpsClient(Buffer.from('CA'),transport([{headers:{'content-type':'text/html'},body:'<p>ok</p>'},{body:'not read'}],seen));
 assert.equal((await api('/__local/payment',{body:{action:'succeed'},form:true})).data,'<p>ok</p>');
 assert.equal(seen[0].body,'action=succeed');assert.equal(seen[0].options.headers['content-type'],'application/x-www-form-urlencoded');
 assert.equal((await api('/api/order',{loseBody:true})).data,null);
});
