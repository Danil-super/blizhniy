"use client";
import {useEffect,useRef,useState} from 'react';
import {validateCabinetControl,validateFilledCabinetFields} from '@/lib/cabinet-form-validation';
/** Local native messages plus an accessible persistent form summary. No value rewriting. */
export function CabinetFormValidation(){
 const anchor=useRef<HTMLSpanElement>(null),[issue,setIssue]=useState('');
 useEffect(()=>{
  const form=anchor.current?.closest('form');if(!form)return;
  const validate=(event:Event)=>{
   const field=event.target;
   if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement){
    const message=validateCabinetControl(field);setIssue(message);
   }
  };
  const invalid=(event:Event)=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement)setIssue(field.validationMessage);};
  const save=(event:Event)=>{
   const target=event.target;
   if(event.type==='click'&&(!(target instanceof Element)||!target.closest('button[data-cabinet-save],button[data-primary-control="save"],button[data-primary-control="submit"]')))return;
   if(!validateFilledCabinetFields(form)){event.preventDefault();event.stopImmediatePropagation();}
  };
  form.addEventListener('input',validate);form.addEventListener('change',validate);form.addEventListener('invalid',invalid,true);
  form.addEventListener('click',save,true);form.addEventListener('submit',save,true);
  return()=>{form.removeEventListener('input',validate);form.removeEventListener('change',validate);form.removeEventListener('invalid',invalid,true);form.removeEventListener('click',save,true);form.removeEventListener('submit',save,true);};
 },[]);
 return <><span ref={anchor} hidden/>{issue&&<p role="alert" className="break-words text-sm font-semibold text-rose-800">{issue}</p>}</>;
}
