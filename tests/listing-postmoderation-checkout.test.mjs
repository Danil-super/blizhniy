import assert from 'node:assert/strict';import {test} from 'node:test';import * as crypto from 'node:crypto';
import {formModule} from './listing-form-module.mjs';import * as intents from '../src/lib/postgres-payment-intents.ts';import * as contract from '../src/lib/listing-checkout-contract.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const forms={PostgresListingFormStore:class{async inspectInTransaction(){return{check:{checksPassed:true,tariff:{id:'listing-publication',name:'Размещение',amount:'199.00',currency:'RUB',durationDays:30}}};}}};
const {PostgresListingCheckoutStore}=formModule('postgres-listing-checkout',{'node:crypto':crypto,'./postgres-listing-form':forms,'./postgres-payment-intents':intents,'./listing-checkout-contract.ts':contract});
function fixture(postmoderation,blocked=false){const calls=[];const db={transaction:async work=>work({query:async(sql)=>{
 calls.push(sql);
 if(sql.startsWith('select u.id'))return{rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'1'}],rowCount:1};
 if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rows:[],rowCount:1};
 if(sql.includes('from app.listing_moderation'))return{rows:[],rowCount:0};
 if(sql.includes('from app.listing_blocks'))return{rows:blocked?[{listing_id:id}]:[],rowCount:blocked?1:0};
 if(sql.includes('app.payment_orders'))return{rows:[],rowCount:0};
 throw Error('Unexpected checkout SQL');
}})};return{calls,store:new PostgresListingCheckoutStore(db,{shopId:'fixture-shop',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:null},{postmoderation})};}
test('local postmoderation checkout admits valid unreviewed content without fabricating approval',async()=>{
 const f=fixture(true),quote=await f.store.preview('a'.repeat(64),owner,id,'1');assert.equal(quote.tariff.amount,'199.00');assert.equal(f.calls.some(sql=>sql.includes('app.listing_moderation')),false);assert.equal(f.calls.some(sql=>sql.includes('app.listing_blocks')),true);
});
test('postmoderation never allows payment for a blocked listing',async()=>{await assert.rejects(fixture(true,true).store.preview('a'.repeat(64),owner,id,'1'));});
test('unchanged production checkout still requires actual approval',async()=>{await assert.rejects(fixture(false).store.preview('a'.repeat(64),owner,id,'1'));});
