// Real Chromium against the owned loopback fixture; random synthetic records only.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {chromium} from 'playwright';
import {stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const db=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await db.connect();
const suffix=randomBytes(8).toString('hex'),email=`search-ui-${suffix}@local.invalid`,needle=`Поиск браузера ${suffix}`;
let user,category,context,browser;
try{
 const cities=(await db.query("select id,name from app.cities where name=any($1::text[])",[['Краснодар','Армавир']])).rows;
 const city=name=>{const row=cities.find(item=>item.name===name);assert.ok(row,'owned fixture city');return row.id;};
 user=(await db.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',[
  email,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128)])).rows[0].id;
 const phone='+7999'+String(randomBytes(4).readUInt32BE()%10000000).padStart(7,'0');
 await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user,JSON.stringify({name:'Синтетический Автор',phone})]);
 // Operator attestation for this random fixture only; publication phone guards remain enabled.
 await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[user,phone,'synthetic-search-'+suffix]);
 category=(await db.query("insert into app.categories(slug,name,sort_order) values($1,'Синтетический раздел браузера',9999) returning id",['search-ui-'+suffix])).rows[0].id;
 const ids=[];
 for(let index=0;index<56;index++){
  const id=(await db.query(`insert into app.listings(author_id,listing_type,title,description,price,category_id,city_id,contact_phone,status,is_paid,created_at,published_at,expires_at)
   values($1,'sell',$2,'Синтетическое публичное описание для проверки поиска.',1500,$3,$4,'+79990000000','published',true,
    statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day') returning id`,
   [user,needle+' '+index,category,city(index<50?'Краснодар':'Армавир')])).rows[0].id;
  await db.query("insert into app.listing_moderation(listing_id,revision,state,submitted_at,decided_at) values($1,1,'approved',clock_timestamp(),clock_timestamp())",[id]);ids.push(id);
 }
 // One mapper-rejected title sorts before every valid result. It must not corrupt cursor boundaries.
 await db.query("insert into app.listings(author_id,listing_type,title,description,category_id,city_id,contact_phone,status,is_paid,created_at,published_at,expires_at) values($1,'sell','я',$2,$3,$4,'+79990000000','published',true,statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 hour',statement_timestamp()+interval '1 day')",[user,needle,category,city('Краснодар')]);
 await db.query("insert into app.listings(author_id,listing_type,title,description,category_id,city_id,contact_phone) values($1,'sell',$2,'Скрытый черновик не должен появиться в поиске.',$3,$4,'+79990000000')",[user,needle+' скрытый черновик',category,city('Краснодар')]);
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
 const errors=[],external=[],failed=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){external.push(url.host);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.name));
 page.on('response',response=>{if(response.status()>=500)failed.push(new URL(response.url()).pathname);});
 const results=()=>page.locator('main a.group.grid');
 const addresses=()=>results().evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
 const goto=async query=>{const response=await page.goto(state.origin+'/poisk?'+new URLSearchParams(query));assert.equal(response.status(),200);};
 await goto({q:needle,city:'krasnodar'});assert.equal(await results().count(),24);const first=await addresses();
 await page.screenshot({path:'/tmp/blizhniy-f12-search-desktop.png'});
 assert.equal(await page.getByText(needle+' скрытый черновик',{exact:true}).count(),0);
 const next=page.getByRole('link',{name:'Далее',exact:true});assert.ok(new URL(await next.getAttribute('href'),state.origin).searchParams.get('cursor'));
 await next.click();await page.getByText('Страница 2',{exact:true}).waitFor();const second=await addresses();assert.equal(second.length,24);
 await page.getByRole('link',{name:'Далее',exact:true}).click();await page.getByText('Страница 3',{exact:true}).waitFor();const third=await addresses();assert.equal(third.length,2);
 assert.equal(new Set([...first,...second,...third]).size,50);assert.ok([...first,...second,...third].every(href=>ids.some(id=>href==='/obyavlenie/'+id)));
 assert.equal(await page.getByRole('link',{name:'Далее',exact:true}).count(),0);
 await page.getByRole('link',{name:'Назад',exact:true}).click();await page.getByText('Страница 2',{exact:true}).waitFor();assert.deepEqual(await addresses(),second);
 await page.getByRole('link',{name:'Назад',exact:true}).click();await page.getByText('Страница 1',{exact:true}).waitFor();assert.deepEqual(await addresses(),first);
 for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false,`search fits ${width}px`);if(width===320)await page.screenshot({path:'/tmp/blizhniy-f12-search-mobile.png'});}
 await goto({q:needle,city:'armavir'});assert.equal(await results().count(),6);
 await goto({q:needle+' %_!\\'});await page.getByRole('heading',{name:'Ничего не найдено',exact:true}).waitFor();assert.equal(await results().count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
 console.log('Local search Chromium passed: 24/24/2 cursor pages, reverse navigation, invalid DTO refill, hidden draft, exact city, literal wildcards, 320/768/1440 layout; no page errors, external calls or 5xx.');
}finally{
 await context?.close();await browser?.close();
 if(user)await db.query('delete from app.users where id=$1 and email=$2',[user,email]);
 if(category)await db.query('delete from app.categories where id=$1 and slug=$2',[category,'search-ui-'+suffix]);
 await db.end();
}
