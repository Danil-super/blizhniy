// Local synthetic account only; no seed/production profile edits or external mail.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='settings-ui-'+randomUUID()+'@local.invalid',password='SyntheticSettings-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.name));
try{
 const registration=await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка настроек',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}});
 assert.equal(registration.status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 await page.goto(origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const settings=page.getByRole('region',{name:'Настройки аккаунта',exact:true});await settings.waitFor();
 const loginEmail=settings.getByLabel('Email для входа',{exact:true});
 assert.equal(await loginEmail.inputValue(),email);assert.equal(await loginEmail.evaluate(input=>input.readOnly&&!input.disabled),true);
 await loginEmail.focus();await loginEmail.pressSequentially('cannot-change');assert.equal(await loginEmail.inputValue(),email);
 for(const width of[320,768,1024,1440]){
  await page.setViewportSize({width,height:1000});const box=await page.locator('#cabinet-profile').boundingBox();assert.ok(box.width<=768&&box.width<=width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow at '+width);
 }
 await page.setViewportSize({width:1440,height:1000});
 const disclosure=settings.locator('details').filter({hasText:'Уведомления'});
 assert.equal(await disclosure.evaluate(element=>element.open),false);
 await disclosure.locator('summary').click();assert.equal(await disclosure.locator('input[type=checkbox]').count(),7);await disclosure.locator('summary').click();
 const name=settings.getByLabel('Имя',{exact:true});await name.fill('1');assert.equal(await name.evaluate(input=>input.checkValidity()),false);
 await name.fill('Данил');await settings.getByLabel('Телефон',{exact:true}).fill('+79991234567');
 await settings.locator('input[name=city]').locator('..').getByRole('button').click();await settings.getByRole('option',{name:'Армавир',exact:true}).click();
 const saved=page.waitForResponse(response=>response.url()===origin+'/api/account/profile'&&response.request().method()==='PUT');
 await settings.getByRole('button',{name:'Сохранить настройки',exact:true}).click();assert.equal((await saved).status(),200);await settings.getByRole('status').filter({hasText:'Настройки сохранены.'}).waitFor();
 await settings.screenshot({path:'/tmp/blizhniy-settings-desktop.png'});
 await page.reload();await page.getByRole('button',{name:'Настройки',exact:true}).click();await settings.waitFor();
 assert.equal(await name.inputValue(),'Данил');assert.equal((await settings.getByLabel('Телефон',{exact:true}).inputValue()).replace(/\D/g,''),'79991234567');assert.equal(await settings.locator('input[name=city]').inputValue(),'Армавир');assert.equal(await loginEmail.inputValue(),email);
 await page.setViewportSize({width:390,height:844});await settings.screenshot({path:'/tmp/blizhniy-settings-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',maxWidth:768,readonlyIdentityEmail:true,namePhoneCityPersisted:true,notificationControls:7,responsive:[320,768,1024,1440],seedProfileTouched:false,productionTouched:false}));
}finally{await browser.close();}
