"use client";
import Link from 'next/link';
export default function ListingFormError({reset}:{reset:()=>void}){
 return <main className="page-container py-10"><section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 sm:p-8" aria-labelledby="listing-form-error-title">
  <h1 id="listing-form-error-title" className="text-2xl font-bold text-[#060b27]">Не удалось открыть форму объявления</h1>
  <p className="mt-3 leading-7 text-slate-600" role="alert">Сохранённые данные не изменились. Проверьте соединение и повторите загрузку.</p>
  <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={reset} className="min-h-11 rounded-lg bg-[#0875d1] px-4 py-2 font-bold text-white">Повторить загрузку</button>
   <Link href="/cabinet/obyavleniya" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 font-semibold text-[#0875d1]">Мои объявления</Link></div>
 </section></main>;
}
