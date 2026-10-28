// Local synthetic account only. Real HTTP/forms, no SQL writes, moderation or payment calls.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {chromium} from 'playwright';import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='validation-ui-'+randomUUID()+'@local.invalid',password='SyntheticValidation-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],writes=[];
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.name));
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)throw Error('External browser request is forbidden');
 assert.ok(!/checkout|payment/.test(url.pathname),'No payment calls in this test');
 if(/moderation/.test(url.pathname))assert.ok(request.method()==='POST'&&url.pathname==='/api/account/service-moderation','Only reading owner moderation status is allowed');
 if(url.pathname==='/api/account/service-publications'&&request.method()==='PUT')writes.push(request.postDataJSON());
 return route.continue();
});
try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Локальная проверка',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const sessionResponse=await context.request.post(origin+'/api/account/session',{headers,data:{}});assert.equal(sessionResponse.status(),200);const session=await sessionResponse.json(),owner=session.user.id;
 const readProfile=async()=>{const response=await context.request.post(origin+'/api/account/profile',{headers,data:{expectedOwnerId:owner}});assert.equal(response.status(),200);return response.json();};
 const before=await readProfile(),pixels=await sharp({create:{width:128,height:128,channels:3,background:'#075985'}}).png().toBuffer(),avatar='data:image/png;base64,'+pixels.toString('base64');
 const profile={...before.profile,name:'Анна-Мария',phone:'+79991234567',avatarDataUrl:avatar};
 assert.equal((await context.request.put(origin+'/api/account/profile',{headers,data:{expectedOwnerId:owner,expectedRevision:before.revision,profile}})).status(),200);
 for(const patch of [{name:'12345'},{phone:'abcdef'},{organizationWebsite:'javascript:alert(1)'},{organizationDescription:'<img src=x onerror=alert(1)>'}]){
  const snapshot=await readProfile();const response=await context.request.put(origin+'/api/account/profile',{headers,data:{expectedOwnerId:owner,expectedRevision:snapshot.revision,profile:{...snapshot.profile,...patch}}});assert.equal(response.status(),422);
 }
 await page.goto(origin+'/rabota/specialisty/anketa');const form=page.getByRole('form',{name:'Анкета специалиста'}),field=name=>form.locator(`[name="${name}"]`);
 await field('title').waitFor({state:'attached'});await page.getByText('Анна-Мария',{exact:true}).first().waitFor();
 assert.equal(await field('title').getAttribute('type'),'hidden');assert.equal(await field('title').inputValue(),'Анна-Мария');
 assert.equal(await form.locator('input[type=file], [name=district], [name=videoUrl]').count(),0);
 assert.equal(await form.getByAltText('Фото из профиля').getAttribute('src'),avatar);
 const profession=form.getByRole('combobox',{name:'Профессия / специализация'});
 await profession.fill('Несуществующая профессия');await profession.press('Tab');await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();assert.equal(writes.length,0);assert.equal(await profession.evaluate(input=>input.checkValidity()),false);
 await profession.fill('сант');await form.getByRole('option',{name:'Сантехник',exact:true}).click();
 await field('price').fill('1e3');assert.equal(await field('price').evaluate(input=>input.checkValidity()),false);await field('price').fill('1500,50');
 await field('skills').fill('<script>alert(1)</script>');assert.equal(await field('skills').evaluate(input=>input.checkValidity()),false);
 await field('skills').fill('Монтаж и ремонт 2 комнат — гарантия.');await field('experience').fill('5 лет');await field('description').fill('Выполняю ремонт сантехники, монтаж и обслуживание.');
 const responsePromise=page.waitForResponse(response=>response.url()===origin+'/api/account/service-publications'&&response.request().method()==='PUT');
 await form.getByRole('button',{name:'Сохранить черновик',exact:true}).click();const response=await responsePromise;assert.equal(response.status(),200);const saved=await response.json();
 assert.equal(saved.form.title,'Анна-Мария');assert.equal(saved.form.price,'1500.50');assert.deepEqual(saved.form.photoIds,[]);assert.deepEqual(saved.photos,[]);assert.equal(saved.form.videoUrl,null);assert.equal(saved.form.district,null);
 await page.waitForURL(origin+'/cabinet/specialist');
 await page.goto(origin+'/rabota/specialisty/anketa?draft='+saved.id);await field('skills').waitFor();assert.equal(await field('skills').inputValue(),saved.form.skills);assert.equal(await field('price').inputValue(),'1500,50');assert.equal(await profession.inputValue(),'Сантехник');
 for(const width of[320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)}));});assert.deepEqual(violations,[]);
  await page.screenshot({path:`/tmp/blizhniy-specialist-validation-${width}.png`,fullPage:true});
 }
 // Server identity is authoritative even for a handcrafted request from the owner.
 const forged=await context.request.put(origin+'/api/account/service-publications',{headers,data:{action:'update',kind:'specialist',expectedOwnerId:owner,publicationId:saved.id,expectedRevision:saved.revision,form:{...saved.form,title:'Подменённое имя',district:'Район',videoUrl:'https://example.invalid/video',photoIds:[randomUUID()]}}});assert.equal(forged.status(),200);const canonical=await forged.json();assert.equal(canonical.form.title,'Анна-Мария');assert.deepEqual(canonical.form.photoIds,[]);assert.equal(canonical.form.district,null);assert.equal(canonical.form.videoUrl,null);
 for(const [path,label] of [['/razmestit/obyavlenie','listing'],['/rabota/zakazy/sozdat','order'],['/yarmarka-masterov/zayavka','fair'],['/reklama/begushchaya-stroka','marquee']]){
  await page.goto(origin+path);const title=page.locator('form input[name=title]').first();await title.waitFor();await title.fill('<img src=x onerror=alert(1)>');assert.equal(await title.evaluate(input=>input.checkValidity()),false,label);await title.fill(label==='marquee'?'Длинный рекламный текст':'Ремонт 2 комнат');assert.equal(await title.evaluate(input=>input.checkValidity()),true,label);
 }
 await page.goto(origin+'/rabota/vakansii/sozdat');await page.getByRole('button',{name:/Частное лицо/}).click();const employer=page.locator('input[name=organization]:enabled');await employer.fill('Иван123');assert.equal(await employer.evaluate(input=>input.checkValidity()),false);await employer.fill('Иван-Пётр');assert.equal(await employer.evaluate(input=>input.checkValidity()),true);
 await page.goto(origin+'/cabinet?settings=1');const settings=page.getByRole('region',{name:'Настройки аккаунта',exact:true});await settings.waitFor();await settings.getByLabel('Имя',{exact:true}).fill("О'Коннор");assert.equal(await settings.getByLabel('Имя',{exact:true}).inputValue(),"О'Коннор");assert.equal(await settings.getByLabel('Имя',{exact:true}).evaluate(input=>input.checkValidity()),true);
 await page.goto(origin+'/cabinet/organization');const website=page.locator('input[name=organizationWebsite]');await website.waitFor();await website.fill('javascript:alert(1)');assert.equal(await website.evaluate(input=>input.checkValidity()),false);await website.fill('https://example.invalid');assert.equal(await website.evaluate(input=>input.checkValidity()),true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',specialistProfileIdentity:true,avatarSha256:createHash('sha256').update(pixels).digest('hex'),savedAndReopened:true,serverRefusesInvalidProfile:true,serverRejectsIdentityForgery:true,fieldValidationSections:['profile','organization','listing','vacancy','order','specialist','fair','marquee'],responsive:[320,768,1024,1440],axeSeriousCritical:0,productionTouched:false,realCharges:false}));
}finally{await browser.close();}
