import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {locationWithdrawalColumn,publicationWithdrawalEligibility,publicPhotoEligibility}=loadLocalPrimaryModule('publication-location-withdrawal');

test('photo withdrawal uses the publication and exact media identity in the public predicate',()=>{
 assert.equal(publicPhotoEligibility('l','p.media_id',false),'');
 assert.match(publicPhotoEligibility('l','p.media_id',true),/kind='listing'[\s\S]+publication_id=l\.id[\s\S]+scope='photo:'\|\|p\.media_id::text/);
 assert.match(publicPhotoEligibility('s','image.id',true),/kind=s\.kind[\s\S]+scope='photo:'\|\|image\.id::text/);
});

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

test('full withdrawal applies to public reads and the recovery fallback keeps every exact scope closed',()=>{
 const prior=process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS;
 try{
  process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS='required';
  assert.match(publicationWithdrawalEligibility('l',true),/kind='listing'[\s\S]+scope='publication'/);
  assert.match(publicationWithdrawalEligibility('w',true),/kind=w\.kind[\s\S]+scope='publication'/);
  assert.match(publicationWithdrawalEligibility('s',true),/kind=s\.kind[\s\S]+scope='publication'/);
  assert.match(locationWithdrawalColumn('l',true),/scope='location'/);
  process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS='suppress';
  assert.equal(publicationWithdrawalEligibility('l',false),' and false');
 }finally{
  if(prior===undefined)delete process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS;
  else process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS=prior;
 }
});

test('recovery refuses tampered, unexpected and duplicate records before connecting',async()=>{
 const {replayLocationWithdrawals}=await import('../scripts/publication-location-restore.mjs');
 const row={kind:'listing',publicationId:'10000000-0000-4000-8000-000000000001',withdrawnAt:'2026-11-28T00:00:00.123456Z',scope:'location'};
 const snapshot=rows=>JSON.stringify({version:4,scope:'blizhniy-location-withdrawals',rows});
 const hash=text=>createHash('sha256').update(text).digest('hex');
 const client={async query(){assert.fail('invalid checkpoints cannot reach the database');}};
 for(const [document,expected] of [
  [snapshot([row]),hash(snapshot([]))],
  [snapshot([{...row,address:'synthetic'}]),null],
  [snapshot([{...row,kind:'marquee'}]),null],
  [snapshot([{...row,kind:'vacancy',scope:'phone'}]),null],
  [snapshot([{...row,kind:'fair',scope:'messenger'}]),null],
  [snapshot([{...row,scope:'unknown'}]),null],
  [snapshot([]).replace('"version":4','"version":3'),null],
  [snapshot([{...row,scope:'text:organization:'+'a'.repeat(64)+':1:2'}]),null],
  [snapshot([{...row,scope:'text:title:'+'a'.repeat(64)+':2:2'}]),null],
  [snapshot([{...row,scope:'avatar'}]),null],
  [snapshot([{...row,scope:'photo:10000000-0000-8000-8000-000000000001'}]),null],
  [snapshot([{...row,withdrawnAt:'2026-02-30T00:00:00.123456Z'}]),null],
  [snapshot([row,row]),null],
 ]){
  await assert.rejects(replayLocationWithdrawals(client,document,expected??hash(document)),/Invalid withdrawal checkpoint/);
 }
});
