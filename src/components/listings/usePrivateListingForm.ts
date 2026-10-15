"use client";
import {useEffect,useRef,useState} from 'react';
import {productionListingForm,ListingFormClientError} from '@/lib/client-listing-form';
import {listingExtraFields,replaceListingExtraFields,type ListingExtraFields} from '@/lib/listing-form-edit';
import {sameListingForm} from '@/lib/listing-form-save';
import type {ListingFormDraft,ListingFormSnapshot} from '@/lib/listing-form-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {useDraftLeaveGuard} from './useDraftLeaveGuard';
type Editor={saved:ListingFormSnapshot;fields:ListingExtraFields;blocked:boolean;remote:ListingFormSnapshot|null};
/** State stays in the owner-keyed workspace when its private DOM is removed during a recheck. */
export function usePrivateListingForm(owner:string,id:string|undefined){
 const [editor,setEditor]=useState<Editor|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false),attempted=useRef<ListingFormDraft|null>(null);
 const dirty=!!editor&&JSON.stringify(editor.fields)!==JSON.stringify(listingExtraFields(editor.saved.form));
 useDraftLeaveGuard(dirty||!!editor?.blocked);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const generation=++epoch.current;
  locked.current=false;attempted.current=null;setEditor(null);setBusy(false);setMessage(null);
  return()=>{epoch.current=generation+1;controller.abort();};
 },[owner,id]);
 async function run(work:()=>Promise<void>){
  if(locked.current||!id)return;locked.current=true;setBusy(true);setMessage(null);const generation=epoch.current;
  const current=()=>generation===epoch.current;
  try{await work();}catch(error){if(current()){
   const failure=error instanceof ListingFormClientError?error:new ListingFormClientError('UNKNOWN');setMessage(failure.message);
   if(failure.code==='UNAUTHENTICATED'||failure.code==='DRAFT_NOT_FOUND'){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
  }}finally{if(current()){locked.current=false;setBusy(false);}}
 }
 return{editor,busy,message,dirty,
  open:()=>void run(async()=>{const generation=epoch.current,value=await productionListingForm.read(owner,id!,{signal:scope.current?.signal});
   if(epoch.current===generation)setEditor({saved:value,fields:listingExtraFields(value.form),blocked:false,remote:null});}),
  change:(fields:Partial<ListingExtraFields>)=>{if(!locked.current)setEditor(value=>value&&!value.blocked?{...value,fields:{...value.fields,...fields}}:value);},
  close:()=>{if(locked.current)return false;if((dirty||editor?.blocked)&&!window.confirm('Закрыть дополнительные поля с несохранёнными или неподтверждёнными правками? Отправленный запрос при этом не отменяется.'))return false;
   setEditor(null);setMessage(null);attempted.current=null;return true;},
  save:()=>{
   if(!editor||editor.blocked||!dirty||locked.current)return;
   let form:ListingFormDraft;try{form=replaceListingExtraFields(editor.saved.form,editor.fields);}catch{setMessage('Проверьте поля: координаты задаются парой, цены — числами, даты — в формате ГГГГ-ММ-ДД.');return;}
   const generation=epoch.current;attempted.current=form;
   void run(async()=>{
    try{const value=await productionListingForm.write(owner,editor.saved.id,editor.saved.revision,form,{signal:scope.current?.signal});
     if(epoch.current!==generation)return;if(!sameListingForm(value.form,form))throw new ListingFormClientError('UNKNOWN');
     setEditor({saved:value,fields:listingExtraFields(value.form),blocked:false,remote:null});attempted.current=null;setMessage('Дополнительные поля сохранены.');
    }catch(error){if(epoch.current===generation){const code=error instanceof ListingFormClientError?error.code:'UNKNOWN';
     if(code!=='INVALID_INPUT'&&code!=='RATE_LIMITED')setEditor(value=>value?{...value,blocked:true,remote:null}:null);
    }throw error;}
   });
  },
  readback:()=>void run(async()=>{
   if(!editor)return;const generation=epoch.current,value=await productionListingForm.read(owner,editor.saved.id,{signal:scope.current?.signal});
   if(epoch.current!==generation)return;
   if(attempted.current&&sameListingForm(value.form,attempted.current)){
    setEditor({saved:value,fields:listingExtraFields(value.form),blocked:false,remote:null});attempted.current=null;setMessage('Дополнительные поля сохранены.');
   }else{setEditor(current=>current?{...current,remote:value}:null);setMessage('Сравните сохранённые данные с вашими правками.');}
  }),
  choose:(local:boolean)=>{if(locked.current||!editor?.remote)return;
   setEditor({...editor,saved:editor.remote,fields:local?editor.fields:listingExtraFields(editor.remote.form),blocked:false,remote:null});
   attempted.current=null;setMessage('Версия сверена. Проверьте поля перед сохранением.');},
 };
}
