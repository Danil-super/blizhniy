import {productionAuthOrigin} from './production-auth-config';

export function readApplicationContactViewsMode(env:NodeJS.ProcessEnv=process.env):boolean|'production-v1'{
 const value=env.BLIZHNIY_APPLICATION_CONTACT_VIEWS;
 if(value===undefined||value==='disabled')return false;
 if(value==='enabled')return true;
 if(value==='production-v1'){
  if(env.NODE_ENV!=='production'||env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_AUTH_ORIGIN!==productionAuthOrigin||
   env.BLIZHNIY_LISTING_WORKFLOW!=='postmoderation'||env.BLIZHNIY_LOCAL_PRIMARY!==undefined||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined)
   throw Error('Invalid production application contact view policy');
  return value;
 }
 throw Error('Invalid application contact view policy');
}
