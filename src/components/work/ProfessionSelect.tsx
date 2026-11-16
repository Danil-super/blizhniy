"use client";
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Check} from 'lucide-react';
import {professions} from '@/lib/data';
import type {PublicProfession} from '@/lib/profession-catalog-contract';

type Option={id?:string;slug:string;name:string;parent?:string;active:boolean};
type Props={defaultValue?:string;defaultId?:string|null;required?:boolean;catalog?:PublicProfession[];catalogState?:'loading'|'ready'|'error'};
/** The primary form supplies live options; the bare legacy selector retains its old vocabulary. */
export function ProfessionSelect({defaultValue='',defaultId,required=false,catalog,catalogState='ready'}:Props){
 const primary=catalog!==undefined;
 const options=useMemo<Option[]>(()=>[...(catalog??professions)].filter(item=>item.active).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.slug.localeCompare(b.slug)),[catalog]);
 const [value,setValue]=useState(defaultValue),[selection,setSelection]=useState<string|null>(defaultId??null),[edited,setEdited]=useState(false);
 const [filter,setFilter]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),id=useId(),listId=`${id}-options`,errorId=`${id}-error`,statusId=`${id}-status`;
 const matches=useMemo(()=>options.filter(item=>(item.name+' '+(item.parent??'')).toLocaleLowerCase('ru').includes(filter.trim().toLocaleLowerCase('ru'))),[filter,options]);
 const initialMatches=!edited&&!selection?options.filter(item=>item.name===defaultValue):[];
 const selected=primary?(selection?options.find(item=>item.id===selection):initialMatches.length===1?initialMatches[0]:undefined):options.find(item=>item.name===value);
 const selectedId=primary?(selection??selected?.id??null):null;
 const shown=selected?.name??value;
 const referenceState=catalogState!=='ready'?catalogState:selectedId&&!selected?(selectedId===defaultId?'inactive':'unavailable'):selected?'selected':shown?'unknown':'empty';
 const referenceIssue=referenceState==='loading'?'Дождитесь загрузки профессий.':referenceState==='error'?'Загрузите список профессий ещё раз.':referenceState==='inactive'?'Профессия отключена. Выберите действующую перед размещением.':referenceState==='unavailable'?'Выбранная профессия больше недоступна. Выберите действующую.':referenceState==='unknown'?'Выберите профессию из списка.':'';
 const popupOpen=open&&catalogState==='ready';
 const visibleError=error?(referenceIssue||(selected?'':'Выберите профессию.')):'';
 useEffect(()=>{input.current?.setCustomValidity(referenceIssue);if(selected)setValue(selected.name);},[referenceIssue,selected]);
 useEffect(()=>{function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[]);
 useEffect(()=>{if(popupOpen&&active>=0)document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});},[popupOpen,active,listId]);
 function choose(item:Option){
  if(catalogState!=='ready'||input.current?.matches(':disabled'))return;
  setValue(item.name);setSelection(item.id??null);setEdited(true);setFilter('');setOpen(false);setActive(-1);setError('');
  if(input.current){
   input.current.value=item.name;input.current.dataset.referenceState='selected';input.current.setCustomValidity('');
   input.current.dispatchEvent(new Event('input',{bubbles:true}));
  }
 }
 function reveal(){if(catalogState!=='ready')return;setFilter('');setActive(Math.max(0,options.findIndex(item=>item===selected)));setOpen(true);}
 return <div ref={root} className="relative min-w-0">
  <label htmlFor={id} className="mb-2 block text-sm font-bold text-slate-700">Профессия / специализация</label>
  {primary&&<input type="hidden" name="professionId" value={selectedId??''}/>}
  <div className="relative">
   <input ref={input} id={id} name="profession" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls={listId}
    aria-expanded={popupOpen} aria-activedescendant={popupOpen&&active>=0&&active<matches.length?`${listId}-${active}`:undefined}
    aria-invalid={visibleError||referenceState==='inactive'?true:undefined} aria-describedby={visibleError?errorId:referenceState==='inactive'?statusId:undefined} aria-busy={catalogState==='loading'}
    data-reference={primary?'profession':undefined} data-reference-state={primary?referenceState:undefined}
    required={required} value={shown} maxLength={200} placeholder="Выберите или найдите профессию" autoComplete="off"
    className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-11 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
    onFocus={reveal} onChange={event=>{
     setValue(event.target.value);setSelection(null);setEdited(true);setFilter(event.target.value);setActive(0);setOpen(catalogState==='ready');setError('');
     if(primary){event.target.dataset.referenceState=event.target.value?'unknown':'empty';event.target.setCustomValidity(event.target.value?'Выберите профессию из списка.':'');}
    }}
    onBlur={event=>{if(!root.current?.contains(event.relatedTarget as Node)){setOpen(false);if(shown&&!selected)setError(referenceIssue);}}}
    onInvalid={()=>{setError(referenceIssue||'Выберите профессию.');}}
    onKeyDown={event=>{
     if(catalogState!=='ready'){if(event.key==='Enter')event.preventDefault();if(['Enter','Escape','Tab'].includes(event.key))setOpen(false);return;}
     if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!open){reveal();return;}const direction=event.key==='ArrowDown'?1:-1;
      setActive(index=>matches.length?(index+direction+matches.length)%matches.length:-1);
     }else if(event.key==='Enter'&&open){event.preventDefault();if(matches[active])choose(matches[active]);}
     else if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);}
     else if(event.key==='Tab')setOpen(false);
    }}/>
   <button type="button" aria-label="Открыть список профессий" aria-expanded={popupOpen} aria-controls={listId} tabIndex={-1}
    disabled={catalogState!=='ready'} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 hover:text-blue-700 disabled:opacity-40"
    onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)setOpen(false);else{input.current?.focus();reveal();}}}>
    <ChevronDown aria-hidden="true" className={`h-4 w-4 transition ${popupOpen?'rotate-180':''}`}/>
   </button>
  </div>
  {popupOpen&&<ul id={listId} role="listbox" aria-label="Профессии" className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
   {matches.map((item,index)=><li key={item.slug} id={`${listId}-${index}`} role="option" aria-selected={selected?.slug===item.slug}
    className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${active===index?'bg-blue-50 text-blue-800':'text-slate-800 hover:bg-slate-50'}`}
    onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(item)}>
    <span className="min-w-0 break-words">{item.name}{primary&&<span className="block text-xs text-slate-600">{item.parent} · {item.slug}</span>}</span>
    {selected?.slug===item.slug&&<Check aria-hidden="true" className="h-4 w-4 shrink-0"/>}
   </li>)}
   {!matches.length&&<li role="presentation" className="p-3 text-sm text-slate-500">Ничего не найдено. Измените запрос.</li>}
  </ul>}
  {referenceState==='inactive'&&<p id={statusId} className="mt-1 text-sm text-amber-800">Профессия отключена. Черновик сохранён с прежним выбором; перед размещением выберите действующую.</p>}
  {visibleError&&<p id={errorId} className="mt-1 text-sm text-rose-700" role="alert">{visibleError}</p>}
 </div>;
}
