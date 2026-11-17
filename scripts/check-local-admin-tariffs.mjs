// Explicit owned-local acceptance; retains audit and restores catalog values through the same API.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:https';
import pg from 'pg';
import {stateDirectory,stateFile,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.env.NODE_ENV,'test');
const root=process.cwd(),state=readLocalPrimaryState(stateFile,root),load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const ca=await readFile(join(stateDirectory,'tls-cert.pem')),directory=await mkdtemp(join(stateDirectory,'tariff62-acceptance-'));await chmod(directory,0o700);
const db=new pg.Client({...localPrimaryDatabaseConfig(state,'owner'),ssl:{ca:await readFile(join(stateDirectory,'refund-db-ca.pem'),'utf8'),rejectUnauthorized:true},statement_timeout:5000});
const endpoint='/api/admin/tariff-management',results=[],actors=[],build=(await readFile('.next/BUILD_ID','utf8')).trim();let stage='starting',original,admin,peer,user,actor,restoreRequired=false;
const check=(name,condition=true)=>{assert.ok(condition,name);results.push(name);};
function client(){const cookies=new Map();return async(path,body={},method='POST',expected=200,headers={},loseBody=false)=>new Promise((resolve,reject)=>{
 const bytes=method==='GET'?null:Buffer.from(JSON.stringify(body));
 const req=request(new URL(path,state.origin),{method,ca,rejectUnauthorized:true,signal:AbortSignal.timeout(25000),headers:{origin:state.origin,'sec-fetch-site':'same-origin','x-blizhniy-request':'1',cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{}),...headers}},res=>{
  for(const cookie of res.headers['set-cookie']??[]){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
  if(loseBody){try{assert.equal(res.statusCode,expected,path);resolve({data:null,headers:res.headers});}catch(error){reject(error);}finally{res.destroy();}return;}
  const parts=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2097152)req.destroy(Error('Acceptance response bound'));else parts.push(chunk);});res.on('error',reject);
  res.on('end',()=>{try{assert.equal(res.statusCode,expected,path);const text=Buffer.concat(parts).toString();resolve({data:(res.headers['content-type']??'').includes('application/json')?JSON.parse(text):text,headers:res.headers});}catch(error){reject(error);}});
 });req.on('error',reject);req.end(bytes);
});}
async function account(role){const value={role,email:'tariff-'+randomUUID()+'@local.invalid',password:'SyntheticTariff-'+randomUUID()+'!'};value.id=(await db.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp()) returning id',[randomUUID(),value.email,await load('identity').hashPassword(value.password),role])).rows[0].id;actors.push(value);return value;}
async function login(account,api){const value=await api('/api/account/login',{email:account.email,password:account.password,captchaToken:''});assert.equal(value.data.user.id,account.id);}
const list=async()=> (await admin(endpoint,{resource:'tariffs',action:'list',expectedAdminId:actor.id})).data;
const current=async()=>{const value=(await list()).tariffs.find(row=>row.id==='listing-publication');assert.ok(value);return value;};
const decision=(row,patch={},id=randomUUID())=>({resource:'tariffs',action:'change',expectedAdminId:actor.id,input:{id,tariffId:row.id,expectedRevision:row.revision,name:row.name,price:row.price,durationDays:row.durationDays,active:row.active,reason:'Синтетическая проверка локального тарифа',...patch}});
const financial=async()=> (await db.query("select count(*)::text n,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\\n' order by i.id),''),'UTF8')),'hex') hash from app.payment_checkout_intents i")).rows[0];
async function restore(){if(!restoreRequired)return;const row=await current(),command=decision(row,{name:original.name,price:original.price,durationDays:original.durationDays,active:original.active,reason:'Восстановление исходного тарифа после локальной проверки'});const saved=(await admin(endpoint,command)).data;for(const key of ['id','action','name','price','durationDays','active'])assert.equal(saved.tariffs[0][key],original[key]);restoreRequired=false;check('original-catalog-values-restored-through-audited-api');}
try{
 await db.connect();assert.equal((await db.query('select count(*)::int n from blizhniy_meta.migrations')).rows[0].n,59);assert.equal((await db.query('select count(*)::int n from app_admin.migrations')).rows[0].n,2);
 actor=await account('admin');const other=await account('admin'),ordinary=await account('user');admin=client();peer=client();user=client();await login(actor,admin);await login(other,peer);await login(ordinary,user);
 stage='authorization';const query={resource:'tariffs',action:'list',expectedAdminId:actor.id},data=await list();original=await current();check('real-primary-admin-lists-existing-tariffs',data.tariffs.length===7);const beforeFinance=await financial();
 await client()(endpoint,query,'POST',401);await user(endpoint,{...query,expectedAdminId:ordinary.id},'POST',403);await admin(endpoint,{...query,expectedAdminId:other.id},'POST',403);check('anonymous-ordinary-and-wrong-actor-denied');
 await admin(endpoint,{},'GET',405);await admin(endpoint,{...query,price:'1.00'},'POST',422);await admin(endpoint,query,'POST',403,{origin:'https://foreign.example.invalid'});check('method-input-origin-fences');
 for(const patch of [{price:249.51},{durationDays:0},{name:'<script>x</script>'}])await admin(endpoint,decision(original,patch),'POST',422);check('money-term-and-text-validation');
 const html=(await admin('/admin/tariffs',{},'GET')).data;check('primary-tariff-page-enabled',html.includes('Цены и сроки размещений.'));
 stage='changes';const command=decision(original,{price:original.price==='249.51'?'249.52':'249.51'});restoreRequired=true;const saved=(await admin(endpoint,command)).data;check('exact-price-saved',saved.tariffs[0].price===command.input.price&&saved.receipt.previous.price===original.price&&saved.receipt.changed);
 const replay=(await admin(endpoint,command)).data;assert.deepEqual(replay.receipt,saved.receipt);check('same-id-one-receipt',replay.history.filter(row=>row.id===command.input.id).length===1);
 const recover={resource:'tariffs',action:'recover',expectedAdminId:actor.id,tariffId:original.id,id:command.input.id};assert.deepEqual((await admin(endpoint,recover)).data.receipt,saved.receipt);check('original-receipt-recovery');
 const conflict=await admin(endpoint,{...command,input:{...command.input,reason:'Другая причина'}},'POST',409);check('same-id-different-payload-denied',conflict.data.error.code==='OPERATION_CONFLICT');
 const stale=await admin(endpoint,decision(original,{price:'398.17'}),'POST',409);check('stale-editor-denied',stale.data.error.code==='STALE_TARIFF');await peer(endpoint,{...recover,expectedAdminId:other.id},'POST',409);check('receipt-bound-to-admin');
 const reverse=decision(saved.tariffs[0],{price:original.price}),reversed=(await admin(endpoint,reverse)).data;check('aba-gets-new-revision',reversed.tariffs[0].revision!==original.revision);const old=(await admin(endpoint,command)).data;check('old-replay-never-reapplies',old.tariffs[0].price===original.price);assert.deepEqual(old.receipt,saved.receipt);
 const noOp=(await admin(endpoint,decision(reversed.tariffs[0]))).data;check('noop-keeps-revision',!noOp.receipt.changed&&noOp.tariffs[0].revision===reversed.tariffs[0].revision);
 stage='lost-response';const lost=decision(noOp.tariffs[0],{price:'398.17'});await admin(endpoint,lost,'POST',200,{},true);const recovered=(await admin(endpoint,{...recover,id:lost.input.id})).data;check('lost-response-recovered-with-original-id',recovered.receipt.id===lost.input.id&&recovered.tariffs[0].price==='398.17');assert.equal((await db.query('select count(*)::int n from app_admin.tariff_changes where id=$1',[lost.input.id])).rows[0].n,1);check('lost-response-did-not-duplicate');
 await db.query('begin');try{await assert.rejects(db.query('delete from app_admin.tariff_changes where id=$1',[lost.input.id]),error=>error.code==='23514');}finally{await db.query('rollback');}check('audit-immutable');
 stage='user-compatibility';const inspected=(await admin('/api/admin/user-access',{action:'inspect',expectedAdminId:actor.id,targetId:ordinary.id})).data;check('old-user-inspect-works',inspected.user.authVersion==='0');
 const block={action:'change',expectedAdminId:actor.id,input:{id:randomUUID(),targetId:ordinary.id,expectedVersion:'0',role:'user',isBlocked:true,reason:'Проверка совместимости оператора с тарифами'}};const blocked=(await admin('/api/admin/user-access',block)).data;check('old-user-mutation-works',blocked.user.isBlocked&&blocked.user.authVersion==='1');assert.deepEqual((await admin('/api/admin/user-access',{action:'recover',expectedAdminId:actor.id,targetId:ordinary.id,id:block.input.id})).data.receipt,blocked.receipt);check('old-user-recovery-works');await user('/api/account/profile',{expectedOwnerId:ordinary.id},'POST',401);check('old-session-revocation-works');
 await restore();assert.deepEqual(await financial(),beforeFinance);check('frozen-financial-history-unchanged');
 const response=await admin(endpoint,query);check('admin-response-is-not-cached',response.headers['cache-control']==='no-store');await admin('/api/account/logout');await admin(endpoint,query,'POST',401);check('logout-revokes-tariff-access');
 const report={date:new Date().toISOString(),passed:true,buildId:build,checks:results,mainJournal:59,adminJournal:2,productionTouched:false};await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:true,checks:results.length,buildId:build,report:join(directory,'report.json')}));
}catch(error){await writeFile(join(directory,'failed.json'),JSON.stringify({stage,checks:results,code:error?.code??error?.name??'Error'}),{mode:0o600});throw Error('Local tariff acceptance failed; inspect private stage report');}
finally{try{await restore();}finally{await Promise.allSettled([admin?.('/api/account/logout'),peer?.('/api/account/logout'),user?.('/api/account/logout')]);for(const account of actors)await db.query('update app.users set is_blocked=true where id=$1',[account.id]);await db.end();}}
