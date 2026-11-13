// Owned synthetic stand: real upload/replay, then UI handling of a finite quota refusal.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const account=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(row=>row.role==='user');
assert.ok(account?.email.endsWith('@local.invalid'));
const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
const headers={Origin:state.origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'},errors=[],external=[];
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.name));
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.origin);return route.abort();}return route.continue();});
const api=async(path,data,method='post')=>{const response=await context.request[method](state.origin+path,{headers,data:{expectedOwnerId:account.id,...data}});assert.equal(response.status(),200,path);return response.json();};
const accounting=async()=>({owner:(await db.query('select count(*)::int n,coalesce(sum(size),0)::text bytes from app.media_objects where owner_id=$1',[account.id])).rows[0],budget:(await db.query('select charged_objects,charged_bytes::text from app.media_storage_budget')).rows});
try{
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 const image=await sharp({create:{width:800,height:600,channels:3,background:'#9abfc9'}}).webp().toBuffer(),intent=randomUUID();
 const upload=async()=>{const response=await context.request.post(state.origin+'/api/account/media',{headers:{...headers,'Content-Type':'image/webp','X-Blizhniy-Owner':account.id,'X-Blizhniy-Intent':intent},data:image});assert.equal(response.status(),200);assert.match(response.headers()['cache-control'],/no-store/);return response.json();};
 const before=await accounting(),photo=await upload(),after=await accounting();assert.equal(after.owner.n,before.owner.n+1);
 assert.deepEqual(await upload(),photo);assert.deepEqual(await accounting(),after);
 const title='Проверка сообщения квоты — '+randomUUID().slice(0,8);
 const draft=await api('/api/account/work-publications',{action:'create',kind:'workRequest',creationKey:randomUUID(),form:{kind:'workRequest',title,description:'Синтетическая проверка сохранности формы при отказе загрузки.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,budget:'3500'}},'put');
 await page.goto(state.origin+'/rabota/zakazy/'+draft.id+'/edit');await page.locator('input[name=title]:visible').waitFor();
 const hint=page.getByText(/Для публикаций на аккаунт — до 500 фото и 250 МБ/);await hint.waitFor();
 let refused=0;await context.route('**/api/account/media',route=>{assert.equal(route.request().method(),'POST');refused++;return route.fulfill({status:409,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({error:{code:'MEDIA_OWNER_QUOTA_EXCEEDED'}})});});
 const stable=await accounting();await page.locator('input[type=file][name=photos]').setInputFiles({name:'quota-check.webp',mimeType:'image/webp',buffer:image});
 await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();await page.getByRole('alert').filter({hasText:'250'}).waitFor();
 assert.equal(refused,1);assert.equal(await page.locator('input[name=title]:visible').inputValue(),title);assert.equal(await page.locator('input[type=file][name=photos]').evaluate(input=>input.files.length),1);assert.deepEqual(await accounting(),stable);
 const unchanged=await api('/api/account/work-publications',{action:'read',kind:'workRequest',expectedOwnerId:account.id,publicationId:draft.id});assert.equal(unchanged.revision,draft.revision);
 for(const width of [320,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 for(const path of ['/razmestit/obyavlenie','/rabota/zakazy/sozdat']){page.once('dialog',dialog=>dialog.accept());await page.goto(state.origin+path);await page.getByText(/Для публикаций на аккаунт — до 500 фото и 250 МБ/).waitFor();}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),upload:true,readyReplay:true,quotaUiRefusals:refused,formPreserved:true,accountingUnchangedOnRefusal:true,viewportChecks:2,errors,external};
 await writeFile(join(stateDirectory,'media-owner-browser-'+randomUUID()+'.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();await db.end();}
