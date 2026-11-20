import {readBookingLifecycleEnabled} from './booking-lifecycle.ts';
import {readPostmoderationEnabled} from './listing-workflow-config.ts';

// The HTTP layer verifies the production database and auth configuration before opening its store.
export function readBookingRuntimeEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
 if(env.BLIZHNIY_BOOKING_LIFECYCLE!=='production-v1')return readBookingLifecycleEnabled(env);
 if(env.NODE_ENV!=='production'||env.BLIZHNIY_LOCAL_PRIMARY!==undefined||
    env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||!readPostmoderationEnabled(env)){
  throw Error('Invalid production booking configuration');
 }
 return true;
}
