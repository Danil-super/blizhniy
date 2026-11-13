'use client';
import {useId,useState} from 'react';

export function AdMarquee({messages}:{messages:string[]}){
 const [paused,setPaused]=useState(false),trackId=useId();
 if(!messages.length)return null;
 const label=paused?'Включить движение рекламной строки':'Приостановить рекламную строку';
 return <section className="marquee page-container py-1 sm:py-3" aria-label="Рекламная строка" data-paused={paused}>
  <button type="button" data-marquee-control aria-label={label} title={label} aria-controls={trackId} aria-describedby={trackId} onClick={()=>setPaused(value=>!value)}
   className="block min-h-12 w-full overflow-hidden rounded-xl border border-blue-100 bg-white px-2 py-4 text-left shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:rounded-2xl sm:px-4">
   <span className="block min-w-0 overflow-hidden" aria-live="off">
    <span id={trackId} className="marquee-track flex w-max items-center gap-8 text-xs font-semibold text-slate-700 sm:text-sm">
     {messages.map((message,index)=><span key={`${index}-${message}`} className="marquee-item flex items-center gap-8 whitespace-nowrap">
      <span className="min-w-0 break-words">{message}</span><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300"/>
     </span>)}
    </span>
   </span>
  </button>
 </section>;
}
