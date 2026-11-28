// Owned SQL transport only; never opens a real database connection.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),pg=require('pg'),Base=pg.Pool;
pg.Pool=class extends Base{
 connect(callback){
  let released=false;
  const client={query:statement=>{assert.equal(released,false);return this.query(statement);},release:()=>{assert.equal(released,false);released=true;}};
  if(callback){queueMicrotask(()=>callback(null,client));return;}return Promise.resolve(client);
 }
 async query(statement){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?[]:statement.values;
  if(sql==='set local jit=off')return{rows:[]};
  if(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT'].includes(sql)||sql==="select set_config('statement_timeout',$1,true),set_config('transaction_timeout',$2,true)")return{rows:[]};
  if(sql.startsWith('with search_0 as materialized')){
   assert.ok(sql.includes('union all'));assert.ok(sql.includes('limit $4'));assert.equal(values[3],25);assert.equal(values[4],null);
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("l.status='published' and l.is_paid"));assert.ok(sql.includes('m.owner_id<>l.author_id'));
   const needle=values[0]===null?'':values[0].slice(1,-1).replace(/!([!%_])/g,'$1');
   const rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_LISTING_FIXTURE,'utf8')).filter(row=>row.status==='published'&&row.paid&&row.approvedRevision===row.revision&&Date.parse(row.expiresAt)>Date.now()&&(!values[2]||row.form.cityName===values[2])&&[row.form.title,row.form.description,row.form.cityName].some(field=>field.toLowerCase().includes(needle)));
   return{rows:rows.slice(0,25).map(row=>({id:row.id,rank:1,publishedAt:row.publishedAt,createdAt:row.createdAt,sortOrder:0,parent:'',name:'',metadata:{categoryName:'Посуда'}}))};
  }
  // The dedicated listing fixture contains no work/service publications. F11
  // projects canonical profession JSON rather than the former raw form column.
  for(const [alias,table]of[['s','service_publications'],['w','work_publications']]){
   if(sql.startsWith(`select ${alias}.id,${alias}.kind,`)&&sql.includes(`from app.${table} ${alias}`)&&sql.includes(`${alias}.profession_id as "professionId"`)){
    assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes(`${alias}.status='published' and ${alias}.is_paid`));assert.ok(sql.includes(`${alias}.expires_at>statement_timestamp()`));return{rows:[]};
   }
  }
  if(sql.startsWith('select l.id,l.author_id as "ownerId"')){
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("l.status='published' and l.is_paid"));assert.ok(sql.includes('l.expires_at>clock_timestamp()'));assert.ok(sql.includes('m.owner_id<>l.author_id'));
   let rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_LISTING_FIXTURE,'utf8'));assert.ok(Array.isArray(rows));
   if(sql.includes('where l.id=$1'))rows=rows.filter(row=>row.id===values[0]);
   else if(sql.includes('where l.id=any($1::uuid[])')){assert.ok(Array.isArray(values[0]));assert.ok(values[0].length<=25);rows=rows.filter(row=>values[0].includes(row.id));}
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
