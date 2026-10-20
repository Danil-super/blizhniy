// Synthetic SSR edit fixture only. Extend the owned catalogue stub; never open a real SQL connection.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync,realpathSync,statSync}=require('node:fs');
const {join}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto'),pg=require('pg');
const fixture=process.env.BLIZHNIY_BROWSER_DRAFT_FIXTURE;
assert.equal(typeof fixture,'string');assert.ok(fixture.startsWith(join(tmpdir(),'blizhniy-form-browser-')));
assert.equal(fixture,realpathSync(fixture));assert.equal(fixture.endsWith('/draft.json'),true);assert.equal(statSync(fixture).mode&0o777,0o600);
const tokenHash=createHash('sha256').update('a'.repeat(64)).digest('hex'),CataloguePool=pg.Pool;
function state(){
 const value=JSON.parse(readFileSync(fixture,'utf8'));
 assert.deepEqual(Object.keys(value).sort(),['active','owner','snapshot']);
 for(const id of [value.active,value.owner])assert.match(id,/^[a-f0-9-]{36}$/);
 return value;
}
pg.Pool=class extends CataloguePool{
 async connect(){return{query:this.query.bind(this),release(){}};}
 async query(statement,parameters){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?(parameters??[]):(statement.values??[]);
  const result=rows=>({rows,rowCount:rows.length});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return result([]);
  if(sql.includes('update app.sessions s set last_seen_at=now() from app.users u')){
   assert.deepEqual(values,[tokenHash,false]);const {active}=state();return result([{id:active,email:'fixture@example.invalid',role:'user',isBlocked:false}]);
  }
  if(sql.includes('from app.users u where u.id=(select user_id from app.sessions where token_hash=$1) for update of u')){
   assert.deepEqual(values,[tokenHash]);const {active}=state();return result([{id:active,role:'user',isBlocked:false,verified:true,authVersion:'0'}]);
  }
  if(sql.startsWith('select token_hash from app.sessions where')||sql.startsWith('update app.sessions set last_seen_at=least')){
   const {active}=state();assert.deepEqual(values,[tokenHash,active,'0']);return result([{token_hash:tokenHash}]);
  }
  if(sql.startsWith('select l.id,l.revision::text as revision,l.listing_type as "listingType"')){
   const {snapshot,owner}=state();if(!snapshot||values[0]!==snapshot.id||values[1]!==owner)return result([]);
   const {kind,photoIds,...fields}=snapshot.form;assert.ok(Array.isArray(photoIds));
   return result([{...fields,id:snapshot.id,revision:snapshot.revision,listingType:{prodam:'sell',kuplyu:'buy',arenda:'rent','otdam-darom':'free'}[kind]}]);
  }
  if(sql.startsWith('select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,')&&sql.includes('from app.listing_photos')){
   const {snapshot,owner}=state();if(!snapshot||values[0]!==snapshot.id||values[1]!==owner)return result([]);
   return result(snapshot.photos.map(photo=>({...photo,permitted:true})));
  }
  return super.query(statement,parameters);
 }
};
