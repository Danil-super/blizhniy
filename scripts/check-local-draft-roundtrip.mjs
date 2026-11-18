// Owned synthetic stand only. Creates clearly marked drafts; never prepares payment.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import {chromium} from 'playwright';import sharp from 'sharp';import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {observeBrowserHydration} from './local-browser-hydration.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);assert.equal(state.origin,'https://127.0.0.1:3045');
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule,db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();
const run=randomUUID(),email=`draft-${run}@local.invalid`,password=`Synthetic-${randomUUID()}!`,phone='+79991112233',messenger='https://t.me/synthetic_roundtrip';let phase='fixture';
const browser=await chromium.launch(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],payments=[],results=[];page.setDefaultTimeout(12000);
const hydration=await observeBrowserHydration(context);
page.on('pageerror',error=>errors.push(error.name));page.on('request',request=>{const path=new URL(request.url()).pathname;if(/\/api\/account\/.*checkout$/.test(path)&&request.method()==='PUT')payments.push(path);});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
const image=await sharp({create:{width:800,height:600,channels:3,background:'#34805b'}}).png().toBuffer();
async function city(name){const root=page.locator(`input[type=hidden][name="${name}"]`).locator('..');await root.locator(':scope > button').click();await root.getByRole('option',{name:'Армавир, Краснодарский край',exact:true}).click();}
async function profession(){const input=page.getByRole('combobox',{name:'Профессия / специализация',exact:true});await page.locator('input[name="profession"][data-reference-state="empty"]').waitFor();await input.fill('Сантехник');await page.getByRole('option').filter({hasText:'Сантехник'}).first().click();assert.equal(await input.inputValue(),'Сантехник');}
async function saved(kind){for(const checkbox of await page.locator('form input[type=checkbox]:visible').all())await checkbox.check();const path=kind==='listing'?'/api/account/listing-form':'/api/account/work-publications',response=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='PUT');await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();const reply=await response;assert.equal(reply.status(),200);const value=await reply.json();await page.waitForURL(state.origin+'/cabinet/'+(kind==='listing'?'obyavleniya':kind==='vacancy'?'vakansii':'zakazy'));return value;}
async function open(kind,id){await page.goto(state.origin+(kind==='listing'?'/razmestit/obyavlenie?draft='+id:'/rabota/'+(kind==='vacancy'?'vakansii':'zakazy')+'/'+id+'/edit'));if(kind==='vacancy')await page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();await page.locator('input[name="title"]:visible').waitFor();}
function verify(snapshot,kind,title){assert.equal(snapshot.form.title,title);assert.equal(snapshot.form.cityName,'Армавир');assert.equal(snapshot.form.contactPhone.replace(/\D/g,''),phone.slice(1));assert.equal(snapshot.form.messengerUrl,messenger);assert.equal(snapshot.form[kind==='listing'?'price':kind==='vacancy'?'salary':'budget'],'1250.50');assert.equal(snapshot.form.photoIds.length,2);assert.equal(snapshot.photos.length,2);assert.ok(snapshot.photos.every(photo=>photo.mimeType==='image/webp'));}
async function saveAfterDisconnect(kind, initial) {
 const endpoint = state.origin + (kind === 'listing' ? '/api/account/listing-form' : '/api/account/work-publications');
 const save = page.getByRole('button',{name:'Сохранить черновик',exact:true});
 const readback = page.getByRole('button',{name:'Проверить сохранённую форму',exact:true});
 const title = page.locator('input[name="title"]:visible');
 const intended = await title.inputValue();
 const revisions = [];
 const observe = request => {
  if (request.url() === endpoint && request.method() === 'PUT') revisions.push(request.postDataJSON().expectedRevision);
 };
 for (const checkbox of await page.locator('form input[type=checkbox]:visible').all()) await checkbox.check();
 const held = Promise.withResolvers();
 const intercept = async route => {
  if (route.request().method() !== 'PUT') return route.continue();
  await held.promise;
  await route.abort('internetdisconnected');
 };
 page.on('request', observe);
 await page.route(endpoint, intercept);
 try {
  phase='double-click-'+kind;
  const attempted = page.waitForRequest(r=>r.url()===endpoint&&r.method()==='PUT');
  await save.dblclick();
  await attempted;
  assert.deepEqual(revisions,[initial.revision]);
  phase='offline-'+kind;
  await context.setOffline(true);
  held.resolve();
  await readback.waitFor();
  const failedRead = page.waitForEvent('requestfailed',r=>r.url()===endpoint&&r.method()==='POST');
  await readback.click();await failedRead;
  assert.equal(await title.inputValue(),intended);
  assert.equal(await page.locator('figure').count(),2);
  assert.deepEqual(revisions,[initial.revision]);

  phase='reconnect-'+kind;
  await context.setOffline(false);
  await page.unroute(endpoint,intercept);
  await readback.click();
  await page.getByText('На сервере прежняя версия. Ваши правки остались в форме. Повторите сохранение.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Сохранённая форма'}).count(),0);
  assert.equal(await title.inputValue(),intended);
  const success = page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='PUT');
  await save.click();
  const response=await success;
  assert.equal(response.status(),200);
  const snapshot=await response.json();
  await page.waitForURL(state.origin+'/cabinet/'+({listing:'obyavleniya',vacancy:'vakansii',workRequest:'zakazy'}[kind]));
  assert.deepEqual(revisions,[initial.revision,initial.revision]);
  return snapshot;
 } finally {
  held.resolve();
  await context.setOffline(false);
  await page.unroute(endpoint,intercept);
  page.off('request',observe);
 }
}
async function checkConcurrentEdit(kind, snapshot, owner) {
 const stale = await context.newPage();
 stale.on('pageerror', error => errors.push(error.name));
 const endpoint = state.origin + (kind === 'listing' ? '/api/account/listing-form' : '/api/account/work-publications');
 const save = {name:'Сохранить черновик', exact:true};
 const readback = {name:'Проверить сохранённую форму', exact:true};
 const titleField = 'input[name="title"]:visible';
 const winningTitle = snapshot.form.title + ' А';
 const staleTitle = snapshot.form.title + ' Б';
 const writes = [];
 const observe = request => {
  if (request.url() === endpoint && request.method() === 'PUT') writes.push(request.postDataJSON().expectedRevision);
 };
 context.on('request', observe);
 try {
  await stale.goto(page.url());
  if (kind === 'vacancy') await stale.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();
  await stale.locator('figure img').nth(1).waitFor();
  assert.equal(await stale.locator(titleField).inputValue(), snapshot.form.title);
  await stale.locator(titleField).fill(staleTitle);
  await page.locator(titleField).fill(winningTitle);
  await page.locator('textarea[name="description"]').fill('');
  for (const tab of [page,stale]) {
   for (const checkbox of await tab.locator('form input[type=checkbox]:visible').all()) await checkbox.check();
  }
  // Forward the ordinary write, then drop only its browser response.
  let committed;
  await page.route(endpoint, async route => {
   if (route.request().method() !== 'PUT') return route.continue();
   const response = await route.fetch({maxRedirects:0});
   committed = {status:response.status(), data:await response.json()};
   await response.dispose();
   await route.abort('failed');
  });
  phase='lost-write-'+kind;
  await page.getByRole('button',save).click();
  phase='lost-write-readback-'+kind;
  await page.getByRole('button',readback).click();
  await page.waitForURL(state.origin + '/cabinet/' + ({listing:'obyavleniya',vacancy:'vakansii',workRequest:'zakazy'}[kind]));
  await page.getByRole('article').filter({hasText:winningTitle}).getByText('Черновик',{exact:true}).waitFor();
  assert.equal(committed?.status,200);
  assert.equal(committed.data.id,snapshot.id);
  assert.equal(BigInt(committed.data.revision),BigInt(snapshot.revision)+1n);
  assert.deepEqual(writes,[snapshot.revision]);

  phase='stale-write-'+kind;
  const [refused] = await Promise.all([
   stale.waitForResponse(res => res.url() === endpoint && res.request().method() === 'PUT'),
   stale.getByRole('button',save).click()
  ]);
  assert.equal(refused.status(),409);
  phase='stale-write-readback-'+kind;
  await stale.getByRole('button',readback).click();
  const conflict = stale.getByRole('region',{name:'Сохранённая форма'});
  await conflict.waitFor();
  assert.equal(JSON.parse(await conflict.locator('pre').innerText()).title,winningTitle);
  assert.equal(await stale.locator(titleField).inputValue(),staleTitle);
  const response = await context.request.post(endpoint,{
   headers:{Origin:state.origin,'X-Blizhniy-Request':'1','X-Blizhniy-Profession-Refs':'1','Sec-Fetch-Site':'same-origin'},
   data:kind === 'listing' ? {expectedOwnerId:owner,listingId:snapshot.id} :
    {expectedOwnerId:owner,action:'read',kind,publicationId:snapshot.id}
  });
  assert.equal(response.status(),200);
  const current = await response.json();
  assert.equal(current.id,snapshot.id);
  assert.equal(current.revision,committed.data.revision);
  assert.deepEqual(current.form,{...snapshot.form,title:winningTitle,description:''});
  if (kind !== 'listing') {
   assert.equal(current.status,'draft');
   assert.equal(current.professionId,snapshot.professionId);
  }
  assert.deepEqual(writes,[snapshot.revision,snapshot.revision]);
 } finally {
  context.off('request',observe);
  await page.unroute(endpoint);
  await stale.close();
 }
}
try{
 const user=(await db.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,await load('identity').hashPassword(password)])).rows[0].id;
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify(load('postgres-profile').parseProductionProfile({name:'Синтетический автор черновиков',phone,city:'Краснодар'}))]);
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(state.origin+'/');
 for(const kind of ['listing','vacancy','workRequest']){
  phase='create-'+kind;const title=`Проверка черновика ${kind} ${run.slice(0,8)}`,description='Синтетическое описание.\nПроверка сохранения второй строки.';
  await page.goto(state.origin+(kind==='listing'?'/razmestit/obyavlenie':kind==='vacancy'?'/rabota/vakansii/sozdat':'/rabota/zakazy/sozdat'));
  if(kind==='vacancy'){await page.getByRole('button',{name:/^Частное лицо/}).click();await page.locator('input[name="organization"]:visible').fill('Синтетический работодатель');await page.locator('input[name="phone"]:visible').fill(phone);await page.locator('input[name="messengerUrl"]:visible').fill(messenger);await page.getByRole('button',{name:'Продолжить к вакансии',exact:true}).click();}
  await page.locator('input[name="title"]:visible').fill(title);await page.locator('textarea[name="description"]').fill(description);await city(kind==='listing'||kind==='vacancy'?'location':'city');
  if(kind!=='listing')await profession();await page.locator(`input[name="${kind==='listing'?'price':kind==='vacancy'?'salary':'budget'}"]`).fill('1250,50');
  if(kind!=='vacancy'){await page.locator('input[name="phone"]:visible').fill(phone);await page.locator('input[name="messengerUrl"]:visible').fill(messenger);}
  else{await page.locator('select[name="schedule"]').selectOption('5/2');await page.locator('select[name="workFormat"]').selectOption('Удалённо');for(const name of ['responsibilities','requirements','conditions'])await page.locator(`textarea[name="${name}"]`).fill(`Синтетическое поле ${name}.`);}
  await page.locator('input[type="file"][name="photos"]').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image}]);
  const initial=await saved(kind);verify(initial,kind,title);assert.equal(initial.form.description,description);if(kind==='vacancy'){assert.equal(initial.form.employerType,'person');assert.equal(initial.form.organization,'Синтетический работодатель');assert.equal(initial.form.schedule,'5/2');assert.equal(initial.form.workFormat,'Удалённо');}
  phase='reopen-'+kind;await open(kind,initial.id);assert.equal(await page.locator('input[name="title"]:visible').inputValue(),title);assert.equal(await page.locator('textarea[name="description"]').inputValue(),description);await page.locator('figure img').nth(1).waitFor();assert.equal(await page.locator('figure').count(),2);
  if(kind!=='listing')assert.equal(await page.locator('input[name="professionId"]').inputValue(),initial.professionId);assert.equal(Number((await page.locator(`input[name="${kind==='listing'?'price':kind==='vacancy'?'salary':'budget'}"]`).inputValue()).replace(',','.')),1250.5);
  await page.locator('input[name="title"]:visible').fill(title+' — правка');const updated=await saveAfterDisconnect(kind,initial);verify(updated,kind,title+' — правка');assert.equal(updated.id,initial.id);assert.equal(BigInt(updated.revision),BigInt(initial.revision)+1n);assert.deepEqual(updated.form.photoIds,initial.form.photoIds);assert.equal(updated.form.description,description);
  phase='verify-'+kind;await open(kind,updated.id);assert.equal(await page.locator('input[name="title"]:visible').inputValue(),title+' — правка');await page.locator('figure img').nth(1).waitFor();
  const publicPath=(kind==='listing'?'/obyavlenie/':kind==='vacancy'?'/vakansiya/':'/rabota/zakazy/')+updated.id;assert.equal((await context.request.get(state.origin+publicPath)).status(),404);
  phase='competing-edit-'+kind;await checkConcurrentEdit(kind,updated,user);
  results.push({kind,id:initial.id,fields:true,photos:2,samePhotosAfterEdit:true,singleRevision:true,doubleClickSingleWrite:true,offlineReadFailed:true,explicitRetryAfterReconnect:true,lostReplyRecovered:true,staleTabDenied:true});
 }
 assert.equal((await db.query('select count(*)::int n from app.payment_orders where owner_id=$1',[user])).rows[0].n,0);assert.deepEqual(payments,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(hydration,[]);
 const owned = (await db.query(`select
   (select count(*)::int from app.listings where author_id=$1) as listings,
   (select count(*)::int from app.work_publications where author_id=$1 and kind='vacancy') as vacancies,
   (select count(*)::int from app.work_publications where author_id=$1 and kind='workRequest') as orders`,[user])).rows[0];
 assert.deepEqual(owned,{listings:1,vacancies:1,orders:1});
 await writeFile(join(stateDirectory,'draft-roundtrip-'+run+'.json'),JSON.stringify({run,user,results,owned},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'passed',types:results.map(row=>row.kind),drafts:3,edited:3,photosPreserved:true,paymentOrders:0,pageErrors:0,productionTouched:false}));
}catch(error){await Promise.allSettled([page.screenshot({path:join(stateDirectory,'draft-roundtrip-'+run+'-failure.png'),fullPage:true}),writeFile(join(stateDirectory,'draft-roundtrip-'+run+'-errors.json'),JSON.stringify({errors,hydration},null,2)+'\n',{flag:'wx',mode:0o600})]);console.error(JSON.stringify({status:'failed',phase,error:error?.name,check:error?.code==='ERR_ASSERTION'?error.message.slice(0,800):String(error?.message).split('\n')[0].slice(0,400)}));process.exitCode=1;}
finally{await context.close();await browser.close();await db.end();}
