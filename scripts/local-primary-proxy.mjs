// Local manual-review ingress. All application data is in the owned disposable
// loopback PG18 fixture; no production secrets, SMTP or merchant are loaded.
import {createServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';
import {stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {validateLocalPrimaryContainer,localPrimaryUpstreamPort} from './local-primary-config.mjs';
import {allowLocalPrimaryRequest} from './local-primary-origin.mjs';
import {createTelegramPhoneOidc} from '../src/lib/telegram-phone-oidc.ts';
const require=createRequire(import.meta.url);
const {loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
const canonical='https://xn----9sbphbgks4a4a.xn--p1ai';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=(body,status=200)=>new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>БЛИЖНИЙ — локальный стенд</title><style>body{font:16px system-ui;max-width:900px;margin:32px auto;padding:0 20px;color:#16304a}a{color:#0668bb}article{border:1px solid #dde5ee;border-radius:12px;padding:18px;margin:14px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{background:#eff5fa;padding:4px}nav{display:flex;gap:20px;flex-wrap:wrap}</style>${body}</html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
async function readBody(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('Local request too large');chunks.push(chunk);}return Buffer.concat(chunks);}
export async function createLocalPrimaryProxy(state,{paymentHandler}={}){
 if(state.origin!=='https://127.0.0.1:3045'||state.upstreamPort!==localPrimaryUpstreamPort)throw Error('Invalid local ingress target');
 if(process.env.NODE_ENV!=='test')throw Error('Local proxy requires isolated test process');
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const {PostgresDatabase}=load('postgres');
 const runtimeDb=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state),max:5}));
 const ownerDb=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),max:2}));
 await load('production-auth-database').verifyProductionAuthDatabase(runtimeDb);
 const limiter=new(load('auth-http').AuthRateLimiter)(runtimeDb,state.rateSecret);
 const identity=new(load('identity').IdentityStore)(runtimeDb);
 const deletion=load('account-deletion-http').createAccountDeletionHandler({origin:canonical,rateSecret:state.rateSecret,mailKeyFile:join(stateDirectory,'mail-key.bin'),rememberedCaptcha:true},()=>({
  store:new(load('postgres-account-deletion').PostgresAccountDeletionStore)(runtimeDb),identity,limiter,verifyCaptcha:async()=>false,
 }));
 // Use the same backend handler with the canonical Request constructed below.
 // Next's loopback transport URL is not the externally registered callback URL.
 const phoneConfig=load('telegram-phone-config').readTelegramPhoneConfig();
 const phoneCallback=phoneConfig?load('telegram-phone-http').createTelegramPhoneHandler({origin:canonical},phoneConfig,async()=>({
  limiter,store:new(load('postgres-phone-verification').PostgresPhoneVerificationStore)(runtimeDb),
  oidc:createTelegramPhoneOidc(phoneConfig),
  policy:async()=>{
   const row=(await runtimeDb.query('select available,required from app.phone_verification_policy where singleton')).rows[0];
   if(!row)throw Error('Local phone policy unavailable');return row;
  },
 })):null;
 const files=await load('media-files').createLocalMediaFileStore(join(stateDirectory,'media'));
 const repository=new(load('media-metadata').MediaMetadataRepository)(runtimeDb,files);
 const writer=await load('media-file-worker').createLocalMediaFileWorker(state.project,join(stateDirectory,'media'));
 const upload=new(load('media-upload').LocalMediaUpload)(repository,load('media-worker').createLocalMediaWorker(state.project),new(load('media-write').LocalMediaWriter)(repository,writer));
 const media=load('production-media-http').createProductionMediaHandler({origin:canonical},()=>({identity,limiter,repository,upload}));
 const publicPhoto=load('production-public-work-photo-http').createProductionPublicWorkPhotoHandler({origin:canonical},()=>({store:new(load('postgres-public-listings').PostgresPublicListingStore)(runtimeDb,{postmoderation:true}),files}));
 const otherPublicPhotos=Object.fromEntries(['work','service'].map(kind=>[kind,load('production-public-work-photo-http').createProductionPublicWorkPhotoHandler({origin:canonical},()=>({store:new(load('postgres-public-'+kind)[kind==='work'?'PostgresPublicWorkStore':'PostgresPublicServiceStore'])(runtimeDb,kind==='work'?{vacancyPostmoderation:true}:{}),files}))]));
 const adminPhoto=load('admin-listing-moderation-http').createAdminListingModerationHandler({origin:canonical},()=>({identity,limiter,store:new(load('postgres-listing-moderation').PostgresListingModerationStore)(runtimeDb,files,{contactMethod:true})}));
 const key=await readFile(join(stateDirectory,'mail-key.bin'));
 const worker=new(load('mail-delivery').MailDeliveryWorker)(runtimeDb,new(load('mail-outbox').MailPayloadCipher)(key),load('production-auth-config').renderProductionAuthMail,{pendingAccounts:true});key.fill(0);
 let polling=false;
 const timer=setInterval(async()=>{
  if(polling)return;polling=true;
  try{await worker.runOne({send:async message=>{
   const captured={...message,text:message.text.replaceAll(canonical,state.origin),capturedAt:new Date().toISOString()};
   const file=join(stateDirectory,`mail-${message.id}.json`);
   try{await writeFile(file,JSON.stringify(captured),{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  }});}catch{console.warn('Local mail capture unavailable');}finally{polling=false;}
 },1000);
 const context={state,ownerDb,runtimeDb,load};
 const localPage=async path=>{
  if(path==='/__local'){
   const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
   return html(`<h1>Локальный стенд БЛИЖНИЙ</h1><p>Текущий PostgreSQL backend. Отдельные синтетические данные. Настоящих писем и списаний нет.</p><nav><a href="/">Главная</a><a href="/auth">Вход</a><a href="/auth/register">Регистрация</a><a href="/cabinet/obyavleniya">Мои объявления</a><a href="/admin">Админка</a><a href="/__local/mail">Письма</a></nav>${accounts.map(a=>`<article><h2>${a.role==='admin'?'Администратор':'Пользователь'}</h2><p>Email: <code>${escape(a.email)}</code></p><p>Пароль: <code>${escape(a.password)}</code></p></article>`).join('')}<p>Для проверки регистрации используйте адрес вида test1@local.invalid. Письма подтверждения и восстановления открываются в разделе «Письма».</p>`);
  }
  if(path==='/__local/mail'){
   const messages=await Promise.all((await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name)).slice(-200).map(async name=>JSON.parse(await readFile(join(stateDirectory,name),'utf8'))));
   const blocks=(await ownerDb.query("select u.email as recipient,m.subject,m.body as text,m.created_at from app.listing_block_mail m join app.users u on u.id=m.user_id where m.expires_at>clock_timestamp() order by m.created_at desc limit 100")).rows;
   return html(`<h1>Перехваченные локальные письма</h1><nav><a href="/__local">Стенд</a><a href="/auth">Вход</a></nav><p>Ничего не отправляется наружу. Обновите страницу после запроса письма.</p>${[...messages.reverse(),...blocks].map(m=>`<article><h2>${escape(m.subject)}</h2><p>${escape(m.to??m.recipient)}</p><pre>${escape(m.text).replace(/https:\/\/127\.0\.0\.1:3045\/auth\/(confirm|reset)#token=([a-f0-9]{64})/g,'<a href="$&">Открыть безопасную локальную ссылку</a>')}</pre></article>`).join('')||'<p>Писем пока нет.</p>'}`);
  }
  return null;
 };
 const server=createServer({key:await readFile(join(stateDirectory,'tls-key.pem')),cert:await readFile(join(stateDirectory,'tls-cert.pem'))},async(req,res)=>{
  try{
   if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||/[\\\x00-\x20]/.test(req.url)){res.writeHead(400,{'cache-control':'no-store'});res.end('Invalid local path');return;}
   if(!allowLocalPrimaryRequest(req,state.origin,process.env.BLIZHNIY_TELEGRAM_PHONE==='enabled')){
    res.writeHead(403,{'content-type':'text/plain','cache-control':'no-store'});res.end('Local origin required');return;
   }
   const path=new URL(req.url,state.origin).pathname;
   let response=req.method==='GET'?await localPage(path):null;
   const body=['GET','HEAD'].includes(req.method)?undefined:await readBody(req);
   const proof=load('account-browser-proof').issueBrowserProof(state.rateSecret,'127.0.0.1',req.headers['user-agent']??'');
   const headers=new Headers(Object.fromEntries(Object.entries(req.headers).filter(([,value])=>typeof value==='string')));
   headers.set('host',new URL(canonical).host);headers.set('x-real-ip','127.0.0.1');
   headers.set('cookie',(req.headers.cookie??'').split(';').filter(part=>!part.trim().startsWith('__Host-blizhniy_human=')).concat(proof.cookie.split(';')[0]).filter(Boolean).join('; '));
   if(req.headers.origin)headers.set('origin',canonical);
   const request=new Request(canonical+req.url,{method:req.method,headers,...(body?{body}:{}),redirect:'error'});
   if(!response&&phoneCallback&&path==='/api/account/phone/telegram/callback')response=await phoneCallback(request,'callback');
   const deletionMatch=/^\/api\/(account|admin)\/deletion\/([a-z]+)$/.exec(path);
   if(!response&&deletionMatch)response=await deletion(request,deletionMatch[2],deletionMatch[1]==='admin');
   if(!response&&['/api/account/register','/api/account/resend','/api/account/recover'].includes(path)){
    const data=await request.clone().json();
    if(typeof data.email!=='string'||!data.email.endsWith('.invalid'))response=Response.json({error:{code:'SYNTHETIC_EMAIL_REQUIRED'}},{status:422});
   }
   if(!response&&path==='/api/account/media')response=await media(request,'upload');
   if(!response&&path==='/api/account/media/read')response=await media(request,'read');
   const photoMatch=/^\/api\/listings\/([a-f0-9-]{36})\/photos\/([a-f0-9-]{36})$/.exec(path);
   if(!response&&photoMatch)response=await publicPhoto(request,photoMatch[1],photoMatch[2]);
   const otherPhoto=/^\/api\/(work|service)-publications\/([a-f0-9-]{36})\/photos\/([a-f0-9-]{36})$/.exec(path);
   if(!response&&otherPhoto)response=await otherPublicPhotos[otherPhoto[1]](request,otherPhoto[2],otherPhoto[3]);
   if(!response&&path==='/api/admin/listing-moderation'&&req.method==='POST'&&(await request.clone().json()).action==='photo')response=await adminPhoto(request);
   if(!response&&/^\/api\/admin\/(work|service)-moderation$/.test(path)&&req.method==='POST'&&(await request.clone().json()).action==='photo'){
    const kind=path.includes('/work-')?'work':'service',type=kind==='work'?'Work':'Service';
    const handler=load('production-'+kind+'-moderation-http')['createProduction'+type+'ModerationHandler'];
    response=await handler({origin:canonical},'admin',()=>({limiter,store:new(load('postgres-'+kind+'-moderation')['Postgres'+type+'ModerationStore'])(runtimeDb,files)}))(request);
   }
   if(!response&&path==='/api/admin/listing-management'&&req.method==='POST'&&(await request.clone().json()).action==='photo'){
    const factory=load('admin-listing-management-http').createAdminListingManagementHandler;
    const store=new(load('postgres-listing-management').PostgresListingManagementStore)(runtimeDb,files);
    response=await factory({origin:canonical},()=>({identity,limiter,store}))(request);
   }
   if(!response&&paymentHandler)response=await paymentHandler(request,context);
   if(response){
    const responseHeaders=Object.fromEntries(response.headers);
    // A login can set both the restricted cookie and the signed CAPTCHA proof.
    const cookies=response.headers.getSetCookie();
    if(cookies.length)responseHeaders['set-cookie']=cookies;
    res.writeHead(response.status,responseHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const outgoing=httpRequest({hostname:'127.0.0.1',port:localPrimaryUpstreamPort,path:req.url,method:req.method,headers:{...Object.fromEntries(headers),'accept-encoding':'identity'}},incoming=>{
    const replyHeaders={...incoming.headers};
    if(replyHeaders.location?.startsWith(canonical))replyHeaders.location=replyHeaders.location.replace(canonical,state.origin);
    replyHeaders['set-cookie']=[...(Array.isArray(replyHeaders['set-cookie'])?replyHeaders['set-cookie']:[]),proof.cookie];
    res.writeHead(incoming.statusCode,replyHeaders);incoming.pipe(res);
   });
   outgoing.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'text/plain','cache-control':'no-store'});res.end('Local app is starting; refresh shortly.');});
   outgoing.setTimeout(30000,()=>outgoing.destroy());outgoing.end(body);
  }catch(error){console.warn('Local ingress request failed:',error?.code??error?.name??'Error');if(!res.headersSent)res.writeHead(503,{'content-type':'text/plain','cache-control':'no-store'});res.end('Local request unavailable');}
 });
 return {server,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));await runtimeDb.close();await ownerDb.close();}};
}
