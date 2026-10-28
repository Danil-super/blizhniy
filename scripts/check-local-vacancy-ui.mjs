// Real browser, synthetic local account, only simulated purchases.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='vacancy-ui-'+randomUUID()+'@local.invalid',password='SyntheticVacancy-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.name));
const publicationCalls=[];page.on('response',async response=>{if(response.url()===origin+'/api/account/work-publications'&&response.request().method()==='PUT'&&response.status()===200)publicationCalls.push(await response.json());});
try{
 assert.equal((await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка вакансий',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}})).status(),202);
 let token;for(let i=0;i<100&&!token;i++){
  for(const name of(await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 await page.goto(origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(origin+'/');
 const pixels=await sharp({create:{width:400,height:300,channels:3,background:'#497596'}}).png().toBuffer();
 const variants=[{type:'organization',label:'Организация',name:'Мастерская',inn:'7707083893',ogrn:'1027700132195'},
  {type:'ip',label:'ИП',name:'Иванов Иван Иванович',inn:'500100732259'},
  {type:'person',label:'Частное лицо',name:'Иван'}];
 for(const variant of variants){
  await page.goto(origin+'/rabota/vakansii/sozdat');
  const employer=page.getByRole('region',{name:'Данные работодателя',exact:true});await employer.waitFor();
  assert.equal(await page.locator('input[name=title]:visible').count(),0);
  await employer.getByRole('button',{name:new RegExp('^'+variant.label)}).click();
  const field=name=>page.locator(`input[name="${name}"]:visible`);
  await field('organization').fill(variant.name);await field('phone').fill('+79991234567');
  if(variant.inn){
   await field('inn').fill('7707083894');
   if(variant.type==='ip')await field('inn').fill('500100732250');
   await field('contactPerson').fill('Иван Иванов');await field('emailOrMessenger').fill('hr@example.invalid');
   await employer.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
   await employer.getByRole('alert').filter({hasText:'контрольной суммой'}).waitFor();assert.equal(await page.locator('input[name=title]:visible').count(),0);
   await field('inn').fill(variant.inn);if(variant.ogrn)await field('ogrn').fill(variant.ogrn);
   await field('website').fill('https://example.invalid');
  }else await field('messengerUrl').fill('@synthetic_user');
  await employer.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
  const title='Локальная вакансия '+variant.type+' '+randomUUID().slice(0,8);
  await field('title').fill(title);
  const profession=page.getByRole('combobox',{name:'Профессия / специализация',exact:true});
  await profession.fill('несуществующая профессия');await profession.press('Tab');
  await page.getByRole('alert').filter({hasText:'Выберите профессию из списка.'}).waitFor();assert.equal(await profession.evaluate(input=>input.checkValidity()),false);
  await profession.fill('сант');await page.getByRole('listbox',{name:'Профессии',exact:true}).waitFor();await profession.press('ArrowDown');await profession.press('Enter');
  assert.equal(await profession.inputValue(),'Сантехник');assert.equal(await page.getByRole('listbox',{name:'Профессии',exact:true}).count(),0);
  await profession.press('ArrowDown');const dropdown=page.getByRole('listbox',{name:'Профессии',exact:true});assert.ok((await dropdown.boundingBox()).height<=240);
  await profession.press('Escape');assert.equal(await profession.inputValue(),'Сантехник');
  await field('district').fill('Центральный');await field('salary').fill(variant.type==='person'?'45000,50':'45000');await page.locator('select[name=schedule]').selectOption('5/2');await page.locator('select[name=workFormat]').selectOption('На месте');
  for(const name of ['description','responsibilities','requirements','conditions'])await page.locator(`textarea[name=${name}]`).fill('Синтетические данные для проверки сохранности формы: '+name+'.');
  await page.locator('input[name=photos]').setInputFiles({name:'vacancy.png',mimeType:'image/png',buffer:pixels});
  for(const checkbox of await page.locator('form input[type=checkbox]:visible').all())await checkbox.check();
  await page.getByRole('button',{name:'Изменить работодателя',exact:true}).click();assert.equal(await field('organization').inputValue(),variant.name);
  // Switching employer types never resets the original panel or the vacancy/photos.
  const alternate=variant.type==='person'?'ИП':'Частное лицо';await employer.getByRole('button',{name:new RegExp('^'+alternate)}).click();
  await employer.getByRole('button',{name:new RegExp('^'+variant.label)}).click();assert.equal(await field('organization').inputValue(),variant.name);
  await employer.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();assert.equal(await field('title').inputValue(),title);
  assert.equal(await page.locator('input[name=photos]').evaluate(input=>input.files.length),1);
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const row=await page.locator('[data-vacancy-terms]>label').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));
   if(width>=1024)assert.ok(Math.max(...row)-Math.min(...row)<2,'desktop terms share one row');else assert.ok(new Set(row).size===3,'mobile/tablet fields stay readable in one column');
  }
  await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
  const issues=await page.evaluate(async()=>{const result=await window.axe.run(document.querySelector('form'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id);});assert.deepEqual(issues,[]);
  await page.setViewportSize({width:1440,height:1000});
  if(variant.type==='organization')await page.locator('main').screenshot({path:'/tmp/blizhniy-vacancy-form.png'});
  if(variant.type==='person'){
   await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.waitForURL(origin+'/cabinet/vakansii');
   await page.getByRole('button',{name:title,exact:true}).click();
   await page.getByRole('article').filter({hasText:title}).getByRole('link',{name:'Редактировать',exact:true}).click();
   await employer.waitFor();assert.equal(await field('organization').inputValue(),variant.name);
   await employer.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();assert.equal(await field('title').inputValue(),title);
   await page.locator('input[name=workLegalAccepted]').check();
  }
  const dialogErrors=[];const rejectUnexpected=async dialog=>{dialogErrors.push(dialog.type());await dialog.dismiss();};page.on('dialog',rejectUnexpected);
  const paymentKeys=[];
  if(variant.type==='person'){
   let lost=true;
   await page.route('**/api/account/vacancy-checkout',async route=>{
    if(route.request().method()==='PUT'){paymentKeys.push(route.request().postDataJSON().creationKey);if(lost){lost=false;await route.abort('failed');return;}}
    await route.continue();
   });
   await page.getByRole('button',{name:'Перейти к оплате',exact:true}).click();
   await page.getByRole('button',{name:'Проверить сохранённый заказ',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'Заказ не найден.'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Перейти к оплате',exact:true}).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'Сохранить черновик',exact:true}).isDisabled(),true);
  }
  await page.getByRole('button',{name:'Перейти к оплате',exact:true}).click();await page.waitForURL(/\/oplata\/[a-f0-9-]{36}\?type=vacancy$/);
  if(variant.type==='person'){assert.equal(paymentKeys.length,2);assert.equal(paymentKeys[0],paymentKeys[1]);}
  page.off('dialog',rejectUnexpected);assert.deepEqual(dialogErrors,[],'saved explicit payment navigation needs no discard confirmation');
  const saved=publicationCalls.at(-1);assert.equal(saved.form.title,title);assert.equal(saved.form.employerType,variant.type);assert.equal(saved.form.organization,variant.name);assert.equal(saved.form.photoIds.length,1);
  assert.equal(saved.form.professionName,'Сантехник');assert.equal(saved.form.cityName,'Краснодар');assert.equal(saved.form.district,'Центральный');assert.equal(saved.form.salary,variant.type==='person'?'45000.50':'45000.00');assert.equal(saved.form.schedule,'5/2');assert.equal(saved.form.workFormat,'На месте');
  for(const name of ['description','responsibilities','requirements','conditions'])assert.equal(saved.form[name],'Синтетические данные для проверки сохранности формы: '+name+'.');
  if(variant.inn){assert.equal(saved.form.inn,variant.inn);assert.equal(saved.form.contactPerson,'Иван Иванов');assert.equal(saved.form.email,'hr@example.invalid');assert.equal(saved.form.website,'https://example.invalid');}
  await page.getByRole('button',{name:'Открыть локальный симулятор',exact:true}).click();await page.waitForURL(/\/__local\/payment\?/);
  if(variant.type==='organization'){
   await page.getByRole('button',{name:'Оставить в ожидании',exact:true}).click();assert.equal(saved.paid,false);
   await page.goto(origin+'/__local/payment?intent='+new URL(page.url()).searchParams.get('intent')+'&type=vacancy');
  }
  await page.getByRole('button',{name:'Подтвердить успешную оплату',exact:true}).click();await page.getByText('Оплата подтверждена сервером, размещение выполнено.',{exact:false}).waitFor();
  await page.goto(origin+'/vakansiya/'+saved.id);await page.getByRole('heading',{name:title,exact:true}).waitFor();
  const photo=page.locator(`img[src*="/api/work-publications/${saved.id}/photos/"]`).first();await photo.waitFor();await photo.evaluate(img=>img.complete&&img.naturalWidth>0?true:new Promise((resolve,reject)=>{img.addEventListener('load',()=>resolve(true),{once:true});img.addEventListener('error',()=>reject(Error('Saved photo unavailable')),{once:true});}));
  await page.goto(origin+'/rabota/vakansii');await page.getByRole('link',{name:'Открыть вакансию '+title,exact:true}).waitFor();
  console.log(JSON.stringify({variant:variant.type,status:'passed',savedFieldsAndPhoto:true,publishedAfterSimulatedCapture:true}));
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',variants:3,responsive:[320,768,1440],realCharges:false,productionTouched:false}));
}finally{await browser.close();}
