// Strict owned SQL fixture for real production page rendering, never a database connection.
require('./listing-form-browser-pg.cjs');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),pg=require('pg'),Base=pg.Pool;
pg.Pool=class extends Base{
 async query(statement){
  const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?[]:statement.values;
  if(sql==="select to_regclass('app.specialist_test_enrollment') is not null as installed")return{rows:[{installed:false}]};
  if(sql==="select pg_catalog.to_regnamespace('app_publication_restriction') is not null as installed")return{rows:[{installed:true}]};
  if(sql.startsWith('select id,slug,name,parent_name as parent,active from app.specialist_categories')){
   const rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_SERVICE_FIXTURE,'utf8'));
   const specialist=rows.find(row=>row.kind==='specialist');
   return{rows:[{id:specialist.professionId,slug:'santehnik',name:specialist.form.professionName,parent:'Ремонт и строительство',active:true}]};
  }
  if(sql.startsWith('select s.id,s.kind,')&&sql.includes('from app.service_publications s')){
   assert.ok(sql.includes("review.state='approved'"));assert.ok(sql.includes("s.status='published' and s.is_paid"));assert.ok(sql.includes('s.expires_at>statement_timestamp()'));
   assert.ok(sql.includes('not exists(select 1 from app_publication_restriction.restrictions hold'));
   const rows=JSON.parse(readFileSync(process.env.BLIZHNIY_PUBLIC_SERVICE_FIXTURE,'utf8'));assert.ok(Array.isArray(rows));
   const visibleRows=rows.filter(row=>!row.restricted);
   if(sql.includes("s.kind='specialist' and s.profession_id=$1")){
    const [professionId,limit,offset]=values;
    return{rows:visibleRows.filter(row=>row.kind==='specialist'&&row.professionId===professionId).slice(offset,offset+limit)};
   }
   const [kind,selection,offset=0]=values;
   const selected=visibleRows.filter(row=>row.kind===kind&&(typeof selection!=='string'||row.id===selection));
   return{rows:typeof selection==='number'?selected.slice(offset,offset+selection):selected};
  }
  return super.query(statement);
 }
};
