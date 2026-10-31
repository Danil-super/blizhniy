// Real UI + primary HTTP, owned local-only PostgreSQL and exact synthetic mail capture.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {stateDirectory,stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('./local-primary-modules.cjs');
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const email=`avatar-normalized-${randomBytes(8).toString('hex')}@local.invalid`,password='Synthetic-avatar-'+randomBytes(16).toString('hex')+'!';
const browser=await chromium.launch({headless:true});let context,user;const capturedIds=new Set();
try{
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
 const headers={Origin:state.origin,'X-Blizhniy-Request':'1'},api=(action,data)=>context.request.post(state.origin+'/api/account/'+action,{headers,data});
 const legal=load('registration-legal').REGISTRATION_LEGAL_VERSIONS;
 assert.equal((await api('register',{name:'Проверка изображения',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy})).status(),202);
 user=(await owner.query('select id from app.users where email=$1',[email])).rows[0].id;
 let confirmation;
 for(const end=Date.now()+12000;!confirmation;){
  for(const {id}of(await owner.query("select id from app.mail_outbox where user_id=$1 and purpose='confirm'",[user])).rows){
   capturedIds.add(id);try{const mail=JSON.parse(await readFile(join(stateDirectory,'mail-'+id+'.json'),'utf8'));assert.equal(mail.to,email);confirmation=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  assert.ok(Date.now()<end,'own local mail capture must arrive');if(!confirmation)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal((await api('confirm',{token:confirmation})).status(),200);
 const page=await context.newPage(),errors=[],external=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 const current=await (await api('profile',{expectedOwnerId:user})).json();
 const before=(await owner.query('select profile from app.cabinet_profiles where user_id=$1',[user])).rows[0].profile;
 const corrupted='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
 const refused=await context.request.put(state.origin+'/api/account/profile',{headers,data:{expectedOwnerId:user,expectedRevision:current.revision,profile:{...before,avatarDataUrl:corrupted}}});
 assert.equal(refused.status(),422);assert.deepEqual(await refused.json(),{error:{code:'INVALID_INPUT'}});
 assert.deepEqual((await owner.query('select profile from app.cabinet_profiles where user_id=$1',[user])).rows[0].profile,before);
 await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const picker=page.locator('input[type=file]'),waitSave=()=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/profile'&&response.request().method()==='PUT');
 const choose=async(format,color)=>{
  const bytes=await sharp({create:{width:960,height:640,channels:3,background:color}}).withMetadata({orientation:6})[format]().toBuffer();
  await picker.setInputFiles({name:'synthetic-avatar.'+format,mimeType:'image/'+format,buffer:bytes});
  await page.getByRole('heading',{name:'Выберите область аватарки',exact:true}).waitFor();
  const saving=waitSave();await page.getByRole('button',{name:'Применить',exact:true}).click();const response=await saving;assert.equal(response.status(),200);
  const result=await response.json();assert.match(result.profile.avatarDataUrl,/^data:image\/webp;base64,/);
  const output=Buffer.from(result.profile.avatarDataUrl.split(',')[1],'base64'),metadata=await sharp(output).metadata();
  assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.ok(output.length<=300*1024);
  await page.getByRole('heading',{name:'Выберите область аватарки',exact:true}).waitFor({state:'detached'});return result.profile.avatarDataUrl;
 };
 await choose('png','#2474b5');await page.reload();
 const avatar=page.locator('#cabinet-profile img');await avatar.waitFor();await avatar.evaluate(image=>image.decode());assert.equal(await avatar.evaluate(image=>image.naturalWidth),512);
 await page.getByRole('button',{name:'Настройки',exact:true}).click();const replacement=await choose('jpeg','#b54a24');
 const stable=waitSave();await page.getByRole('button',{name:'Сохранить настройки',exact:true}).click();const same=await stable;assert.equal(same.status(),200);assert.ok((await same.json()).profile.avatarDataUrl===replacement,'settings save does not reencode the avatar');
 for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false);}
 const removed=waitSave();await page.getByRole('button',{name:'Удалить',exact:true}).click();const deleted=await removed;assert.equal(deleted.status(),200);assert.equal((await deleted.json()).profile.avatarDataUrl,'');
 await page.reload();await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();assert.equal(await page.locator('#cabinet-profile img').count(),0);
 assert.equal((await owner.query('select profile from app.cabinet_profiles where user_id=$1',[user])).rows[0].profile.avatarDataUrl,'');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('Avatar Chromium passed: malformed direct upload refused, crop/save/replace/reload/remove, server WebP 512x512 without metadata, unchanged saves do not recompress, responsive UI; synthetic local account only.');
}finally{
 await context?.close();await browser.close();
 if(user){for(const {id}of(await owner.query('select id from app.mail_outbox where user_id=$1',[user])).rows)capturedIds.add(id);await owner.query('delete from app.users where id=$1 and email=$2',[user,email]);}
 for(const id of capturedIds)try{await unlink(join(stateDirectory,'mail-'+id+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await owner.end();
}
