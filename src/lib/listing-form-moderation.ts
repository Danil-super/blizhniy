import {ListingModerationClientError} from './client-listing-moderation.ts';
import type {ListingModerationState} from './postgres-listing-moderation';
type Options={signal?:AbortSignal};
type Request=(owner:string,id:string,revision:string,options?:Options)=>Promise<ListingModerationState>;
/** Bound to the confirmed save, with read-only recovery after an unknown PUT. */
export function createListingFormModeration(owner:string,saved:{id:string;revision:string},dependencies:{submit:Request;read:Request}){
 let uncertain=false,completed=false,busy=false;
 const accept=(state:ListingModerationState)=>{completed=state.state==='pending'||state.state==='approved';uncertain=false;};
 return{
  get uncertain(){return uncertain;},get completed(){return completed;},
  async submit(options?:Options){
   if(busy||uncertain)throw Error('Сначала проверьте статус отправки.');if(completed)return;busy=true;uncertain=true;
   try{accept(await dependencies.submit(owner,saved.id,saved.revision,options));if(!completed)throw Error('Версия не отправлена. Откройте сохранённое объявление в кабинете.');}
   catch(error){if(error instanceof ListingModerationClientError&&['INVALID_INPUT','RATE_LIMITED','DRAFT_CHANGED','DRAFT_NOT_FOUND','UNAUTHENTICATED'].includes(error.code))uncertain=false;throw error;}
   finally{busy=false;}
  },
  async readback(options?:Options){
   if(busy)throw Error('Дождитесь завершения запроса.');busy=true;
   try{accept(await dependencies.read(owner,saved.id,saved.revision,options));}finally{busy=false;}
  },
 };
}
