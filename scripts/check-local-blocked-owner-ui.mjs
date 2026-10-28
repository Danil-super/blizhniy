// Owned loopback stand only; creates and cleans up fresh synthetic users/listings.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {chromium} from 'playwright';
import {hashPassword} from '../src/lib/identity.ts';
import {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const accounts=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),adminContext=await browser.newContext({ignoreHTTPSErrors:true}),foreignContext=await browser.newContext({ignoreHTTPSErrors:true});
const page=await context.newPage(),admin=await adminContext.newPage(),foreign=await foreignContext.newPage(),users=[],errors=[];
for(const target of [page,admin,foreign])target.on('pageerror',error=>errors.push(error.name));
const origin=state.origin,headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
async function login(target,account){await target.goto(origin+'/auth');await target.getByLabel('Email',{exact:true}).fill(account.email);await target.getByLabel('Пароль',{exact:true}).fill(account.password);await target.getByRole('button',{name:'Войти',exact:true}).click();await target.waitForURL(origin+'/');}
async function createUser(){
 const email='blocked-ui-'+randomUUID()+'@local.invalid',password='SyntheticBlocked-'+randomUUID()+'!';
 const user=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,await hashPassword(password)])).rows[0];users.push(user.id);return{...user,email,password};
}
try{
 assert.equal((await owner.query("select count(*)::int as n from blizhniy_meta.migrations where name='0029-listing-owner-removals.sql'")).rows[0].n,1,'Apply explicitly reviewed local29 migration before this browser check');
 const user=await createUser(),other=await createUser(),stamp=randomUUID().slice(0,8),reason='Локальная проверка: исправьте описание.';
 let listing;
 await owner.query('begin');
 try{
  for(let index=0;index<16;index++){
   const row=(await owner.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,status,is_paid,published_at,expires_at)
    select $1,'sell',c.id,city.id,$2,'Подробное синтетическое описание для проверки кабинета и сохранения данных.','+79990000000','published',true,clock_timestamp(),clock_timestamp()+interval '1 day'
    from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id,title`,[user.id,`Проверка удаления ${stamp} — ${index+1}`])).rows[0];
   await owner.query('insert into app.listing_blocks(listing_id,blocked_by,blocked_revision,reason) values($1,$2,1,$3)',[row.id,user.id,reason]);
   listing=row;
  }
  await owner.query('commit');
 }catch(error){await owner.query('rollback');throw error;}
 await login(page,user);await login(admin,accounts.find(item=>item.role==='admin'));await login(foreign,other);
 await page.goto(origin+'/cabinet/obyavleniya');
 const area=page.getByRole('region',{name:'Прокручиваемый список моих объявлений',exact:true});await area.waitFor();
 const card=area.getByRole('article').filter({has:page.getByRole('heading',{name:listing.title,exact:true})});
 await card.getByText('Заблокировано',{exact:true}).waitFor();
 const box=await area.evaluate(element=>({height:element.clientHeight,scroll:element.scrollHeight,overflow:getComputedStyle(element).overflowY,limit:innerHeight*.65}));
 assert.equal(box.overflow,'auto');assert.ok(box.height<=box.limit+2);assert.ok(box.scroll>box.height);
 await area.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('[aria-label="Прокручиваемый список моих объявлений"]').scrollTop>0);
 await card.locator('summary').filter({hasText:'Действия'}).click();await card.getByRole('link',{name:'Редактировать',exact:true}).click();
 await page.getByRole('heading',{name:'Редактировать объявление',exact:true}).waitFor();
 const editedTitle=listing.title+' исправлено';await page.locator('input[name=title]').fill(editedTitle);
 await page.locator('input[name=placementRightsAccepted]').check();
 await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.waitForURL(origin+'/cabinet/obyavleniya');
 const editedCard=area.getByRole('article').filter({has:page.getByRole('heading',{name:editedTitle,exact:true})});await editedCard.getByText('Заблокировано',{exact:true}).waitFor();assert.ok((await editedCard.innerText()).includes(reason));
 const revision=(await owner.query('select revision::text from app.listings where id=$1',[listing.id])).rows[0].revision;
 const audit=async()=>({listing:(await owner.query('select * from app.listings where id=$1',[listing.id])).rows,block:(await owner.query('select * from app.listing_blocks where listing_id=$1',[listing.id])).rows,
  payments:(await owner.query("select * from app.payment_orders where target_type='listing' and target_id=$1",[listing.id])).rows});
 const before=await audit();
 const foreignResponse=await foreignContext.request.post(origin+'/api/account/listing-removal',{headers,data:{action:'remove',expectedOwnerId:other.id,listingId:listing.id,expectedRevision:revision}});assert.equal(foreignResponse.status(),404);
 let removes=0,reads=0;
 await page.route('**/api/account/listing-removal',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='remove'){removes++;assert.equal(body.expectedRevision,revision);const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');return;}
  reads++;await route.continue();
 });
 page.on('dialog',dialog=>dialog.accept());
 await editedCard.locator('summary').filter({hasText:'Действия'}).click();await editedCard.getByRole('button',{name:'Удалить',exact:true}).click();
 await editedCard.getByRole('alert').filter({hasText:'Результат пока неизвестен'}).waitFor();
 assert.equal(await editedCard.getByRole('button',{name:'Удалить',exact:true}).isDisabled(),true);assert.equal(removes,1);assert.equal(reads,0);
 await editedCard.getByRole('button',{name:'Проверить удаление',exact:true}).click();await editedCard.waitFor({state:'detached'});
 assert.equal(removes,1);assert.equal(reads,1);assert.deepEqual(await audit(),before);
 await admin.goto(origin+'/admin/obyavleniya/'+listing.id);
 const detail=admin.getByRole('region',{name:'Управление объявлением',exact:true});await detail.waitFor();
 await detail.getByRole('heading',{name:editedTitle,exact:true}).waitFor();assert.ok((await detail.innerText()).includes(reason));
 assert.equal((await owner.query('select count(*)::int as n from app.listing_owner_removals where listing_id=$1',[listing.id])).rows[0].n,1);
 const staleEdit=await context.request.post(origin+'/api/account/listing-form',{headers,data:{expectedOwnerId:user.id,listingId:listing.id}});assert.equal(staleEdit.status(),404);
  assert.equal((await page.goto(origin+'/razmestit/obyavlenie?draft='+listing.id)).status(),404);
  await page.goto(origin+'/cabinet/obyavleniya');
 await page.reload();await area.waitFor();assert.equal(await page.getByRole('heading',{name:editedTitle,exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',blockedEdit:true,reasonPreserved:true,boundedOwnerScroll:true,ownerRemoval:true,lostReplyReadback:true,noAutomaticRetries:true,foreignDenied:true,administratorAuditPreserved:true,productionTouched:false,realCharges:false}));
}finally{
 await browser.close();
 try{if(users.length)await owner.query('delete from app.users where id=any($1::uuid[])',[users]);}finally{await owner.end();}
}
