// Owned SQL transport only; never opens a real database connection.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),pg=require('pg'),Base=pg.Pool;
pg.Pool=class extends Base{
 async query(statement){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?[]:statement.values;
  if(sql.startsWith('select l.id,l.author_id as "ownerId"')){
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("l.status='published' and l.is_paid"));assert.ok(sql.includes('l.expires_at>clock_timestamp()'));assert.ok(sql.includes('m.owner_id<>l.author_id'));
   let rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_LISTING_FIXTURE,'utf8'));assert.ok(Array.isArray(rows));
   if(sql.includes('where l.id=$1'))rows=rows.filter(row=>row.id===values[0]);
   else{
    const kinds={sell:'prodam',buy:'kuplyu',free:'otdam-darom',rent:'arenda'};
    rows=rows.filter(row=>(!values[0]||row.form.kind===kinds[values[0]])&&(!values[2]||row.ownerId===values[2])&&(!values[3]||row.form.categorySlug===values[3])&&(!values[4]||row.form.subcategoryName===values[4])).slice(values[6],values[6]+values[5]);
   }
   if(sql.includes('order by p.position limit 1'))rows=rows.map(row=>({...row,mediaIds:row.mediaIds.slice(0,1)}));
   return{rows};
  }
  return super.query(statement);
 }
};
