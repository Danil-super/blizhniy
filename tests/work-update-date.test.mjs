import test from 'node:test';
import assert from 'node:assert/strict';
import {mapPublicWorkPublication} from '../src/lib/public-work-publications.ts';
const row={id:'11111111-1111-4111-8111-111111111111',kind:'workRequest',status:'published',paid:true,createdAt:'2026-10-20T10:00:00Z',publishedAt:'2026-10-21T10:00:00Z',expiresAt:'2026-11-21T10:00:00Z',updatedAt:'2026-10-23T11:20:30Z',contentEdited:true,mediaIds:[],form:{kind:'workRequest',title:'Ремонт ванной',description:'Подробное описание заказа.',cityName:'Крымск',professionName:'Сантехник',contactPhone:'+79991234567',placementRightConfirmed:true,budget:'3500.00'}};
test('public order exposes the actual saved update timestamp separately from its original publication',()=>{
 const result=mapPublicWorkPublication(row,Date.parse('2026-10-23T12:00:00Z'));
 assert.equal(result.publishedAt,row.publishedAt);assert.equal(result.updatedAt,row.updatedAt);
});
test('initial capture metadata is not advertised as an author edit',()=>{
 const result=mapPublicWorkPublication({...row,contentEdited:false},Date.parse('2026-10-23T12:00:00Z'));
 assert.equal(result.updatedAt,undefined);
});
