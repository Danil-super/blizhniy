import assert from 'node:assert/strict';import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
import * as contract from '../src/lib/listing-cabinet-contract.ts';
const {PostgresListingCabinetStore}=formModule('postgres-listing-cabinet',{'./listing-cabinet-contract.ts':contract});
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',token='a'.repeat(64);
function fixture(){const queries=[];return{queries,store:new PostgresListingCabinetStore({transaction:async work=>work({query:async(sql,values)=>{
 queries.push({sql,values});
 if(sql.startsWith('select u.id'))return{rowCount:1,rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'1'}]};
 if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rowCount:1,rows:[]};
 if(sql.startsWith('select l.id'))return{rowCount:1,rows:[{id:other,revision:'1',kind:'prodam',title:'Комод',price:'3500.00',city:'Сочи',district:null,coverPhotoId:null,status:'blocked',blockReason:'Нарушение правил',updatedAt:'2026-10-20T00:00:00.000001Z'}]};
 throw Error('Unexpected cabinet SQL');
}})},true)};}
test('cabinet enforces exact session owner before reading any publication',async()=>{
 const f=fixture();await assert.rejects(f.store.list(token,other,null));assert.equal(f.queries.some(q=>q.sql.startsWith('select l.id')),false);
});
test('cabinet lists all owned states with block priority and microsecond pagination',async()=>{
 const f=fixture(),page=await f.store.list(token,owner,null);
 assert.equal(page.items[0].card.status,'blocked');assert.equal(page.items[0].card.blockReason,'Нарушение правил');assert.equal(page.workflow,'postmoderation');
 const query=f.queries.find(q=>q.sql.startsWith('select l.id'));assert.deepEqual(query.values,[owner]);assert.match(query.sql,/where l.author_id=\$1/);assert.match(query.sql,/left join app.listing_blocks/);assert.match(query.sql,/limit 21/);assert.doesNotMatch(query.sql,/where l.author_id=\$1 and l.status='draft'/);
});
