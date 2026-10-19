import {createHash} from 'node:crypto';
import type {PostgresDatabase,PostgresQueries} from './postgres';

export type PaymentIntentBinding={id:string;ownerId:string;targetType:'listing'|'vacancy'|'workRequest'|'specialist'|'application'|'fair_application'|'ad_marquee';targetId:string;targetRevision:string;tariffId:string;amount:string;durationDays:number|null;shopId:string;isTest:boolean};
export type PaymentIntent=PaymentIntentBinding&{requestBody:string};
export class PaymentIntentError extends Error{
 constructor(){super('Payment intent requires verification');this.name='PaymentIntentError';}
}
function fail():never{throw new PaymentIntentError();}
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail();
function keys(value:Record<string,unknown>,required:string[],optional:string[]=[]){
 if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail();
}
function https(value:unknown){
 if(typeof value!=='string'||!value.isWellFormed()||value.length>2048||/[\s\\\u0000-\u0020\u007f]/.test(value))fail();
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)fail();}catch{fail();}
}
const bindingKeys=['id','ownerId','targetType','targetId','targetRevision','tariffId','amount','durationDays','shopId','isTest'];
function checkBinding(value:PaymentIntentBinding){
 if(!uuid(value.id)||!uuid(value.ownerId)||!uuid(value.targetId)||!['listing','vacancy','workRequest','specialist','application','fair_application','ad_marquee'].includes(value.targetType)||
  typeof value.targetRevision!=='string'||!/^[1-9]\d{0,18}$/.test(value.targetRevision)||BigInt(value.targetRevision)>BigInt('9223372036854775807')||
  typeof value.tariffId!=='string'||value.tariffId.length>100||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.tariffId)||
  typeof value.amount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(value.amount)||value.amount==='0.00'||
  (value.durationDays!==null&&(!Number.isInteger(value.durationDays)||value.durationDays<1||value.durationDays>3650))||
  typeof value.shopId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(value.shopId)||typeof value.isTest!=='boolean')fail();
}
/** Server-generated request only. Preserve bytes; never rebuild a saved receipt from current configuration. */
export function parsePaymentIntent(input:unknown):PaymentIntent{
 const value=object(input);keys(value,[...bindingKeys,'requestBody']);
 const intent=value as PaymentIntent;checkBinding(intent);
 if(typeof intent.requestBody!=='string'||Buffer.byteLength(intent.requestBody,'utf8')>16384||!intent.requestBody.isWellFormed())fail();
 let body:Record<string,unknown>;try{body=object(JSON.parse(intent.requestBody));}catch{fail();}
 keys(body,['amount','capture','confirmation','metadata'],['description','receipt']);
 const amount=object(body.amount);keys(amount,['value','currency']);
 if(amount.value!==intent.amount||amount.currency!=='RUB'||body.capture!==true)fail();
 const metadata=object(body.metadata);keys(metadata,['localPaymentId','targetId','targetType','tariffId']);
 if(metadata.localPaymentId!==intent.id||metadata.targetId!==intent.targetId||metadata.targetType!==intent.targetType||metadata.tariffId!==intent.tariffId)fail();
 const confirmation=object(body.confirmation);keys(confirmation,['type','return_url']);
 if(confirmation.type!=='redirect')fail();https(confirmation.return_url);
 if(body.description!==undefined&&(typeof body.description!=='string'||!body.description.isWellFormed()||body.description.length>128||/[\u0000-\u001f\u007f]/.test(body.description)))fail();
 if(body.receipt!==undefined){
  const receipt=object(body.receipt);keys(receipt,['customer','internet','items']);
  const customer=object(receipt.customer);keys(customer,['email']);
  if(typeof customer.email!=='string'||!customer.email.isWellFormed()||/[\u0000-\u001f\u007f]/.test(customer.email)||customer.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||receipt.internet!==true||!Array.isArray(receipt.items)||receipt.items.length!==1)fail();
  const item=object(receipt.items[0]);keys(item,['amount','description','payment_mode','payment_subject','quantity','vat_code']);
  const receiptAmount=object(item.amount);keys(receiptAmount,['value','currency']);
  if(receiptAmount.value!==intent.amount||receiptAmount.currency!=='RUB'||typeof item.description!=='string'||!item.description.isWellFormed()||/[\u0000-\u001f\u007f]/.test(item.description)||item.description.length<1||item.description.length>128||
   item.payment_mode!=='full_payment'||item.payment_subject!=='service'||item.quantity!==1||typeof item.vat_code!=='number'||!Number.isInteger(item.vat_code)||item.vat_code<1||item.vat_code>12)fail();
 }
 return {...intent};
}
type Row=PaymentIntent&{sha256:string};
const columns=`id,owner_id as "ownerId",target_type as "targetType",target_id as "targetId",target_revision::text as "targetRevision",tariff_id as "tariffId",amount::text,duration_days as "durationDays",merchant_shop_id as "shopId",is_test as "isTest",request_body as "requestBody",request_sha256 as sha256`;
const values=(intent:PaymentIntent)=>[intent.id,intent.ownerId,intent.targetType,intent.targetId,intent.targetRevision,intent.tariffId,intent.amount,intent.durationDays,intent.shopId,intent.isTest,intent.requestBody];
const sameBinding=(row:PaymentIntentBinding,binding:PaymentIntentBinding)=>bindingKeys.every(key=>row[key as keyof PaymentIntentBinding]===binding[key as keyof PaymentIntentBinding]);
function decode(row:Row|undefined,binding:PaymentIntentBinding):PaymentIntent{
 if(!row||!sameBinding(row,binding))return fail();
 const {sha256:hash,...intent}=row;
 const parsed=parsePaymentIntent(intent);
 if(createHash('sha256').update(parsed.requestBody,'utf8').digest('hex')!==hash)fail();
 return parsed;
}
export type PaymentDispatch={decision:'post';requestBody:string;remainingMs:number}|{decision:'recover';providerId:string};
/** Private financial storage, NOT a user-facing checkout API or target-eligibility authorizer.
 * No production runtime grants. Caller must atomically authorize the target before persistInTransaction.
 */
