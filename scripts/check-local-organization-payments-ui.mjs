// Owned synthetic stand only: profile editing and read-only financial history.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')),account=accounts.find(row=>row.role==='user'),foreign=accounts.find(row=>row.role==='admin');
assert.ok(account&&foreign&&account.email.endsWith('@local.invalid')&&foreign.email.endsWith('@local.invalid'));
const db=new pg.Client(localPrimaryDatabaseConfig(state,'runtime'));await db.connect();
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
const headers={Origin:state.origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'},errors=[],external=[],evidence=[],scriptReads=[];
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.origin);return route.abort();}return route.continue();});
let failFirstHistory=true;
await context.route('**/api/account/payments',route=>{if(failFirstHistory){failFirstHistory=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'PAYMENT_HISTORY_UNAVAILABLE'}})});}return route.continue();});
const onScript=response=>{if(response.request().resourceType()==='script')scriptReads.push(response.text().then(body=>assert.equal(/supabase-js\/|supabase-js-web\/|GoTrueClient|gotrue-js|postgrest-js/.test(body),false,'Primary organization/history downloaded legacy SDK')));};
page.on('response',onScript);
const api=async(path,data,status=200)=>{const response=await context.request.post(state.origin+path,{headers,data});assert.equal(response.status(),status,path);assert.match(response.headers()['cache-control'],/no-store/);return response.json();};
const finance=async()=>createHash('sha256').update(JSON.stringify((await db.query('select id,owner_id,status,target_type,target_id,target_revision::text,created_at::text from app.payment_orders order by id')).rows)).digest('hex');
const baseline=await finance();
try{
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(url=>url.pathname!=='/auth');
 assert.equal((await context.request.post(state.origin+'/api/account/session',{headers,data:{}})).status(),200);
 const original=await api('/api/account/profile',{expectedOwnerId:account.id});
 await page.goto(state.origin+'/cabinet/organization',{waitUntil:'networkidle'});
 const organization=page.locator('form').filter({has:page.locator('input[name=organizationName]')});await organization.waitFor();
 await organization.locator('[name=organizationName]').fill('Локальная проверка организации');await organization.locator('[name=organizationInn]').fill('123');
 assert.equal(await organization.locator('[name=organizationInn]').evaluate(input=>input.checkValidity()),false);
 await organization.locator('[name=organizationInn]').fill('123456789012');await organization.locator('[name=organizationOgrn]').fill('123456789012345');
 await organization.locator('[name=organizationAddress]').fill('Тестовая улица, 1');await organization.locator('[name=organizationDescription]').fill('Локальная проверка сохранения\nВторая строка описания.');
 const written=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/profile'&&response.request().method()==='PUT');
 await organization.getByRole('button',{name:'Сохранить профиль организации',exact:true}).click();assert.equal((await written).status(),200);await page.getByText('Профиль организации сохранен.',{exact:true}).waitFor();
 const saved=await api('/api/account/profile',{expectedOwnerId:account.id});
 assert.equal(saved.profile.organizationName,'Локальная проверка организации');assert.equal(saved.profile.organizationInn,'123456789012');assert.equal(saved.profile.organizationOgrn,'123456789012345');assert.equal(saved.profile.organizationDescription,'Локальная проверка сохранения\nВторая строка описания.');
 for(const key of Object.keys(original.profile).filter(key=>!['organizationName','organizationInn','organizationOgrn','organizationAddress','organizationDescription'].includes(key)))assert.deepEqual(saved.profile[key],original.profile[key],key);
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('[name=organizationInn]').inputValue(),'123456789012');
 const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
 async function visual(path){
  for(const width of [320,768,1440]){
   await page.setViewportSize({width,height:1000});await page.addScriptTag({path:axePath});
   const result=await page.evaluate(async()=>({overflow:document.documentElement.scrollWidth>innerWidth,violations:(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>({id:row.id,targets:row.nodes.map(node=>node.target)}))}));
   evidence.push({path,width,...result});assert.equal(result.overflow,false,path);assert.deepEqual(result.violations,[],path);
  }
 }
 await visual('/cabinet/organization');
 await page.goto(state.origin+'/cabinet/oplata',{waitUntil:'networkidle'});const history=page.getByRole('region',{name:'История платежей'});
 await history.getByRole('alert').waitFor();assert.equal(await history.getByText('Платежей пока нет',{exact:true}).count(),0);
 await history.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await history.locator('li').first().waitFor();
 const body=await api('/api/account/payments',{expectedOwnerId:account.id,cursor:null});
 const expected=(await db.query('select o.id,i.amount::text,o.status from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id where o.owner_id=$1 order by o.created_at desc,o.id desc limit 50',[account.id])).rows;
 assert.equal(body.items.length,expected.length);assert.ok(body.items.length>0,'Run core synthetic checkout acceptance before this check');
 assert.deepEqual(body.items.map(row=>({id:row.id,amount:row.amount,status:row.status})),expected);
 const afterFirst=await api('/api/account/payments',{expectedOwnerId:account.id,cursor:{id:body.items[0].id,createdAt:body.items[0].createdAt}});
 assert.deepEqual(afterFirst.items.map(row=>({id:row.id,amount:row.amount,status:row.status})),expected.slice(1));
 for(const row of body.items)assert.equal(await history.getByText('Заказ '+row.id,{exact:true}).count(),1);
 assert.equal(await history.getByRole('button',{name:'Оплатить',exact:true}).count(),0);
 await api('/api/account/payments',{expectedOwnerId:foreign.id,cursor:null},401);
 await api('/api/account/payments',{expectedOwnerId:account.id,cursor:null,ownerId:foreign.id},422);
 await visual('/cabinet/oplata');
 await Promise.all(scriptReads);page.off('response',onScript);
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.waitForURL(state.origin+'/auth');
 await api('/api/account/payments',{expectedOwnerId:account.id,cursor:null},401);
 assert.equal(await page.getByRole('region',{name:'История платежей'}).count(),0);
 assert.equal(await finance(),baseline,'History checks must not mutate financial orders');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(stateDirectory,'organization-history-ui-'+randomUUID()+'.json'),JSON.stringify({buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),profileSaved:true,historyRows:body.items.length,ownershipDenied:true,logoutDenied:true,financialOrdersUnchanged:true,legacySdkScripts:0,errors,external,evidence},null,2),{mode:0o600});
 console.log(JSON.stringify({profileSaved:true,historyRows:body.items.length,ownershipDenied:true,logoutDenied:true,financialOrdersUnchanged:true,legacySdkScripts:0,visualChecks:evidence.length}));
}finally{page.off('response',onScript);await Promise.allSettled(scriptReads);await context.close();await browser.close();await db.end();}
