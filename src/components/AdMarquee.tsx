'use client';
import {useId,useState} from 'react';
import {Pause,Play} from 'lucide-react';

export function AdMarquee({messages}:{messages:string[]}){
 const [paused,setPaused]=useState(false),trackId=useId();
 if(!messages.length)return null;
 const label=paused?'Включить движение рекламной строки':'Приостановить рекламную строку';
 return <section className="marquee page-container py-1 sm:py-3" aria-label="Рекламная строка" data-paused={paused}>
  <div className="flex min-h-12 items-start gap-1 overflow-hidden rounded-xl border border-blue-100 bg-white p-1 shadow-sm sm:items-center sm:rounded-2xl sm:p-2">
   <div className="min-w-0 flex-1 overflow-hidden py-3" aria-live="off">
    <div id={trackId} className="marquee-track flex w-max items-center gap-8 text-xs font-semibold text-slate-700 sm:text-sm">
     {messages.map((message,index)=><span key={`${index}-${message}`} className="marquee-item flex items-center gap-8 whitespace-nowrap">
      <span className="min-w-0 break-words">{message}</span><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300"/>
     </span>)}
    </div>
   </div>
   <button type="button" data-marquee-control aria-label={label} title={label} aria-controls={trackId} onClick={()=>setPaused(value=>!value)}
    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
    {paused?<Play aria-hidden="true" className="h-4 w-4"/>:<Pause aria-hidden="true" className="h-4 w-4"/>}
   </button>
  </div>
 </section>;
}