export class PostgresPaymentIntentStore{
 private readonly db:Pick<PostgresDatabase,'transaction'>;
 constructor(db:Pick<PostgresDatabase,'transaction'>){if(typeof window!=='undefined')fail();this.db=db;}
 async persistInTransaction(tx:PostgresQueries,input:unknown):Promise<PaymentIntent>{
  const intent=parsePaymentIntent(input);
  await tx.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do nothing`,values(intent));
  const row=(await tx.query<Row>(`select ${columns} from app.payment_checkout_intents where id=$1`,[intent.id])).rows[0];
  // The concurrent loser adopts the winner's exact receipt, not its own freshly rebuilt body.
  return decode(row,intent);
 }
 async authorize(binding:PaymentIntentBinding):Promise<PaymentDispatch>{
  checkBinding(binding);const started=performance.now();
  const result=await this.db.transaction(async tx=>{
   const row=(await tx.query<Row>(`select ${columns} from app.payment_checkout_intents where id=$1 for update`,[binding.id])).rows[0];
   const intent=decode(row,binding);
   const provider=(await tx.query<{id:string}>('select provider_payment_id as id from app.payment_provider_links where intent_id=$1',[binding.id])).rows[0];
   if(provider)return{decision:'recover',providerId:provider.id} as const;
   await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1) on conflict(intent_id) do nothing',[binding.id]);
   const clock=(await tx.query<{remaining:string}>(`select floor(extract(epoch from (authorized_at+interval '23 hours 55 minutes'-clock_timestamp()))*1000)::text as remaining from app.payment_dispatch_anchors where intent_id=$1`,[binding.id])).rows[0];
   if(!clock||!/^\d+$/.test(clock.remaining)||Number(clock.remaining)<=0)fail();
   return{decision:'post',requestBody:intent.requestBody,remainingMs:Number(clock.remaining)} as const;
  });
  if(result.decision==='recover')return result;
  const remainingMs=result.remainingMs-Math.max(0,performance.now()-started);
  if(!Number.isFinite(remainingMs)||remainingMs<=0)fail();
  return{...result,remainingMs};
 }
 /** Call only after independently validating the authoritative provider response; never from browser/webhook payload. */
 async bindProvider(binding:PaymentIntentBinding,providerId:string):Promise<void>{
  checkBinding(binding);if(!uuid(providerId))fail();
  await this.db.transaction(async tx=>{
   const row=(await tx.query<Row>(`select ${columns} from app.payment_checkout_intents where id=$1 for update`,[binding.id])).rows[0];decode(row,binding);
   if((await tx.query('select intent_id from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rowCount!==1)fail();
   await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2) on conflict(intent_id) do nothing',[binding.id,providerId]);
   if((await tx.query<{id:string}>('select provider_payment_id as id from app.payment_provider_links where intent_id=$1',[binding.id])).rows[0]?.id!==providerId)fail();
  });
 }
}
