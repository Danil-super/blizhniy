import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {normalizeProfilePhone} from '../src/lib/phone-verification-contract.ts';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {parseProductionProfile,ProfileInputError}=load('postgres-profile');

test('profile +7 phones have exactly ten national digits, including direct API profile parsing',()=>{
 for(const value of ['+7123456','+7999123456','+799912345678','7123456']){
  assert.equal(normalizeProfilePhone(value),null);
  assert.throws(()=>parseProductionProfile({name:'Данил',phone:value}),ProfileInputError);
 }
 for(const value of ['+79991234567','+7-(999)-123-45-67','8 (999) 123-45-67','9991234567']){
  assert.equal(normalizeProfilePhone(value),'+79991234567');
  assert.equal(parseProductionProfile({name:'Данил',phone:value}).phone,value);
 }
 assert.equal(parseProductionProfile({name:'Данил',phone:''}).phone,'');
});
