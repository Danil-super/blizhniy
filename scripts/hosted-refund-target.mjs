export function isHostedRefundDatabase(env){
 return env.BLIZHNIY_DB_HOST==='17e86f80f26733d39ef4b84d.twc1.net'&&env.BLIZHNIY_DB_PORT==='5432'&&
  env.BLIZHNIY_LOCAL_PRIMARY===undefined&&env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN===undefined;
}
