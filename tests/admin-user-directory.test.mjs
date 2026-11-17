import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAdminUserQuery,parseAdminUserPage} from '../src/lib/admin-user-directory-contract.ts';

const id='11111111-1111-4111-8111-111111111111',stamp='2026-11-17T10:20:30.123456Z';
const query={expectedAdminId:id,query:' Имя ',role:'all',status:'all',cursor:null};
const item={id,name:'Имя',email:'user@example.invalid',phone:'',role:'user',isBlocked:false,emailVerified:true,createdAt:stamp};
test('directory query is exact, bounded and retains literal search and microsecond cursor',()=>{
  assert.deepEqual(parseAdminUserQuery(query),{...query,query:'Имя'});
  const cursor={id,updatedAt:stamp};
  assert.deepEqual(parseAdminUserQuery({...query,query:'100%_\\',cursor}).cursor,cursor);
  for(const patch of [{expectedAdminId:'bad'},{role:'specialist'},{status:'deleted'},{query:'a'.repeat(121)},
    {query:'bad\nquery'},{cursor:{id,updatedAt:'2026-11-31T10:20:30.123456Z'}},{password_hash:'private'}])
    assert.throws(()=>parseAdminUserQuery({...query,...patch}));
});
test('directory response rejects private/unknown fields, invalid state, duplicates and oversized pages',()=>{
  const page={items:[item],nextCursor:null};
  assert.deepEqual(parseAdminUserPage(page),page);
  for(const candidate of [{...page,password_hash:'private'}, {...page,items:[{...item,token_hash:'private'}]},
    {...page,items:[{...item,role:'organization'}]}, {...page,items:[{...item,isBlocked:'false'}]},
    {...page,items:[item,item]}, {...page,items:Array(26).fill(item)},
    {...page,nextCursor:{id,updatedAt:stamp}}, {...page,items:[{...item,createdAt:'invalid'}]}])
    assert.throws(()=>parseAdminUserPage(candidate));
});
