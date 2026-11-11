// Real compiled HTTP + SQL + browser acceptance on the owned local stand only.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {createRequire} from 'node:module';
import pg from 'pg';
import {chromium} from 'playwright';
import {prepareLocalPrimaryFixture,localPrimaryDatabaseConfig,stateDirectory} from './local-primary-fixture.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {hashSessionToken}=load('identity');
const {createDefaultCabinetProfile}=load('cabinet-profile');
const state=await prepareLocalPrimaryFixture();assert.equal(new URL(state.origin).hostname,'127.0.0.1');
const config=localPrimaryDatabaseConfig(state,'owner');assert.equal(config.host,'127.0.0.1');
const db=new pg.Client(config);await db.connect();const ca=await readFile(join(stateDirectory,'tls-cert.pem'));
const principals=[],bookings=[];let listingId,browser;
const send=(user,body)=>new Promise((resolve,reject)=>{
 const bytes=Buffer.from(JSON.stringify(body)),req=httpsRequest(state.origin+'/api/account/bookings',{method:['create','decide','cancel'].includes(body.action)?'PUT':'POST',ca,
  headers:{origin:state.origin,'content-type':'application/json','content-length':String(bytes.length),'x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+user.token}},response=>{
  const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks))});}catch{reject(Error('Invalid owned local response'));}});
 });req.setTimeout(15000,()=>req.destroy(Error('Owned local request timed out')));req.on('error',reject);req.end(bytes);
});
try{
 for(const name of ['Проверка хозяина','Проверка гостя']){
  const id=randomUUID(),token=randomBytes(32).toString('hex'),phone='+7999'+String(randomInt(1000000,9999999));principals.push({id,token});
  await db.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@local.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
  const profile=Object.fromEntries(Object.entries({...createDefaultCabinetProfile({name,email:id+'@local.invalid'}),phone}).filter(([key])=>!['email','phoneVerified','verifiedPhone'].includes(key)));
  await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[id,JSON.stringify(profile)]);
  await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'local-booking-'+id]);
  await db.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
 }
 const [host,guest]=principals,booking={mode:'stay',priceWeekday:100,priceWeekend:100,minNights:1,includedGuests:2,maxGuests:4,checkInTime:'14:00'};
 listingId=(await db.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,booking,status,is_paid,published_at,expires_at) select $1,'rent',c.id,city.id,'Локальная проверка отмены','Синтетическое размещение только для проверки бронирования.','+79990000000',$2::jsonb,'published',true,clock_timestamp(),clock_timestamp()+interval '1 day' from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id",[host.id,JSON.stringify(booking)])).rows[0].id;
 const dates=(await db.query("select to_char((clock_timestamp() at time zone 'Europe/Moscow')::date+2,'YYYY-MM-DD') as start,to_char((clock_timestamp() at time zone 'Europe/Moscow')::date+3,'YYYY-MM-DD') as finish")).rows[0];
 const input={listingId,creationKey:randomUUID(),expectedListingRevision:'1',mode:'stay',startDate:dates.start,endDate:dates.finish,guests:2};
 const created=await send(guest,{action:'create',expectedOwnerId:guest.id,input});assert.equal(created.status,200);bookings.push(created.body.id);assert.ok(created.body.lifecycle.canCancel);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:1000}});
 await context.addCookies([{name:'__Host-blizhniy_session',value:guest.token,url:state.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===state.origin?route.continue():route.abort());
 await page.goto(state.origin+'/cabinet/bronirovaniya');const panel=page.getByRole('region',{name:'Бронирования',exact:true});
 await page.getByText('Проверка гостя',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Подробнее',exact:true}).click();await panel.getByRole('button',{name:'Отменить бронирование',exact:true}).click();
 await panel.getByLabel('Причина отмены',{exact:true}).fill('Проверка настоящего локального запроса.');
 await panel.getByRole('button',{name:'Подтвердить отмену',exact:true}).click();await panel.getByText('Бронирование отменено. Вторая сторона получила уведомление.',{exact:true}).waitFor();
 const read=await send(host,{action:'read',expectedOwnerId:host.id,bookingId:created.body.id});assert.equal(read.status,200);assert.equal(read.body.status,'cancelled');assert.equal(read.body.lifecycle.cancelledBy,'guest');
 assert.equal((await db.query("select count(*)::int as n from app.notifications where user_id=$1 and booking_request_id=$2 and event_key like 'booking_cancelled:%'",[host.id,created.body.id])).rows[0].n,1);
 const next=await send(guest,{action:'create',expectedOwnerId:guest.id,input:{...input,creationKey:randomUUID()}});assert.equal(next.status,200);bookings.push(next.body.id);
 const accepted=await send(host,{action:'decide',expectedOwnerId:host.id,bookingId:next.body.id,expectedRevision:'1',state:'accepted'});assert.equal(accepted.status,200);
 const cancelled=await send(host,{action:'cancel',expectedOwnerId:host.id,bookingId:next.body.id,expectedRevision:'2',reason:'Локальная проверка отмены хозяином.'});assert.equal(cancelled.status,200);assert.equal(cancelled.body.lifecycle.cancelledBy,'host');
 assert.deepEqual(errors,[]);const screenshots=await mkdtemp(join(tmpdir(),'blizhniy-booking-http-review-'));await page.screenshot({path:join(screenshots,'cancelled.png'),fullPage:true});
 console.log(JSON.stringify({passed:true,compiledHttp:true,actualPostgres:true,browserCancellation:true,hostAcceptedCancellation:true,notificationsVerified:true,providerCalls:false,productionTouched:false,screenshot:join(screenshots,'cancelled.png')}));
 await context.close();
}finally{
 await browser?.close();
 for(const id of bookings)await db.query('delete from app.booking_requests where id=$1 and guest_id=$2',[id,principals[1].id]);
 if(listingId)await db.query('delete from app.listings where id=$1 and author_id=$2',[listingId,principals[0].id]);
 for(const user of principals)await db.query('delete from app.users where id=$1 and email=$2',[user.id,user.id+'@local.invalid']);
 await db.end();
}
