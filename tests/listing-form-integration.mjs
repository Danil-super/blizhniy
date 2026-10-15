import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {formModule} from './listing-form-module.mjs';
import {PostgresListingDraftStore,ListingDraftAccessError,ListingDraftConflictError} from './listing-draft-module.mjs';
import {ListingDraftInputError} from '../src/lib/listing-draft-contract.ts';
export async function testListingForm(suite,operator,db,{owner,other,token,otherToken,a,foreign,pending}){
 const {PostgresListingFormStore}=formModule('postgres-listing-form'),store=new PostgresListingFormStore(db);
 const draft=await new PostgresListingDraftStore(db).createEmpty(token,owner.id,randomUUID());let saved;
 const form={kind:'prodam',title:'Форма целиком',description:'Описание\n',price:'1234.50',categorySlug:'dlya-doma-i-dachi',subcategoryName:'Мебель для дома и дачи',cityName:'Краснодар',
  district:'Центр',address:'Улица 1',latitude:45,longitude:39,showExactAddress:true,contactPhone:'+79990000000',messengerUrl:'https://t.me/example_user',booking:null,photoIds:[a]};
 await suite.test('full listing form requires explicit extra column grants, never billing or owner privileges',async()=>{
  await assert.rejects(store.read(token,owner.id,draft.id),{code:'42501'});
  await operator.query(`grant select(district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking),
   update(district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking) on app.listings to blizhniy_runtime`);
  for(const sql of ["update app.listings set status='published' where false",'update app.listings set author_id=author_id where false','delete from app.listings where false'])await assert.rejects(db.query(sql),{code:'42501'});
 });
 await suite.test('full form atomically saves references, exact money, private location/contact and ordered photos, then reads durably',async()=>{
  saved=await store.update(token,owner.id,draft.id,'1',form);assert.equal(saved.revision,'2');assert.deepEqual(saved.form,form);assert.equal(saved.photos[0].id,a);
  assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
  const core=await new PostgresListingDraftStore(db).read(token,owner.id,draft.id);assert.ok(core.draft.cityId);assert.ok(core.draft.categoryId);assert.equal(core.draft.price,'1234.50');
  assert.deepEqual(Object.keys(saved).sort(),['form','id','photos','revision']);
 });
 await suite.test('foreign account, stale owner, non-draft, foreign/pending media and invalid references cannot change full draft',async()=>{
  await assert.rejects(store.read(otherToken,other.id,draft.id),ListingDraftAccessError);
  await assert.rejects(store.read(otherToken,owner.id,draft.id),ListingDraftAccessError);
  await assert.rejects(store.update(otherToken,owner.id,draft.id,'2',form),ListingDraftAccessError);
  await assert.rejects(store.update(token,other.id,draft.id,'2',form),ListingDraftAccessError);
  for(const photo of [foreign,pending,randomUUID()])await assert.rejects(store.update(token,owner.id,draft.id,'2',{...form,photoIds:[photo]}),ListingDraftAccessError);
  for(const input of [{categorySlug:'missing'},{cityName:'missing'},{subcategoryName:'missing'}])await assert.rejects(store.update(token,owner.id,draft.id,'2',{...form,...input}),ListingDraftInputError);
  assert.deepEqual(await store.read(token,owner.id,draft.id),saved);
  await operator.query("update app.listings set status='archived' where id=$1",[draft.id]);
  try{await assert.rejects(store.read(token,owner.id,draft.id),ListingDraftAccessError);}finally{await operator.query("update app.listings set status='draft' where id=$1",[draft.id]);}
 });
 await suite.test('full form/core share one CAS; unknown committed full write is read back without a second mutation',async()=>{
  const outcomes=await Promise.allSettled([store.update(token,owner.id,draft.id,'2',{...form,title:'Первый'}),store.update(token,owner.id,draft.id,'2',{...form,title:'Второй'})]);
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);assert.ok(outcomes.some(item=>item.status==='rejected'&&item.reason instanceof ListingDraftConflictError));
  await assert.rejects(new PostgresListingDraftStore(db).update(token,owner.id,draft.id,'2',{kind:'prodam'}),ListingDraftConflictError);
  const current=await store.read(token,owner.id,draft.id);let attempts=0;
  const uncertain=new PostgresListingFormStore({transaction:async work=>{attempts++;await db.transaction(work);throw new Error('Synthetic lost acknowledgement');}});
  await assert.rejects(uncertain.update(token,owner.id,draft.id,current.revision,form),/Synthetic lost/);assert.equal(attempts,1);
  assert.equal((await store.read(token,owner.id,draft.id)).revision,'4');assert.deepEqual((await store.read(token,owner.id,draft.id)).form,form);
 });
}
