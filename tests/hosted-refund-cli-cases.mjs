import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import pg from 'pg';
import {seedHostedRefundCommand} from './hosted-refund-workflow-cases.mjs';
import {enableRefundFixtureTls} from './local-refund-runtime-cases.mjs';

const run=promisify(execFile);
const host='17e86f80f26733d39ef4b84d.twc1.net',database='blizhniy_prod';
const fixture=new URL('./fixtures/hosted-refund-cli-preload.mjs',import.meta.url).href;

export async function testHostedRefundCli({admin,config,load,docker,container,directory,artifacts}){
 assert.equal(config.host,'127.0.0.1');
 assert.equal(config.database,'blizhniy_test');
 assert.match(container,/^[0-9a-f]{64}$/);
 const cert=join(directory,'hosted-refund-cli.crt');
 const [operator,worker]=artifacts;
 const operatorDb=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:operator.role,password:operator.password}));
 const owner=new pg.Pool({...config,database});
 const merchant={shopId:'900000158',secretKey:'test_refund_cli_fixture',isTest:true};
 try{
  await enableRefundFixtureTls(admin,{docker,container},cert,join(directory,'hosted-refund-cli.key'),host);
  const {item,reviewer}=await seedHostedRefundCommand(owner,load,merchant);
  const approvalId=randomUUID();
  const approvals=new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(operatorDb,{...merchant,marqueeRefunds:true,specialistRefunds:true});
  const receipt=await approvals.approve(reviewer.token,reviewer.id,{id:approvalId,paymentIntentId:item.id,reason:'Синтетический полный возврат.'});
  assert.equal(receipt.amount,item.amount);
  const payment=async()=>(await owner.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status;
  const providerLog=join(directory,'provider-requests.log'),caseFile=join(directory,'hosted-refund-command.json');
  async function command(entry,mode,{acceptStore=true,change={},expectedStatus=0}={}){
   await writeFile(providerLog,'',{mode:0o600});
   await writeFile(caseFile,JSON.stringify({host,port:config.port,item,approvalId,merchant,acceptStore,stopAfterTick:mode==='--run',log:providerLog}),{mode:0o600});
   const env={PATH:process.env.PATH,NODE_ENV:'production',BLIZHNIY_PAYMENT_MODE:'test',
    ['BLIZHNIY_REFUND_'+entry.kind.toUpperCase()]:'hosted-test-v1',BLIZHNIY_DB_HOST:host,BLIZHNIY_DB_PORT:'5432',
    BLIZHNIY_DB_NAME:database,BLIZHNIY_DB_USER:entry.role,BLIZHNIY_DB_PASSWORD:entry.password,
    BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:cert,BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,
    BLIZHNIY_PAYMENT_SECRET_KEY:merchant.secretKey,BLIZHNIY_TEST_REFUND_COMMAND:caseFile,...change};
   const result=await run(process.execPath,['--import',fixture,join(entry.destination,'scripts','hosted-refund-'+entry.kind+'.mjs'),mode],
    {cwd:entry.destination,env,timeout:15000,maxBuffer:16384}).then(r=>({...r,code:0}),e=>e);
   assert.equal(result.code,expectedStatus,JSON.stringify({stdout:result.stdout,stderr:result.stderr}));
   const output=entry.kind==='operator'&&expectedStatus===1?result.stderr:result.stdout;
   const events=output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
   assert.ok(events.length,output);
   const providerSteps=(await readFile(providerLog,'utf8')).trim().split(/\n/).filter(Boolean);
   return {events,providerSteps};
  }
  for(const entry of artifacts){
   const checked=await command(entry,'--check');
   assert.equal(checked.events.at(-1).status,'checked');
   assert.deepEqual(checked.providerSteps,['merchant']);
   const badStore=await command(entry,'--check',{acceptStore:false,expectedStatus:1});
   assert.equal(badStore.events.at(-1).status,'unavailable');
   assert.deepEqual(badStore.providerSteps,['merchant']);
   const badCa=await command(entry,'--check',{change:{BLIZHNIY_DB_CA_FILE:join(directory,'refund-ca.crt')},expectedStatus:1});
   assert.equal(badCa.events.at(-1).status,'unavailable');
   assert.deepEqual(badCa.providerSteps,[]);
   const wrongRole=await command(entry,'--check',{change:{BLIZHNIY_DB_USER:'blizhniy_runtime'},expectedStatus:1});
   assert.deepEqual(wrongRole.providerSteps,[]);
  }
  const before=(await owner.query("select sha256 from blizhniy_meta.migrations where name='0087-push-delivery.sql'")).rows[0].sha256;
  await owner.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0087-push-delivery.sql'");
  try{
   assert.deepEqual((await command(worker,'--check',{expectedStatus:1})).providerSteps,[]);
  }finally{
   await owner.query("update blizhniy_meta.migrations set sha256=$1 where name='0087-push-delivery.sql'",[before]);
  }
  assert.equal(await payment(),'succeeded');
  const sent=await command(worker,'--run');
  assert.equal(sent.events.find(e=>e.status==='tick').state,'completed');
  assert.equal(sent.events.at(-1).status,'stopped');
  const {providerSteps}=sent,dispatchIndex=providerSteps.indexOf('dispatch');
  assert.equal(providerSteps[0],'merchant');
  assert.ok(dispatchIndex>1&&providerSteps.slice(1,dispatchIndex).every(step=>step==='inspect'));
  assert.equal(providerSteps.filter(step=>step==='dispatch').length,1);
  assert.equal(providerSteps.filter(step=>step==='verify').length,1);
  assert.ok(providerSteps.indexOf('verify')>dispatchIndex);
  assert.equal(await payment(),'refunded');
  assert.deepEqual((await owner.query('select status,is_paid from app.work_publications where id=$1',[item.targetId])).rows,
   [{status:'archived',is_paid:false}]);
  const restarted=await command(worker,'--run');
  assert.equal(restarted.events.find(e=>e.status==='tick').state,'idle');
  assert.deepEqual(restarted.providerSteps,['merchant']);
  assert.equal((await owner.query('select count(*)::int as count from app.payment_refund_effects where operation_id=$1',[approvalId])).rows[0].count,1);
  assert.equal((await owner.query('select count(*)::int as count from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].count,1);
 }finally{
  await operatorDb.close();await owner.end();
 }
}
