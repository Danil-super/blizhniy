"use client";
import Link from 'next/link';

export default function PageError(){
 return <main className="page-container py-10"><section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 sm:p-8" aria-labelledby="page-error-title">
  <h1 id="page-error-title" className="text-2xl font-bold text-[#060b27]">Не удалось загрузить страницу</h1>
  <p className="mt-3 leading-7 text-slate-600" role="alert">Попробуйте ещё раз через несколько секунд.</p>
  {/* A boundary reset can replay the failed server payload; retry needs a fresh document request. */}
  <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={()=>window.location.reload()} className="min-h-11 rounded-lg bg-[#0875d1] px-4 py-2 font-bold text-white">Повторить загрузку</button>
   <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 font-semibold text-[#0875d1]">На главную</Link></div>
 </section></main>;
}
