import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
const {PostgresListingFormStore}=formModule('postgres-listing-form');
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const form={kind:'prodam',title:'Комод',description:'Сохранённое описание объявления.',price:'3500.00',categorySlug:'otdyh',subcategoryName:null,cityName:'Краснодар',district:null,address:null,latitude:null,longitude:null,showExactAddress:false,contactPhone:'+79990000000',messengerUrl:null,booking:null,photoIds:[]};
function fixture(postmoderation){
 const calls=[],db={transaction:async work=>work({query:async sql=>{
  calls.push(sql);
  if(sql.startsWith('select u.id'))return{rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'1'}],rowCount:1};
  if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rows:[],rowCount:1};
  if(sql.includes('from app.listing_photos'))return{rows:[],rowCount:0};
  if(sql.includes('from app.listings'))return sql.includes("l.status='draft'")?{rows:[],rowCount:0}:{rows:[{...form,id,revision:'1',listingType:'sell'}],rowCount:1};
  throw Error('Unexpected published edit SQL');
 }})};return{calls,store:new PostgresListingFormStore(db,{postmoderation})};
}
test('paid listing opens the same full editor only in explicit postmoderation mode',async()=>{
 assert.equal((await fixture(true).store.read('a'.repeat(64),owner,id)).form.title,'Комод');
 await assert.rejects(fixture(false).store.read('a'.repeat(64),owner,id));
});
