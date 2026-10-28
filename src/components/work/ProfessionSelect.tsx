"use client";
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ChevronDown,Check} from 'lucide-react';
import {professions} from '@/lib/data';

/** Editable, keyboard-accessible combobox; only catalogue names pass native validity. */
export function ProfessionSelect({defaultValue='',required=false}:{defaultValue?:string;required?:boolean}){
 const options=useMemo(()=>professions.filter(item=>item.active).sort((a,b)=>a.name.localeCompare(b.name,'ru')),[]);
 const [value,setValue]=useState(defaultValue),[filter,setFilter]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),id=useId(),listId=`${id}-options`,errorId=`${id}-error`;
 const matches=useMemo(()=>options.filter(item=>item.name.toLocaleLowerCase('ru').includes(filter.trim().toLocaleLowerCase('ru'))),[filter,options]);
 const selected=options.find(item=>item.name===value);
 useEffect(()=>{input.current?.setCustomValidity(value.trim()&&!selected?'Выберите профессию из списка.':'');},[value,selected]);
 useEffect(()=>{function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[]);
 useEffect(()=>{if(open&&active>=0)document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});},[open,active,listId]);
 function choose(name:string){
  if(input.current?.matches(':disabled'))return;
  setValue(name);setFilter('');setOpen(false);setActive(-1);setError('');
  // Notify the containing form's unsaved-change guard, including mouse-only selection.
  input.current?.dispatchEvent(new Event('input',{bubbles:true}));
 }
 function reveal(){setFilter('');setActive(Math.max(0,options.findIndex(item=>item.name===value)));setOpen(true);}
 return <div ref={root} className="relative min-w-0">
  <label htmlFor={id} className="mb-2 block text-sm font-bold text-slate-700">Профессия / специализация</label>
  <div className="relative">
   <input ref={input} id={id} name="profession" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls={listId}
    aria-expanded={open} aria-activedescendant={open&&active>=0&&active<matches.length?`${listId}-${active}`:undefined}
    aria-invalid={error?true:undefined} aria-describedby={error?errorId:undefined} required={required} value={value} maxLength={160}
    placeholder="Выберите или найдите профессию" autoComplete="off"
    className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-11 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
    onFocus={reveal} onChange={event=>{setValue(event.target.value);setFilter(event.target.value);setActive(0);setOpen(true);setError('');}}
    onBlur={event=>{if(!root.current?.contains(event.relatedTarget as Node)){setOpen(false);if(value&&!selected)setError('Выберите профессию из списка.');}}}
    onInvalid={()=>{setError(value?'Выберите профессию из списка.':'Выберите профессию.');}}
    onKeyDown={event=>{
     if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!open){reveal();return;}const direction=event.key==='ArrowDown'?1:-1;
      setActive(index=>matches.length?(index+direction+matches.length)%matches.length:-1);
     }else if(event.key==='Enter'&&open){event.preventDefault();if(matches[active])choose(matches[active].name);}
     else if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);}
     else if(event.key==='Tab')setOpen(false);
    }}/>
   <button type="button" aria-label="Открыть список профессий" aria-expanded={open} aria-controls={listId} tabIndex={-1}
    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 hover:text-blue-700"
    onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)setOpen(false);else{input.current?.focus();reveal();}}}>
    <ChevronDown aria-hidden="true" className={`h-4 w-4 transition ${open?'rotate-180':''}`}/>
   </button>
  </div>
  {open&&<ul id={listId} role="listbox" aria-label="Профессии" className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
   {matches.map((item,index)=><li key={item.slug} id={`${listId}-${index}`} role="option" aria-selected={selected?.slug===item.slug}
    className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${active===index?'bg-blue-50 text-blue-800':'text-slate-800 hover:bg-slate-50'}`}
    onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(item.name)}>
    <span>{item.name}</span>{selected?.slug===item.slug&&<Check aria-hidden="true" className="h-4 w-4 shrink-0"/>}
   </li>)}
   {!matches.length&&<li role="presentation" className="p-3 text-sm text-slate-500">Ничего не найдено. Измените запрос.</li>}
  </ul>}
  {error&&<p id={errorId} className="mt-1 text-sm text-rose-700" role="alert">{error}</p>}
 </div>;
}
