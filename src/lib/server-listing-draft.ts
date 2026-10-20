import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {readAccountSessionToken} from './account-cookie';
import {IdentityStore} from './identity';
import {parseListingDraftId} from './listing-draft-contract';
import {ListingDraftAccessError} from './postgres-listing-drafts';
import {AppSessionAccessError} from './app-session-transaction';
import {PostgresListingFormStore} from './postgres-listing-form';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';

/** The cookie is authority; the URL contains only a resource id, never an owner or token. */
export async function readServerListingDraft(value:string){
 let id:string;try{id=parseListingDraftId(value);}catch{notFound();}
 const config=readProductionAuthConfig();if(!config)notFound();
 const token=readAccountSessionToken(new Request(config.origin,{headers:await headers()}));
 const login=()=>redirect(`/auth?returnTo=${encodeURIComponent(`/razmestit/obyavlenie?draft=${id}`)}`);
 if(!token)login();
 const {db}=await getProductionAccountDatabase(config),user=await new IdentityStore(db).resolveSession(token!);
 if(!user)login();
 try{
  const store=new PostgresListingFormStore(db,{contactMethod:process.env.BLIZHNIY_LISTING_CONTACT_METHOD==='enabled'});
  return{owner:user!.id,snapshot:await store.read(token!,user!.id,id)};
 }catch(error){if(error instanceof ListingDraftAccessError)notFound();if(error instanceof AppSessionAccessError)login();throw error;}
}
