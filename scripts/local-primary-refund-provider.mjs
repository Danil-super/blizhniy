import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {localPrimaryMerchant as merchant} from './local-primary-payment.mjs';

const unavailable=()=>Error('Local refund simulator unavailable');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const authorization='Basic '+Buffer.from(merchant.shopId+':'+merchant.secretKey).toString('base64');
const projection=`idempotence_key,provider_id,payment_id,request_body,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`;
const refund=row=>{const body=JSON.parse(row.request_body);return{id:row.provider_id,payment_id:row.payment_id,amount:body.amount,metadata:body.metadata,status:'succeeded',created_at:row.created_at};};

/** Trusted context from the owned local proxy; ownerDb remains owned/closed by that caller. No real provider fallback. */
export async function createLocalPrimaryRefundProvider({state,ownerDb}){
 try{
  if(typeof window!=='undefined'||process.env.NODE_ENV!=='test'||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
   state?.origin!=='https://127.0.0.1:3045'||state.origin!==process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN||state.database!=='blizhniy_prod')throw unavailable();
  const identity=(await ownerDb.query('select current_database() as database,current_user as role')).rows[0];
  if(identity?.database!==state.database||identity.role!=='postgres')throw unavailable();
  await ownerDb.query(await readFile(new URL('../database/local-primary-refunds.sql',import.meta.url),'utf8'));
 }catch{throw unavailable();}
 async function payment(db,id,lock=false){
  const row=(await db.query(`select p.intent_id,p.provider_id,p.status,p.captured_at,i.amount::text,i.request_body,i.merchant_shop_id,i.is_test,
   exists(select 1 from local_primary.provider_refunds r where r.payment_id=p.provider_id) as refunded
   from local_primary.provider_payments p join app.payment_checkout_intents i on i.id=p.intent_id where p.provider_id=$1 ${lock?'for update of p':''}`,[id])).rows[0];
  if(!row||row.merchant_shop_id!==merchant.shopId||row.is_test!==true)throw unavailable();
  return row;
 }
 return async(input,init={})=>{
  try{
   init.signal?.throwIfAborted();const url=new URL(String(input)),method=init.method??'GET',headers=new Headers(init.headers);
   if(url.origin!=='https://api.yookassa.ru'||url.username||url.password||url.hash||headers.get('authorization')!==authorization)throw unavailable();
   if(method==='GET'&&init.body!==undefined)throw unavailable();
   if(method==='GET'&&url.pathname==='/v3/me'&&!url.search)return Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization:{enabled:false}});
   const parts=url.pathname.split('/');
   if(method==='GET'&&parts.length===4&&parts[1]==='v3'&&parts[2]==='payments'&&uuid.test(parts[3])&&!url.search){
    const row=await payment(ownerDb,parts[3]);
    return Response.json({id:row.provider_id,status:row.status,paid:row.status==='succeeded',test:true,
     amount:{value:row.amount,currency:'RUB'},recipient:{account_id:merchant.shopId},metadata:JSON.parse(row.request_body).metadata,
     refundable:row.status==='succeeded'&&!row.refunded,...(row.status==='succeeded'?{captured_at:row.captured_at}:{})});
   }
   if(method==='GET'&&url.pathname==='/v3/refunds'&&[...url.searchParams.keys()].sort().join() ==='limit,payment_id'&&url.searchParams.get('limit')==='100'&&uuid.test(url.searchParams.get('payment_id')??'')){
    const id=url.searchParams.get('payment_id');await payment(ownerDb,id);
    return Response.json({type:'list',items:(await ownerDb.query(`select ${projection} from local_primary.provider_refunds where payment_id=$1`,[id])).rows.map(refund)});
   }
   if(method==='GET'&&parts.length===4&&parts[1]==='v3'&&parts[2]==='refunds'&&uuid.test(parts[3])&&!url.search){
    const row=(await ownerDb.query(`select ${projection} from local_primary.provider_refunds where provider_id=$1`,[parts[3]])).rows[0];
    if(!row)throw unavailable();await payment(ownerDb,row.payment_id);return Response.json(refund(row));
   }
   const key=headers.get('idempotence-key');
   if(method!=='POST'||url.pathname!=='/v3/refunds'||url.search||headers.get('content-type')!=='application/json'||
    typeof key!=='string'||!key.startsWith('refund-')||!uuid.test(key.slice(7))||typeof init.body!=='string'||Buffer.byteLength(init.body)>4096)throw unavailable();
   const body=JSON.parse(init.body);if(!uuid.test(body?.payment_id??''))throw unavailable();
   const row=await ownerDb.transaction(async tx=>{
    await tx.query("set local statement_timeout='5s'");await tx.query("set local lock_timeout='1s'");
    const original=await payment(tx,body.payment_id,true);init.signal?.throwIfAborted();
    const prepared=(await tx.query(`select r.idempotence_key,r.request_body,s.payment_intent_id,s.provider_payment_id,s.merchant_shop_id,s.is_test
     from app.payment_refund_requests r join app.payment_refund_reservations s on s.id=r.operation_id where r.operation_id=$1`,[key.slice(7)])).rows[0];
    if(!prepared||prepared.idempotence_key!==key||prepared.request_body!==init.body||prepared.payment_intent_id!==original.intent_id||
     prepared.provider_payment_id!==original.provider_id||prepared.merchant_shop_id!==merchant.shopId||prepared.is_test!==true||original.status!=='succeeded')throw unavailable();
    const cached=(await tx.query(`select ${projection} from local_primary.provider_refunds where idempotence_key=$1`,[key])).rows[0];
    if(cached){if(cached.request_body!==init.body||cached.payment_id!==original.provider_id)throw unavailable();return cached;}
    init.signal?.throwIfAborted();
    return(await tx.query(`insert into local_primary.provider_refunds(idempotence_key,provider_id,payment_id,request_body) values($1,$2,$3,$4) returning ${projection}`,[key,randomUUID(),original.provider_id,init.body])).rows[0];
   });
   return Response.json(refund(row));
  }catch{throw unavailable();}
 };
}
