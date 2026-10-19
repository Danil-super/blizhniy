import {PostgresPaymentIntentStore} from './postgres-payment-intents.ts';
import {createPrimaryYooKassaReader} from './primary-yookassa-reader.ts';
import {mergePaymentVerification,PaymentVerificationError,type PaymentVerificationState} from './payment-verification-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres.ts';

type OrderStatus='created'|'pending'|'succeeded'|'failed'|'refunded';
export type StoredPaymentVerification=PaymentVerificationState&{id:string;providerPaymentId:string;orderStatus:OrderStatus};
type Merchant=Parameters<typeof createPrimaryYooKassaReader>[0];
const source=`select status,captured_at as "capturedAt" from app.payment_verifications where intent_id=$1`;

/** Trusted financial worker only; no user-facing authority, POST, entitlement or publication writes. */
export class PostgresPaymentVerificationStore {
  private readonly db:Pick<PostgresDatabase,'transaction'>;
  private readonly intents:PostgresPaymentIntentStore;
  private readonly reader:ReturnType<typeof createPrimaryYooKassaReader>;
  constructor(db:Pick<PostgresDatabase,'transaction'>,merchant:Merchant,fetcher:typeof fetch=globalThis.fetch){
    this.db=db;
    this.reader=createPrimaryYooKassaReader(merchant,fetcher);
    this.intents=new PostgresPaymentIntentStore(db);
  }
  private async known(tx:PostgresQueries,id:string){
    // Every financial writer uses the same immutable intent lock before the order.
    const intent=await this.intents.lockKnownInTransaction(tx,id);
    const order=(await tx.query<{status:OrderStatus}>('select status from app.payment_orders where id=$1 for update',[id])).rows[0];
    if(!order)throw new PaymentVerificationError();
    return {intent,orderStatus:order.status};
  }
  async read(id:string):Promise<StoredPaymentVerification|null>{
    return this.db.transaction(async tx=>{
      const {intent,orderStatus}=await this.known(tx,id);
      const state=(await tx.query<PaymentVerificationState>(source,[id])).rows[0];
      return state?{id,providerPaymentId:intent.providerPaymentId,...state,orderStatus}:null;
    });
  }
  async reconcile(id:string):Promise<StoredPaymentVerification>{
    const original=await this.db.transaction(async tx=>(await this.known(tx,id)).intent);
    // Remote I/O never keeps a database transaction or row lock open.
    const verified=await this.reader.read(original);
    return this.db.transaction(async tx=>{
      const {intent,orderStatus:previousOrderStatus}=await this.known(tx,id);
      if(intent.providerPaymentId!==original.providerPaymentId)throw new PaymentVerificationError();
      const previous=(await tx.query<PaymentVerificationState>(source,[id])).rows[0]??null;
      const state=mergePaymentVerification(previous,{status:verified.status,capturedAt:verified.capturedAt??null});
      const orderStatus:OrderStatus=state.status==='succeeded'?(previousOrderStatus==='refunded'?'refunded':'succeeded'):
        state.status==='canceled'?'failed':'pending';
      if(!previous||previous.status!==state.status||previous.capturedAt!==state.capturedAt){
        await tx.query(`insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,$3,$4)
          on conflict(intent_id) do update set status=excluded.status,captured_at=excluded.captured_at`,[id,intent.providerPaymentId,state.status,state.capturedAt]);
      }
      if(previousOrderStatus!==orderStatus)await tx.query('update app.payment_orders set status=$2 where id=$1',[id,orderStatus]);
      return {id,providerPaymentId:intent.providerPaymentId,...state,orderStatus};
    });
  }
}
