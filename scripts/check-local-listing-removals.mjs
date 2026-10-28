// Fresh synthetic scratch database inside the validated owned loopback container.
// This never applies a migration or grants to the local stand database.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {bootstrapPostgres} from './bootstrap-postgres.mjs';
import {stateFile,localPrimaryDatabaseConfig,docker,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const scratch='blizhniy_removals_'+randomBytes(8).toString('hex');
assert.match(scratch,/^blizhniy_removals_[a-f0-9]{16}$/);
const control=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await control.connect();
let owner,db,created=false,checks=0;
const check=async(name,work)=>{await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));};
try{
 await control.query(`create database "${scratch}"`);created=true;
 owner=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),database:scratch});await owner.connect();
 await bootstrapPostgres(owner,'127.0.0.1:'+scratch,{includeListingContactMethod:true});
 for(const {source} of await getLocalPrimaryExtraMigrations())await owner.query(source);
 const down=await readFile(new URL('../database/migrations/0029-listing-owner-removals.down.sql',import.meta.url),'utf8');
 await check('empty migration rollback works without changing earlier tables',async()=>{
  await owner.query(down);assert.equal((await owner.query("select to_regclass('app.listing_owner_removals') as relation")).rows[0].relation,null);
  await owner.query((await getLocalPrimaryExtraMigrations()).at(-1).source);
 });
 await owner.query(`grant usage on schema app to blizhniy_runtime;
  grant select on app.users,app.sessions,app.listings,app.listing_blocks,app.listing_block_mail,app.listing_owner_removals,
   app.listing_photos,app.media_objects,app.categories,app.cities,app.payment_orders to blizhniy_runtime;
  grant update(last_seen_at) on app.sessions to blizhniy_runtime;
  grant update(auth_version) on app.users to blizhniy_runtime;
  grant update(listing_type,title,description,price,category_id,city_id,district,address,latitude,longitude,show_exact_address,
   contact_phone,messenger_url,booking,contact_method,revision,updated_at) on app.listings to blizhniy_runtime;
  grant insert(listing_id,media_id,position),delete on app.listing_photos to blizhniy_runtime;
  grant insert(listing_id,owner_id,removed_revision) on app.listing_owner_removals to blizhniy_runtime`);
 db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state),database:scratch,max:3}));
 const users=[],tokens=[];
 for(const role of ['admin','user']){
  const user=(await owner.query('insert into app.users(email,password_hash,role,email_verified_at) values($1,$2,$3,clock_timestamp()) returning id',
   [`removal-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,role])).rows[0].id;users.push(user);
  const token=randomBytes(32).toString('hex');tokens.push(token);await owner.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')",[load('identity').hashSessionToken(token),user]);
 }
 const makeListing=async(blocked=true)=>{
  const id=(await owner.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,status,is_paid,published_at,expires_at)
   select $1,'sell',c.id,city.id,'Синтетическое объявление','Подробное описание для проверки удаления.','+79990000000','published',true,clock_timestamp(),clock_timestamp()+interval '1 day'
   from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id`,[users[0]])).rows[0].id;
  if(blocked)await owner.query("insert into app.listing_blocks(listing_id,blocked_by,blocked_revision,reason) values($1,$2,1,'Причина сохраняется')",[id,users[0]]);
  return id;
 };
 const id=await makeListing(),unblocked=await makeListing(false);
 const store=new(load('postgres-listing-owner-removals').PostgresListingOwnerRemovalStore)(db);
 const forms=new(load('postgres-listing-form').PostgresListingFormStore)(db,{postmoderation:true,ownerRemovals:true});
 const cabinet=new(load('postgres-listing-cabinet').PostgresListingCabinetStore)(db,true);
 const admin=new(load('postgres-listing-management').PostgresListingManagementStore)(db);
 const before=(await owner.query('select * from app.listings where id=$1',[id])).rows[0];
 const block=(await owner.query('select * from app.listing_blocks where listing_id=$1',[id])).rows[0];
 await check('valid owner can edit blocked listing while preserving payment and immutable reason',async()=>{
  const original=await forms.read(tokens[0],users[0],id);
  await forms.update(tokens[0],users[0],id,'1',{...original.form,title:'Исправлено перед удалением'});
  assert.equal((await forms.read(tokens[0],users[0],id)).revision,'2');
  const changed=(await owner.query('select * from app.listings where id=$1',[id])).rows[0];
  for(const field of ['status','is_paid','published_at','expires_at','author_id'])assert.deepEqual(changed[field],before[field]);
  assert.deepEqual((await owner.query('select * from app.listing_blocks where listing_id=$1',[id])).rows[0],block);
 });
 await check('foreign users, incorrect expected owner, nonblocked items and stale revisions cannot be removed',async()=>{
  for(const [token,user,key,revision,name] of [[tokens[1],users[1],id,'2','ListingDraftAccessError'],[tokens[0],users[1],id,'2','ListingDraftAccessError'],[tokens[0],users[0],unblocked,'1','ListingDraftAccessError'],[tokens[0],users[0],id,'1','ListingDraftConflictError']])
   await assert.rejects(store.remove(token,user,key,revision),{name});
  assert.equal((await owner.query('select count(*)::int as n from app.listing_owner_removals')).rows[0].n,0);
 });
 await check('concurrent duplicate removal is idempotent, hides cabinet item, preserves administrator audit and denies old editor link',async()=>{
  const results=await Promise.all([store.remove(tokens[0],users[0],id,'2'),store.remove(tokens[0],users[0],id,'2')]);
  assert.deepEqual(results,[{id,revision:'2',removed:true},{id,revision:'2',removed:true}]);
  assert.equal((await owner.query('select count(*)::int as n from app.listing_owner_removals')).rows[0].n,1);
  assert.equal((await cabinet.list(tokens[0],users[0],null)).items.some(item=>item.id===id),false);
  assert.ok((await admin.list(tokens[0],users[0],null)).items.some(item=>item.id===id));
  const detail=await admin.inspect(tokens[0],users[0],id);assert.equal(detail.listing.blockReason,block.reason);assert.equal(detail.snapshot.form.title,'Исправлено перед удалением');
  await assert.rejects(forms.read(tokens[0],users[0],id),{name:'ListingDraftAccessError'});
  await assert.rejects(forms.update(tokens[0],users[0],id,'2',detail.snapshot.form),{name:'ListingDraftAccessError'});
  assert.deepEqual(await store.read(tokens[0],users[0],id,'2'),{id,revision:'2',removed:true});
 });
 await check('runtime cannot alter or delete tombstones, override timestamp, mint a foreign marker or delete the listing',async()=>{
  for(const [sql,values] of [
   ['update app.listing_owner_removals set removed_revision=3 where listing_id=$1',[id]],['delete from app.listing_owner_removals where listing_id=$1',[id]],
   ['insert into app.listing_owner_removals(listing_id,owner_id,removed_revision,removed_at) values($1,$2,1,clock_timestamp())',[unblocked,users[0]]],
   ['insert into app.listing_owner_removals(listing_id,owner_id,removed_revision) values($1,$2,1)',[unblocked,users[0]]],
   ['insert into app.listing_owner_removals(listing_id,owner_id,removed_revision) values($1,$2,2)',[id,users[1]]],
   ['delete from app.listings where id=$1',[id]],
  ])await assert.rejects(db.query(sql,values),{code:'42501'});
  assert.deepEqual((await owner.query('select * from app.listing_blocks where listing_id=$1',[id])).rows[0],block);
  const now=(await owner.query('select * from app.listings where id=$1',[id])).rows[0];
  for(const field of ['status','is_paid','published_at','expires_at','author_id'])assert.deepEqual(now[field],before[field]);
 });
 await check('lost commit reply is resolved by readback; populated down migration refuses to discard decisions',async()=>{
  const fresh=await makeListing();let attempts=0;
  const uncertain=new(load('postgres-listing-owner-removals').PostgresListingOwnerRemovalStore)({transaction:async work=>{attempts++;await db.transaction(work);throw Error('Synthetic lost commit reply');}});
  await assert.rejects(uncertain.remove(tokens[0],users[0],fresh,'1'),/Synthetic lost/);assert.equal(attempts,1);
  assert.deepEqual(await store.read(tokens[0],users[0],fresh,'1'),{id:fresh,revision:'1',removed:true});
  await assert.rejects(owner.query(down),{code:'23514'});await owner.query('rollback');
  assert.equal((await owner.query('select count(*)::int as n from app.listing_owner_removals')).rows[0].n,2);
 });
 console.log(JSON.stringify({status:'passed',checks,scope:'scratch-only',standChanged:false,productionTouched:false}));
}finally{
 await db?.close();await owner?.end();
 if(created){assert.match(scratch,/^blizhniy_removals_[a-f0-9]{16}$/);await control.query(`drop database "${scratch}"`);}
 await control.end();
}
