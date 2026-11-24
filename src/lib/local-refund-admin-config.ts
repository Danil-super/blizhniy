/** View opt-in only. Local ingress supplies IPC; this flag never grants database or provider authority. */
function readMode(env:NodeJS.ProcessEnv){
 if(typeof window!=='undefined')throw Error('Refund configuration is server-only');
 const mode=env.BLIZHNIY_REFUND_ADMIN;
 if(mode===undefined)return null;
 const origin=env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
 if(env.NODE_ENV!=='production'||(mode!=='local-test'&&mode!=='journal-test')||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
  !origin||!/^https:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin)||new URL(origin).origin!==origin||Number(new URL(origin).port)<1024||Number(new URL(origin).port)>65535)throw Error('Invalid local refund configuration');
 return mode;
}

export function readLocalRefundAdminEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 return readMode(env)==='local-test';
}

export function readLocalRefundJournalConfig(env:NodeJS.ProcessEnv=process.env){
 if(readMode(env)!=='journal-test')return null;
 const socketPath=env.BLIZHNIY_REFUND_OPERATOR_SOCKET,shopId=env.BLIZHNIY_PAYMENT_SHOP_ID;
 if(env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_ADMIN_PAYMENT_JOURNAL!=='test-v1'||
  env.BLIZHNIY_PAYMENT_MODE!=='test'||!socketPath||!shopId||!/^[a-zA-Z0-9_-]{1,64}$/.test(shopId)){
  throw Error('Invalid local refund journal configuration');
 }
 return {socketPath,shopId};
}
