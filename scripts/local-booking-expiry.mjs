import pg from 'pg';
import {createRequire} from 'node:module';
import {localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
const load=createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
/** Owned fixture only. No sessions, provider calls or finance writes. */
export function startLocalBookingExpiry(state){
 const config=localPrimaryDatabaseConfig(state,'runtime');if(config.host!=='127.0.0.1')throw Error('Local booking expiry requires loopback');
 const {PostgresDatabase}=load('postgres'),{PostgresBookingExpiryStore}=load('postgres-booking-expiry');
 const db=new PostgresDatabase(new pg.Pool({...config,max:1,statement_timeout:8000,connectionTimeoutMillis:3000})),store=new PostgresBookingExpiryStore(db);
 let stopped=false,timer,running;
 const tick=()=>{running=store.tick().then(result=>{if(result.expired)console.info(JSON.stringify({event:'local_booking_expiry',expired:result.expired}));},()=>console.error(JSON.stringify({event:'local_booking_expiry',status:'unavailable'}))).finally(()=>{if(!stopped){timer=setTimeout(tick,30000);timer.unref();}});};
 tick();return{close:async()=>{stopped=true;clearTimeout(timer);await running;await db.close();}};
}
