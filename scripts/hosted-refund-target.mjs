import {matchesHostedPostgresLocation} from './hosted-postgres-location.mjs';

export function isHostedRefundDatabase(env){
 return matchesHostedPostgresLocation(env)&&
  env.BLIZHNIY_LOCAL_PRIMARY===undefined&&env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN===undefined;
}
