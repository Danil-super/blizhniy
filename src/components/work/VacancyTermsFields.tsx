"use client";
import {WorkAmountField} from './WorkAmountField';
const schedules=['5/2','2/2','Сменный график','Гибкий график','По договорённости'];
const formats=['На месте','Удалённо','Гибридный','Разъездная работа'];
const field='min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-normal text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
/** Retain an older custom value on reopen rather than silently replacing its meaning. */
function options(values:string[],current:string){return current&&!values.includes(current)?[current,...values]:values;}
export function VacancyTermsFields({salary,schedule='',workFormat=''}:{salary?:string|null;schedule?:string|null;workFormat?:string|null}){
 return <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3" data-vacancy-terms>
  <WorkAmountField kind="vacancy" value={salary}/>
  <label className="grid min-w-0 gap-2 text-sm font-bold text-slate-700">График
   <select name="schedule" defaultValue={schedule??''} className={field}><option value="">Выберите график</option>{options(schedules,schedule??'').map(value=><option key={value} value={value}>{value}</option>)}</select>
  </label>
  <label className="grid min-w-0 gap-2 text-sm font-bold text-slate-700">Формат работы
   <select name="workFormat" defaultValue={workFormat??''} className={field}><option value="">Выберите формат</option>{options(formats,workFormat??'').map(value=><option key={value} value={value}>{value}</option>)}</select>
  </label>
 </div>;
}
