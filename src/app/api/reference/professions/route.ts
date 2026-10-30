import {authJson} from '@/lib/auth-http';
import {createProfessionCatalogHandler} from '@/lib/profession-catalog-http';
import {getProductionReferenceRepositories} from '@/lib/production-reference-runtime';
import {productionAuthOrigin} from '@/lib/production-auth-config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(process.env.BLIZHNIY_AUTH_MODE!=='postgres')return authJson({error:{code:'NOT_FOUND'}},404);
 return createProfessionCatalogHandler({origin:productionAuthOrigin},async()=>{
  const repositories=await getProductionReferenceRepositories();if(!repositories)throw Error('Profession catalog unavailable');return repositories.professions;
 })(request);
}
export function POST(){return authJson({error:{code:'METHOD_NOT_ALLOWED'}},405,{Allow:'GET'});}
