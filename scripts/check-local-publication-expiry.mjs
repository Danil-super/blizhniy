// Synthetic owner acceptance in the owned loopback fixture; no provider or production calls.
import assert from 'node:assert/strict';
import {randomInt,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {chromium} from 'playwright';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const require=createRequire(import.meta.url),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const runtime=new(load('postgres').PostgresDatabase)(new pg.Pool({...localPrimaryDatabaseConfig(state),max:3}));
const email='expiry-ui-'+randomBytes(8).toString('hex')+'@local.invalid',password='Synthetic-expiry-'+randomBytes(16).toString('hex')+'!';
const hash=await load('identity').hashPassword(password),token=randomBytes(32).toString('hex');
const phone='+7999'+String(randomInt(10_000_000)).padStart(7,'0');
const browser=await chromium.launch({headless:true});let userId,context;
try{
 userId=(await owner.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[email,hash])).rows[0].id;
 const profile=Object.fromEntries(Object.entries(load('cabinet-profile').createDefaultCabinetProfile({name:'Проверка срока',email})).filter(([key])=>!['email','phoneVerified','verifiedPhone'].includes(key)));
 profile.phone=phone;
 await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[userId,JSON.stringify(profile)]);
 // Operator-owned synthetic attestation only; the site's phone policy/guards stay enabled.
 await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[userId,phone,'synthetic-expiry-'+randomUUID()]);
 assert.equal((await owner.query('select app.phone_is_confirmed($1) as verified',[userId])).rows[0].verified,true);
 await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),userId]);
 const common={title:'Проверка окончания размещения',description:'Синтетическая публикация для проверки срока размещения.',cityName:'Краснодар',contactPhone:'+79990000000',placementRightConfirmed:true};
 const work=new(load('postgres-work-publications').PostgresWorkPublicationStore)(runtime),service=new(load('postgres-service-publications').PostgresServicePublicationStore)(runtime);
 const fixtures=[];
 for(const kind of ['vacancy','workRequest','fair']){
  const isWork=kind!=='fair',table=isWork?'work_publications':'service_publications';
  const form={...common,...(kind==='vacancy'?{professionName:'Сантехник',employerType:'person',organization:'Иван Иванов',salary:'45000'}:kind==='workRequest'?{professionName:'Сантехник',budget:'1500'}:{category:'Посуда',email})};
  const row=await(isWork?work:service).create(token,userId,kind,randomUUID(),form);
  await owner.query(`update app.${table} set status='published',is_paid=true,published_at=statement_timestamp(),expires_at=statement_timestamp()+interval '1 day' where id=$1 and author_id=$2`,[row.id,userId]);
  // Simulate elapsed time only for this fixture after a valid publication transition.
  await owner.query(`update app.${table} set published_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where id=$1 and author_id=$2`,[row.id,userId]);
  fixtures.push({kind,id:row.id,table,edit:isWork?`/rabota/${kind==='vacancy'?'vakansii':'zakazy'}/${row.id}/edit`:`/yarmarka-masterov/zayavka?draft=${row.id}`});
 }
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
 const signed=await context.request.post(state.origin+'/api/account/login',{headers:{Origin:state.origin,'X-Blizhniy-Request':'1'},data:{email,password,captchaToken:''}});
 assert.equal(signed.status(),200,'synthetic account login');
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
 for(const item of fixtures){
  const cabinet=item.kind==='vacancy'?'/cabinet/vakansii':item.kind==='workRequest'?'/cabinet/zakazy':'/cabinet/fair-applications';
  await page.goto(state.origin+cabinet);
  await page.getByText(item.kind==='fair'?'Срок размещения истёк':'Истек срок',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Посмотреть',exact:true}).count(),0);
  await page.goto(state.origin+item.edit);
  const period=page.getByRole('region',{name:'Срок размещения',exact:true});await period.waitFor();
  await period.getByText('Срок размещения истёк',{exact:true}).waitFor();
  assert.equal(await period.locator('time').count(),2);
  await period.getByText('Редактирование не продлевает размещение.',{exact:true}).waitFor();
  const saved=(await owner.query(`select status,is_paid,expires_at<clock_timestamp() as expired from app.${item.table} where id=$1 and author_id=$2`,[item.id,userId])).rows[0];
  assert.deepEqual(saved,{status:'published',is_paid:true,expired:true});
 }
 assert.deepEqual(errors,[]);
 console.log('Local expiry UI passed: vacancy/order/fair expired cards, no public link, both placement dates, unchanged paid storage.');
}finally{
 await context?.close();await browser.close();await runtime.close();
 if(userId)await owner.query('delete from app.users where id=$1 and email=$2',[userId,email]);
 await owner.end();
}
