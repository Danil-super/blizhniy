// SQL transport for the owned public-page browser fixture; no remote database.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),pg=require('pg'),Base=pg.Pool;
pg.Pool=class extends Base{
 async query(statement){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?[]:statement.values;
  if(sql.startsWith('select w.id,w.kind,')&&sql.includes('from app.work_publications w')){
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("w.status='published' and w.is_paid"));assert.ok(sql.includes('w.expires_at>statement_timestamp()'));
   assert.ok(sql.includes('w.deleted_at is null'));
   const rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_WORK_FIXTURE,'utf8'));
   assert.ok(Array.isArray(rows));
   const [kindOrIds,limitOrId,offset=0]=values;
   if(Array.isArray(kindOrIds))return{rows:rows.filter(row=>kindOrIds.includes(row.id)).slice(0,25)};
   const eligible=rows.filter(row=>row.kind===kindOrIds);
   if(typeof limitOrId==='string')return{rows:eligible.filter(row=>row.id===limitOrId)};
   return{rows:eligible.slice(offset,offset+limitOrId)};
  }
  return super.query(statement);
 }
};
