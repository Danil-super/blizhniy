import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {locationWithdrawalColumn}=loadLocalPrimaryModule('publication-location-withdrawal');

test('recovery mode hides exact locations with or without the privacy schema',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS;
 process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS='suppress';
 try{
  for(const alias of ['l','w','s'])for(const installed of [false,true])
   assert.equal(locationWithdrawalColumn(alias,installed),',true as "locationWithdrawn"');
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS;
  else process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS=prior;
 }
});

test('recovery refuses tampered, unexpected and duplicate records before connecting',async()=>{
 const {replayLocationWithdrawals}=await import('../scripts/publication-location-restore.mjs');
 const row={kind:'listing',publicationId:'10000000-0000-4000-8000-000000000001',withdrawnAt:'2026-11-28T00:00:00.123456Z'};
 const snapshot=rows=>JSON.stringify({version:1,scope:'blizhniy-location-withdrawals',rows});
 const hash=text=>createHash('sha256').update(text).digest('hex');
 const client={async query(){assert.fail('invalid checkpoints cannot reach the database');}};
 for(const [document,expected] of [
  [snapshot([row]),hash(snapshot([]))],
  [snapshot([{...row,address:'synthetic'}]),null],
  [snapshot([{...row,kind:'marquee'}]),null],
  [snapshot([{...row,withdrawnAt:'2026-02-30T00:00:00.123456Z'}]),null],
  [snapshot([row,row]),null],
 ]){
  await assert.rejects(replayLocationWithdrawals(client,document,expected??hash(document)),/Invalid withdrawal checkpoint/);
 }
});
