import pg from 'pg';
import {createRequire} from 'node:module';
import {readServiceCheckoutEnabled} from '../src/lib/service-checkout-config.ts';
import {localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
/** Owned synthetic stand only; one bounded batch and one purchase per transaction. No provider requests. */
export function startLocalServicePublicationQueue(state){
 if(!readServiceCheckoutEnabled())throw Error('Local service checkout disabled');
 const config=localPrimaryDatabaseConfig(state,'owner');if(config.host!=='127.0.0.1')throw Error('Local service queue requires loopback');
 const {PostgresDatabase}=load('postgres'),{PostgresServicePaymentFulfillmentStore}=load('postgres-service-payment-fulfillment');
 const db=new PostgresDatabase(new pg.Pool({...config,max:1,statement_timeout:5000,connectionTimeoutMillis:3000})),store=new PostgresServicePaymentFulfillmentStore(db,{shopId:'local-fixture-shop',isTest:true});
 let stopped=false,timer,running;
 const tick=()=>{running=(async()=>{let fulfilled=0;for(const id of await store.discover(10)){if(stopped)break;if((await store.fulfill(id)).state==='fulfilled')fulfilled++;}if(fulfilled)console.info(JSON.stringify({event:'local_service_publications',fulfilled}));})()
  .catch(()=>console.error(JSON.stringify({event:'local_service_publications',status:'unavailable'})))
  .finally(()=>{if(!stopped){timer=setTimeout(tick,30000);timer.unref();}});};
 tick();return{close:async()=>{stopped=true;clearTimeout(timer);await running;await db.close();}};
}
