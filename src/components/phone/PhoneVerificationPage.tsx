'use client';
import Link from 'next/link';import {useEffect,useState,useRef} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {phoneVerification,type PhoneReview} from '@/lib/client-phone-verification';
export function PhoneVerificationPage(){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null;
 return <PhoneReviewScope key={owner??auth?.state??'loading'} owner={owner} signedOut={auth?.state==='signed-out'}/>;
}
function PhoneReviewScope({owner,signedOut}:{owner:string|null;signedOut:boolean}){
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [review,setReview]=useState<PhoneReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!owner)return;let active=true;setReview(null);setError('');setAccepted(false);const params=new URLSearchParams(location.search),id=params.get('attempt');
  if(params.has('error')||!id){setError(params.get('error')==='cancelled'?'Подтверждение отменено. Номер не изменён.':'Попытка подтверждения недействительна или истекла. Начните ещё раз в настройках.');return;}
  void phoneVerification.review(owner,id).then(value=>{if(active)setReview(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Не удалось загрузить подтверждение.');});return()=>{active=false;};
 },[owner,retry]);
 useEffect(()=>{if(!review?.confirmed)return;
  const message={type:'blizhniy-phone-confirmed',attemptId:review.id};window.opener?.postMessage(message,location.origin);
  if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('blizhniy-phone-verification');channel.postMessage(message);channel.close();}
 },[review?.confirmed,review?.id]);
 async function confirm(){if(!owner||!review)return;setBusy(true);setError('');try{await phoneVerification.confirm(owner,review,accepted);if(!mounted.current)return;setReview({...review,confirmed:true});
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Не удалось подтвердить номер.');}finally{if(mounted.current)setBusy(false);}}
 return <main className="flex min-h-[75vh] items-center justify-center bg-slate-50 px-4 py-8"><section className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
  <div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Ближний · Telegram</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Подтверждение телефона</h1></div>
  {!owner&&<p role="status" className="text-sm text-slate-700">{signedOut?'Войдите в исходный аккаунт сайта, затем начните подтверждение ещё раз.':'Проверяем вашу сессию…'}</p>}
  {owner&&review&&!review.confirmed&&<><p className="text-sm leading-6 text-slate-600">Telegram подтвердил номер:</p><p className="rounded-xl bg-sky-50 p-4 text-center text-2xl font-bold tracking-wide text-slate-950">{review.phone}</p>
   {review.replaceRequired?<div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm leading-6 text-amber-950">В профиле указан другой номер: <strong>{review.currentPhone}</strong>. Он будет заменён только после вашего согласия.</p><label className="flex items-start gap-3 text-sm font-semibold"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} className="mt-1 h-4 w-4"/>Заменить номер в профиле на {review.phone}</label></div>:<p className="text-sm leading-6 text-slate-600">Сохраним этот номер в вашем аккаунте. Публичные контакты объявлений остаются отдельной настройкой.</p>}
   <button type="button" disabled={busy||review.replaceRequired&&!accepted} onClick={()=>void confirm()} className="min-h-11 w-full rounded-lg bg-sky-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?'Сохраняем…':'Подтвердить этот номер'}</button></>}
  {owner&&review?.confirmed&&<><p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Телефон подтверждён через Telegram</p><p className="text-sm leading-6 text-slate-600">Вернитесь в исходное окно — введённые данные сохранены там.</p><button type="button" onClick={()=>window.close()} className="min-h-11 w-full rounded-lg bg-sky-700 px-4 py-3 font-semibold text-white">Вернуться к работе</button><Link href={review.returnTo} className="block text-center text-sm font-semibold text-sky-700 underline">Открыть исходную страницу в этом окне</Link></>}
  {error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800">{error}</div>}
  {error&&owner&&<button type="button" onClick={()=>setRetry(v=>v+1)} className="text-sm font-semibold text-sky-700 underline">Обновить данные попытки</button>}
  <Link href="/cabinet" className="block text-sm font-semibold text-slate-600 underline">Личный кабинет</Link>
 </section></main>;
}
