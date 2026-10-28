import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWorkCabinetPage} from '../src/lib/work-cabinet-contract.ts';
const id='11111111-1111-4111-8111-111111111111';
const stamp='2026-10-21T12:00:00.123456Z';
const item={id,kind:'vacancy',revision:'9007199254740993',status:'published',paid:true,title:'Сантехник',updatedAt:stamp,
 amount:'65000.00',organization:'Мастер',city:'Сочи',district:'Центральный',profession:'Сантехник',schedule:'Полный день',workFormat:'На месте',coverPhotoId:null};
test('cabinet cards preserve exact money, bigint revision and microsecond pagination without private contacts',()=>{
 const items=Array.from({length:20},(_,index)=>({...item,id:id.slice(0,-2)+String(index).padStart(2,'0')}));
 const value={items,nextCursor:{id:items.at(-1).id,updatedAt:stamp}};
 assert.deepEqual(parseWorkCabinetPage(value,'vacancy'),value);
 for(const field of ['email','contactPhone','inn','authorId','form'])assert.throws(()=>parseWorkCabinetPage({items:[{...item,[field]:'secret'}],nextCursor:null},'vacancy'));
});
test('cabinet cards reject malformed kinds, timestamps, authority, URLs and unbounded pages',()=>{
 for(const change of [{id:'bad'},{kind:'workRequest'},{revision:4},{status:'arbitrary'},{paid:'true'},
  {updatedAt:stamp.slice(0,-4)+'Z'},{amount:'-1.00'},{amount:'1e3'},{organization:'x'.repeat(201)},
  {city:'bad\ncity'},{coverPhotoId:'https://external.invalid/photo'}]){
  assert.throws(()=>parseWorkCabinetPage({items:[{...item,...change}],nextCursor:null},'vacancy'));
 }
 assert.throws(()=>parseWorkCabinetPage({items:[item,item],nextCursor:null},'vacancy'));
 assert.throws(()=>parseWorkCabinetPage({items:Array.from({length:21},(_,index)=>({...item,id:id.slice(0,-2)+index.toString().padStart(2,'0')})),nextCursor:null},'vacancy'));
 assert.throws(()=>parseWorkCabinetPage({items:[],nextCursor:null,role:'admin'},'vacancy'));
});
test('cabinet next cursor belongs to the last item of an exactly full page, including its untruncated timestamp',()=>{
 const items=Array.from({length:20},(_,index)=>({...item,id:id.slice(0,-2)+String(index).padStart(2,'0')}));
 const cursor={id:items.at(-1).id,updatedAt:stamp};
 assert.deepEqual(parseWorkCabinetPage({items,nextCursor:cursor},'vacancy').nextCursor,cursor);
 for(const [rows,nextCursor] of [[[],cursor],[[item],cursor],[items,{...cursor,id:items[0].id}],[items,{...cursor,updatedAt:'2026-10-21T12:00:00.123457Z'}]]){
  assert.throws(()=>parseWorkCabinetPage({items:rows,nextCursor},'vacancy'));
 }
});
