import {productionAuthOrigin} from './production-auth-config';

export function readPublicationRestrictionEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.BLIZHNIY_PUBLICATION_RESTRICTION_OPERATOR==='hosted-v1'&&env.NODE_ENV==='production'&&
  env.BLIZHNIY_AUTH_MODE==='postgres'&&env.BLIZHNIY_AUTH_ORIGIN===productionAuthOrigin&&
  env.BLIZHNIY_LOCAL_PRIMARY===undefined&&env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN===undefined;
}
