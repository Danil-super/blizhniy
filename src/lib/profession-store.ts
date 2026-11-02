import 'server-only';
import {cache} from 'react';
import {professions} from './data';
import {getProductionReferenceRepositories} from './production-reference-runtime';
import type {PublicProfession} from './profession-catalog-contract';

/** Request-scoped reads, with no static replacement for primary database failures. */
export const getPublicProfessions=cache(async():Promise<Array<Omit<PublicProfession,'id'>&{id?:string}>>=>{
 if(process.env.BLIZHNIY_AUTH_MODE!=='postgres')return professions.filter(item=>item.active).map(item=>({...item,active:true as const}));
 const repositories=await getProductionReferenceRepositories();
 if(!repositories)throw Error('Profession catalog unavailable');
 return repositories.professions.listActive();
});
