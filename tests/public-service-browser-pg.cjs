// Strict owned SQL fixture for real production page rendering, never a database connection.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),pg=require('pg'),Base=pg.Pool;
pg.Pool=class extends Base{
 async query(statement){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?[]:statement.values;
  if(sql.startsWith('select s.id,s.kind,s.form,s.status,s.is_paid as paid,')){
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("s.status='published' and s.is_paid"));assert.ok(sql.includes('s.expires_at>statement_timestamp()'));
   const rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_SERVICE_FIXTURE,'utf8'));assert.ok(Array.isArray(rows));
   const selected=rows.filter(row=>row.kind===values[0]&&(!values[1]||typeof values[1]!=='string'||row.id===values[1]));
   return{rows:selected.slice(typeof values[2]==='number'?values[2]:0,typeof values[1]==='number'?values[1]:undefined)};
  }
  return super.query(statement);
 }
};
