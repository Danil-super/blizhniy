// Owned loopback HTTPS only; reads synthetic accounts, never production credentials.
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {stateDirectory,stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
assert.equal(state.origin,'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const ca=await readFile(join(stateDirectory,'tls-cert.pem'));
function client(){
  const cookies=new Map();
  return async(path,body={},method='POST')=>new Promise((resolve,reject)=>{
    const bytes=method==='GET'?null:Buffer.from(JSON.stringify(body));
    const request=https.request(new URL(path,state.origin),{method,ca,rejectUnauthorized:true,signal:AbortSignal.timeout(15000),headers:{
      Origin:state.origin,'Sec-Fetch-Site':'same-origin','X-Blizhniy-Request':'1',
      Cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),
      ...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},response=>{
      for(const cookie of response.headers['set-cookie']??[]){const pair=cookie.split(';')[0],offset=pair.indexOf('=');cookies.set(pair.slice(0,offset),pair.slice(offset+1));}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>65536)request.destroy(Error('Response size bound'));else chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>{try{resolve({status:response.statusCode,headers:response.headers,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Error('Expected JSON response'));}});
    });request.on('error',reject);request.end(bytes);
  });
}
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const admin=accounts.find(row=>row.role==='admin'),user=accounts.find(row=>row.role==='user');
assert.ok(admin&&user&&admin.email.endsWith('.invalid')&&user.email.endsWith('.invalid'));
const authenticated=client(),ordinary=client(),anonymous=client(),endpoint='/api/admin/user-directory';
const query={expectedAdminId:admin.id,query:'',role:'all',status:'all',cursor:null},results=[];
const check=(name,response,status)=>{assert.equal(response.status,status,name);results.push({name,status});};
try {
  check('admin-login',await authenticated('/api/account/login',{email:admin.email,password:admin.password,captchaToken:''}),200);
  const page=await authenticated(endpoint,query);check('directory',page,200);
  assert.equal(page.headers['cache-control'],'no-store');assert.ok(page.data.items.length>0&&page.data.items.length<=25);
  assert.ok(page.data.items.every(row=>Object.keys(row).sort().join()===['createdAt','email','emailVerified','id','isBlocked','name','phone','role'].join()));
  const match=page.data.items[0];const exact=await authenticated(endpoint,{...query,query:match.email});check('email-search',exact,200);
  assert.ok(exact.data.items.some(row=>row.id===match.id));
  const admins=await authenticated(endpoint,{...query,role:'admin'});check('admin-filter',admins,200);assert.ok(admins.data.items.every(row=>row.role==='admin'));
  check('anonymous',await anonymous(endpoint,query),401);
  check('wrong-actor',await authenticated(endpoint,{...query,expectedAdminId:user.id}),403);
  check('unsupported-method',await authenticated(endpoint,{},'GET'),405);
  check('forged-role',await authenticated(endpoint,{...query,role:'specialist'}),422);
  check('extra-authority',await authenticated(endpoint,{...query,isAdmin:true}),422);
  check('ordinary-login',await ordinary('/api/account/login',{email:user.email,password:user.password,captchaToken:''}),200);
  check('ordinary-user',await ordinary(endpoint,{...query,expectedAdminId:user.id}),403);
  check('logout',await authenticated('/api/account/logout'),200);
  check('revoked-session',await authenticated(endpoint,query),401);
  const result={date:new Date().toISOString(),origin:state.origin,buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),results,productionTouched:false};
  await writeFile(join(stateDirectory,'admin-user-directory-acceptance.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({checks:results.length,passed:true,buildId:result.buildId,productionTouched:false}));
} finally {await Promise.allSettled([authenticated('/api/account/logout'),ordinary('/api/account/logout')]);}
