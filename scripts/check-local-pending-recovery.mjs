// Actual primary UI/HTTP, owned loopback PG and local-only mail capture; synthetic account only.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';
import {chromium} from 'playwright';
import {stateDirectory,stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const require=createRequire(import.meta.url),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const suffix=randomBytes(8).toString('hex'),email=`pending-ui-${suffix}@local.invalid`,oldPassword='Synthetic-lost-'+randomBytes(12).toString('hex')+'!',newPassword='Synthetic-recovered-'+randomBytes(12).toString('hex')+'!';
const browser=await chromium.launch({headless:true});let context,user;const capturedIds=new Set();
try{
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
 const headers={Origin:state.origin,'X-Blizhniy-Request':'1'},api=(action,data)=>context.request.post(state.origin+'/api/account/'+action,{headers,data});
 const legal=load('registration-legal').REGISTRATION_LEGAL_VERSIONS;
 const input={name:'Проверка восстановления',email,password:oldPassword,acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy,captchaToken:''};
 const registered=await api('register',input);assert.equal(registered.status(),202);assert.deepEqual(await registered.json(),{status:'accepted'});
 user=(await owner.query('select id from app.users where email=$1',[email])).rows[0].id;
 const capture=async purpose=>{
  for(const end=Date.now()+12000;;){
   const jobs=(await owner.query('select id from app.mail_outbox where user_id=$1 and purpose=$2 order by created_at desc',[user,purpose])).rows;
   for(const {id}of jobs){capturedIds.add(id);try{const mail=JSON.parse(await readFile(join(stateDirectory,'mail-'+id+'.json'),'utf8'));assert.equal(mail.to,email);return mail;}catch(error){if(error.code!=='ENOENT')throw error;}}
   assert.ok(Date.now()<end,'local worker must capture this synthetic mail');await new Promise(resolve=>setTimeout(resolve,100));
  }
 };
 const confirmation=(await capture('confirm')).text.match(/#token=([a-f0-9]{64})/)?.[1];assert.ok(confirmation);
 await owner.query("update app.email_confirmations set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '90 minutes' where user_id=$1",[user]);
 assert.equal((await api('confirm',{token:confirmation})).status(),400);
 const before=(await owner.query('select password_hash,email_verified_at,auth_version::text,role,is_blocked from app.users where id=$1',[user])).rows[0];
 const profile=(await owner.query('select profile from app.cabinet_profiles where user_id=$1',[user])).rows[0].profile;
 const documents=(await owner.query('select document,version,recorded_at::text from app.registration_legal where user_id=$1 order by document',[user])).rows;
 assert.equal(before.email_verified_at,null);assert.equal((await api('login',{email,password:oldPassword,captchaToken:''})).status(),401);
 const page=await context.newPage(),errors=[],foreign=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.name));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}return route.continue();});
 await page.goto(state.origin+'/auth/recover');await page.getByRole('heading',{name:'Восстановление доступа',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);
 const requested=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/recover'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Отправить письмо восстановления',exact:true}).click();const response=await requested;
 assert.equal(response.status(),202);assert.deepEqual(await response.json(),{status:'accepted'});await page.getByText(/Если адрес зарегистрирован и восстановление доступно/).waitFor();
 assert.deepEqual((await owner.query('select password_hash,email_verified_at,auth_version::text,role,is_blocked from app.users where id=$1',[user])).rows[0],before);
 const missing=await api('recover',{email:'missing-'+suffix+'@local.invalid',captchaToken:''});assert.equal(missing.status(),202);assert.deepEqual(await missing.json(),{status:'accepted'});
 const recovery=(await capture('recover')).text.match(/#token=([a-f0-9]{64})/)?.[1];assert.ok(recovery);assert.notEqual(recovery,confirmation);
 assert.equal((await api('confirm',{token:recovery})).status(),400);
 await page.goto(state.origin+'/auth/reset#token='+recovery);await page.getByRole('heading',{name:'Новый пароль',exact:true}).waitFor();
 await page.waitForFunction(()=>window.location.hash==='');assert.equal(new URL(page.url()).search,'');
 assert.deepEqual((await owner.query('select password_hash,email_verified_at,auth_version::text,role,is_blocked from app.users where id=$1',[user])).rows[0],before,'GET/scanner does not mutate pending account');
 await page.getByLabel('Новый пароль',{exact:true}).fill(newPassword);await page.getByLabel('Повторите пароль',{exact:true}).fill(newPassword);
 const reset=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/reset'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Сохранить новый пароль',exact:true}).click();const result=await reset;assert.equal(result.status(),200);assert.deepEqual(await result.json(),{status:'password_reset'});
 assert.equal(Boolean(result.headers()['set-cookie']?.includes('__Host-blizhniy_session=')),false);
 await page.getByRole('link',{name:'Перейти к входу',exact:true}).waitFor();
 const after=(await owner.query('select password_hash,email_verified_at,auth_version::text,role,is_blocked from app.users where id=$1',[user])).rows[0];
 assert.ok(after.email_verified_at);assert.equal(after.auth_version,(BigInt(before.auth_version)+1n).toString());assert.notEqual(after.password_hash,before.password_hash);assert.equal(after.role,before.role);assert.equal(after.is_blocked,before.is_blocked);
 assert.deepEqual((await owner.query('select profile from app.cabinet_profiles where user_id=$1',[user])).rows[0].profile,profile);
 assert.deepEqual((await owner.query('select document,version,recorded_at::text from app.registration_legal where user_id=$1 order by document',[user])).rows,documents);
 assert.equal((await api('session',{})).status(),401);assert.equal((await api('confirm',{token:confirmation})).status(),400);
 assert.equal((await api('reset',{token:recovery,password:oldPassword,captchaToken:''})).status(),400);
 assert.equal((await api('login',{email,password:oldPassword,captchaToken:''})).status(),401);
 const signed=await api('login',{email,password:newPassword,captchaToken:''});assert.equal(signed.status(),200);assert.equal((await api('session',{})).status(),200);
 await capture('reset_notice');
 for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
 assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 console.log('Pending recovery Chromium passed: expired confirmation, unchanged request/GET, captured email, atomic password+email confirmation, no autologin, stale token/password refusal, ordinary login, unchanged profile/legal/role and responsive UI; no external mail or production access.');
}finally{
 await context?.close();await browser.close();
 if(user){for(const {id}of(await owner.query('select id from app.mail_outbox where user_id=$1',[user])).rows)capturedIds.add(id);await owner.query('delete from app.users where id=$1 and email=$2',[user,email]);}
 for(const id of capturedIds)try{await unlink(join(stateDirectory,'mail-'+id+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await owner.end();
}
