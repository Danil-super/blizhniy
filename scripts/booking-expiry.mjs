// One bounded batch. The systemd timer starts another process after this one exits.
import nextEnv from '@next/env';
import {readBookingRuntimeEnabled} from '../src/lib/production-booking-config.ts';
import {readProductionAuthConfig} from '../src/lib/production-auth-config.ts';
import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresBookingExpiryStore} from '../src/lib/postgres-booking-expiry.ts';

let database;
try{
 const mode=process.argv[2];
 if(process.argv.length!==3||!['--check','--run'].includes(mode)||process.getuid?.()===0)throw Error();
 nextEnv.loadEnvConfig(process.cwd(),false,{info(){},error(){throw Error('Configuration unavailable');}});
 if(process.env.BLIZHNIY_BOOKING_LIFECYCLE!=='production-v1'||!readBookingRuntimeEnabled()||!readProductionAuthConfig())throw Error();
 database=createPostgresDatabase();
 const check=await database.query(`select current_user='blizhniy_runtime' and current_database()='blizhniy_prod'
  and has_column_privilege('app.listings','id','SELECT') and has_any_column_privilege('app.listings','UPDATE')
  and (select bool_and(has_column_privilege('app.booking_requests',c,'SELECT')) from unnest(array['id','listing_id','status','expires_at','revision']) c)
  and (select bool_and(has_column_privilege('app.booking_requests',c,'UPDATE')) from unnest(array['status','revision','updated_at','decided_at']) c)
  and count(*)=2 as ready from pg_trigger where tgrelid='app.booking_requests'::regclass and tgenabled='A'
  and tgname in ('booking_lifecycle_guard','booking_lifecycle_event')`);
 if(!check.rows[0]?.ready)throw Error();
 let expired=0;
 if(mode==='--run'){
  const store=new PostgresBookingExpiryStore(database);
  for(let i=0;i<10;i++){
   const batch=await store.tick();
   if(batch.state==='idle')break;
   expired+=batch.expired;
  }
 }
 process.stdout.write(JSON.stringify({event:'booking_expiry',status:mode==='--check'?'checked':'completed',expired})+'\n');
}catch{
 process.stderr.write('Booking expiry unavailable\n');process.exitCode=1;
}finally{
 try{await database?.close();}catch{process.stderr.write('Booking database close failed\n');process.exitCode=1;}
}
