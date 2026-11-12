/** View opt-in only. Local ingress supplies IPC; this flag never grants database or provider authority. */
export function readLocalRefundAdminEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(typeof window!=='undefined')throw Error('Refund configuration is server-only');
 if(env.BLIZHNIY_REFUND_ADMIN===undefined)return false;
 const origin=env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
 if(env.NODE_ENV!=='production'||env.BLIZHNIY_REFUND_ADMIN!=='local-test'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
  !origin||!/^https:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin)||new URL(origin).origin!==origin||Number(new URL(origin).port)<1024||Number(new URL(origin).port)>65535)throw Error('Invalid local refund configuration');
 return true;
}
