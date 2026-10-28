// Explicit integration smoke for the owned local stand only. It starts no Next
// build and creates only its own synthetic registration/media fixture.
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {once} from 'node:events';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareLocalPrimaryFixture,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {createLocalPrimaryProxy} from './local-primary-proxy.mjs';
const require=createRequire(import.meta.url),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
process.env.NODE_ENV='test';
const state=await prepareLocalPrimaryFixture();
await promisify(execFile)(process.execPath,['--require',join(state.project,'scripts/local-primary-preload.cjs'),'-e',`
 const assert=require('node:assert/strict'),fs=require('node:fs'),s=JSON.parse(fs.readFileSync(process.env.BLIZHNIY_LOCAL_PRIMARY_STATE));
 const pg=require('pg'),pool=new pg.Pool({host:'17e86f80f26733d39ef4b84d.twc1.net',port:5432,database:'blizhniy_prod',user:'blizhniy_runtime',password:s.runtimePassword,ssl:{rejectUnauthorized:true}});
 (async()=>{try{const r=await pool.query('select current_user as actor,inet_server_addr()::text as address');assert.equal(r.rows[0].actor,'blizhniy_runtime');
 assert.throws(()=>require('node:net').connect({host:'203.0.113.1',port:443}),/External network disabled/);
 assert.throws(()=>require('node:net').connect('/tmp/not-an-owned-local-primary.sock'),/External network disabled/);
 assert.throws(()=>fetch('https://example.invalid'),/External fetch disabled/);
 }finally{await pool.end();}})().catch(()=>{process.exitCode=1;});
`],{cwd:state.project,env:{PATH:process.env.PATH,NODE_ENV:'production',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_STATE:stateFile,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin},timeout:15000,maxBuffer:65536});
const ca=await readFile(join(stateDirectory,'tls-cert.pem'));
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
let cookie='',authRuntime;
const cipher=new(load('mail-outbox').MailPayloadCipher)(await readFile(join(stateDirectory,'mail-key.bin')));
const handler=load('production-account-http').createProductionAccountHandler({origin:'https://xn----9sbphbgks4a4a.xn--p1ai',rateSecret:state.rateSecret,mailKeyFile:join(stateDirectory,'mail-key.bin'),rememberedCaptcha:true},()=>authRuntime,()=>{});
const proxy=await createLocalPrimaryProxy(state,{paymentHandler:async(request,{runtimeDb})=>{
 const path=new URL(request.url).pathname;if(!/^\/api\/account\/(login|session|logout|register|confirm)$/.test(path))return null;
 authRuntime??={identity:new(load('identity').IdentityStore)(runtimeDb),store:new(load('registration').RegistrationStore)(runtimeDb,cipher,{confirmationNotice:true}),
  recovery:new(load('password-recovery').PasswordRecoveryStore)(runtimeDb,cipher),limiter:new(load('auth-http').AuthRateLimiter)(runtimeDb,state.rateSecret),verifyCaptcha:async()=>{throw Error('Local ingress proof must prevent external CAPTCHA');}};
 return handler(request,path.split('/').at(-1));
}});
proxy.server.listen(3045,'127.0.0.1');await once(proxy.server,'listening');
const send=(path,body,extra={})=>new Promise((resolve,reject)=>{
 const bytes=body instanceof Buffer?body:Buffer.from(JSON.stringify(body));
 const request=httpsRequest(state.origin+path,{method:'POST',ca,servername:'127.0.0.1',headers:{origin:state.origin,'content-type':'application/json','content-length':String(bytes.length),'x-blizhniy-request':'1','user-agent':'Owned local smoke',...(cookie?{cookie}:{}),...extra}},response=>{
  const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}));
 });request.on('error',reject);request.end(bytes);
});
try{
 const user=accounts.find(a=>a.role==='user');
 const login=await send('/api/account/login',{email:user.email,password:user.password,captchaToken:''});assert.equal(login.status,200);
 const loginBody=JSON.parse(login.bytes);assert.equal(loginBody.user.id,user.id);assert.equal(Object.hasOwn(loginBody,'token'),false);
 cookie=login.headers['set-cookie'].find(value=>value.startsWith('__Host-blizhniy_session=')).split(';')[0];
 assert.match(login.headers['set-cookie'].join(';'),/Secure/);assert.match(login.headers['set-cookie'].join(';'),/HttpOnly/);
 assert.equal((await send('/api/account/session',{})).status,200);
 assert.equal((await send('/api/account/session',{}, {host:'attacker.invalid'})).status,403);
 assert.equal((await send('/api/account/session',{}, {origin:'https://attacker.invalid'})).status,403);
 assert.equal((await send('/api/account/session',{}, {'sec-fetch-site':'cross-site'})).status,403);
 const source=await sharp({create:{width:80,height:40,channels:3,background:'#268455'}}).png().toBuffer();
 const upload=await send('/api/account/media',source,{'content-type':'image/png','x-blizhniy-owner':user.id,'x-blizhniy-intent':randomUUID()});
 assert.equal(upload.status,200,upload.bytes.toString().slice(0,200));const image=JSON.parse(upload.bytes);
 const photo=await send('/api/account/media/read',{expectedOwnerId:user.id,fileId:image.id});assert.equal(photo.status,200);assert.equal(photo.headers['content-type'],'image/webp');
 assert.equal((await sharp(photo.bytes).metadata()).format,'webp');
 assert.equal((await send('/api/account/media/read',{expectedOwnerId:user.id,fileId:image.id},{cookie:''})).status,401);
 assert.equal((await send('/api/account/media/read',{expectedOwnerId:randomUUID(),fileId:image.id})).status,409);
 const email='manual-smoke-'+randomBytes(5).toString('hex')+'@local.invalid';
 const legal=load('registration-legal').REGISTRATION_LEGAL_VERSIONS;
 assert.equal((await send('/api/account/recover',{email:'not-synthetic@example.com',captchaToken:''})).status,422);
 const registration=await send('/api/account/register',{name:'Локальная проверка',email,password:'LocalRegistration2026!',captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy});assert.equal(registration.status,202);
 const deadline=Date.now()+7000;let confirmation;
 while(!confirmation&&Date.now()<deadline){
  for(const file of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const captured=JSON.parse(await readFile(join(stateDirectory,file),'utf8'));if(captured.to===email)confirmation=captured.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!confirmation)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(confirmation,'actual durable mail outbox captured the confirmation locally');
 assert.equal((await send('/api/account/confirm',{token:confirmation})).status,200);
 console.log(JSON.stringify({result:'passed',checks:['cookie_login','real_session','real_image_normalization','private_photo','durable_registration','captured_confirmation','email_confirmed'],productionTouched:false,externalMail:false}));
}finally{await proxy.close();}
