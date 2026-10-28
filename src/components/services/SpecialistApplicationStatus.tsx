import Link from 'next/link';
import type {ServicePublicationForm} from '@/lib/service-publication-contract';
import {checkSpecialistApplicationForm} from '@/lib/specialist-application-profile';
/** Filled fields are not paid catalogue status; the target's server checks readiness again. */
export function SpecialistApplicationStatus({form}:{form:ServicePublicationForm}){
 const issues=checkSpecialistApplicationForm(form),ready=issues.length===0;
 return <section aria-label="Готовность анкеты к откликам" className={`mt-4 rounded-xl border p-4 ${ready?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50'}`}>
  <h3 className="font-bold text-slate-950">{ready?'Анкета заполнена':'Дополните анкету'}</h3>
  <p className="mt-2 text-sm text-slate-800">{ready?'Сохранённую анкету можно использовать для откликов. Модерация и оплата анкеты для этого не нужны.':'Черновик сохранён. Заполните обязательные поля, чтобы использовать анкету для откликов.'}</p>
  {issues.length>0&&<ul className="mt-2 list-inside list-disc text-sm text-amber-900">{issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
  {ready&&<div className="mt-3 flex flex-wrap gap-2"><Link href="/rabota/vakansii" className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold text-blue-800">Найти вакансию</Link>
   <Link href="/rabota/zakazy" className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold text-blue-800">Найти заказ</Link></div>}
 </section>;
}
