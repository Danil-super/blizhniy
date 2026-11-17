// Negative HTTP acceptance on the owned local stand; no accounts, mail or credentials.
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const ca=await readFile(join(stateDirectory,'tls-cert.pem'));
function request(path,{method='POST',body='{}',type='application/json'}={}){
 return new Promise((resolve,reject)=>{
  const bytes=['GET','HEAD'].includes(method)?null:Buffer.from(body);
  const req=https.request(new URL(path,state.origin),{method,ca,rejectUnauthorized:true,signal:AbortSignal.timeout(10000),headers:{
   Origin:state.origin,'Sec-Fetch-Site':'same-origin','X-Blizhniy-Request':'1','Content-Type':type,...(bytes?{'Content-Length':bytes.length}:{}),
  }},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>16384)req.destroy(Error('Unexpected auth error size'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
  });
  req.on('error',reject);req.end(bytes);
 });
}
let checks=0;
for(const action of ['register','resend','recover']){
 for(const [options,status,code] of [
  [{method:'GET'},405,'METHOD_NOT_ALLOWED'],[{method:'HEAD'},405,'METHOD_NOT_ALLOWED'],
  [{method:'PUT'},405,'METHOD_NOT_ALLOWED'],[{body:'{'},400,'INVALID_JSON'],
  [{body:'null'},422,'INVALID_INPUT'],[{body:'[]'},422,'INVALID_INPUT'],
  [{type:'text/plain'},415,'JSON_REQUIRED'],
  [{body:JSON.stringify({email:'boundary@local.invalid',padding:'x'.repeat(5000)})},413,'BODY_TOO_LARGE'],
  [{body:JSON.stringify({email:'boundary@example.com'})},422,'SYNTHETIC_EMAIL_REQUIRED'],
 ]){
  const response=await request('/api/account/'+action,options);assert.equal(response.status,status,action+' '+(options.method??'POST'));
  if(options.method==='HEAD')assert.equal(response.body,'');else assert.deepEqual(JSON.parse(response.body),{error:{code}});
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');checks++;
 }
}
console.log(JSON.stringify({status:'passed',checks,productionTouched:false,credentialsUsed:false}));
