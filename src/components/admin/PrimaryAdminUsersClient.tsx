"use client";
import {useEffect,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {adminUserDirectory,AdminUserDirectoryClientError} from '@/lib/client-admin-user-directory';
import {notifyAccountSessionChange} from '@/lib/local-account';
import type {AdminUserQuery,AdminUserPage} from '@/lib/admin-user-directory-contract';

const button='min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';

function DirectoryPage({input,onNext,onFirst,onRefresh}:{input:AdminUserQuery;onNext:(cursor:AdminUserPage['nextCursor'])=>void;onFirst:()=>void;onRefresh:()=>void}) {
  const [page,setPage]=useState<AdminUserPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setPage(null);setError('');setLoading(true);
    adminUserDirectory.list(input,{signal:controller.signal}).then(value=>{if(active)setPage(value);}).catch(error=>{
      if(!active)return;
      setError(error instanceof AdminUserDirectoryClientError?error.message:'Не удалось загрузить пользователей. Повторите запрос.');
      if(error instanceof AdminUserDirectoryClientError&&['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(error.code))notifyAccountSessionChange(false);
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;controller.abort();};
  },[input]);
  return <section aria-label="Список пользователей" aria-busy={loading} className="mt-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{page?`Показано: ${page.items.length}${page.nextCursor?' · есть ещё':''}`:'Загрузка списка'}</p>
      <button type="button" className={button} disabled={loading} onClick={onRefresh}>Обновить список</button>
    </div>
    {loading&&<p role="status" className="py-6 text-sm text-slate-600">Загружаем пользователей…</p>}
    {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{error}</p><button type="button" className={`${button} mt-3`} onClick={onRefresh}>Повторить загрузку</button>
    </div>}
    {page?.items.length===0&&<p role="status" className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Пользователи не найдены. Измените условия поиска.</p>}
    {page&&<ul className="space-y-3">{page.items.map(user=>{
      const status=user.isBlocked?'Заблокирован':user.emailVerified?'Активен':'Ожидает email';
      const color=user.isBlocked?'border-red-200 bg-red-50 text-red-800':user.emailVerified?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-amber-200 bg-amber-50 text-amber-900';
      return <li key={user.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="break-words font-bold text-slate-950">{user.name||'Имя не указано'}</h2>
            <p className="mt-1 break-all text-xs text-slate-500">ID: {user.id}</p></div>
          <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${color}`}>{status}</span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{user.role==='admin'?'Администратор':'Пользователь'}</span></div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="min-w-0"><dt className="text-xs text-slate-500">Email</dt><dd className="mt-1 break-all text-slate-900">{user.email}</dd></div>
          <div><dt className="text-xs text-slate-500">Телефон в профиле</dt><dd className="mt-1 break-words text-slate-900">{user.phone||'Не указан'}</dd></div>
          <div><dt className="text-xs text-slate-500">Дата регистрации</dt><dd className="mt-1 text-slate-900"><time dateTime={user.createdAt}>{new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeZone:'Europe/Moscow'}).format(new Date(user.createdAt))}</time></dd></div>
        </dl>
      </li>;
    })}</ul>}
    <nav aria-label="Страницы пользователей" className="mt-4 flex flex-wrap gap-3">
      {input.cursor&&<button type="button" className={button} disabled={loading} onClick={onFirst}>В начало списка</button>}
      {page?.nextCursor&&<button type="button" className={button} onClick={()=>onNext(page.nextCursor)}>Следующие 25</button>}
    </nav>
  </section>;
}
function UserDirectory({actor}:{actor:string}) {
  const [query,setQuery]=useState(''),[role,setRole]=useState<AdminUserQuery['role']>('all'),[status,setStatus]=useState<AdminUserQuery['status']>('all');
  const [input,setInput]=useState<AdminUserQuery>({expectedAdminId:actor,query:'',role:'all',status:'all',cursor:null}),[revision,setRevision]=useState(0);
  return <div>
    <p className="text-sm leading-6 text-slate-600">Аккаунты сайта. Статус «Активен» означает подтверждённый email и отсутствие блокировки.</p>
    <form className="mt-4 grid items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={event=>{event.preventDefault();setInput({expectedAdminId:actor,query:query.trim(),role,status,cursor:null});setRevision(value=>value+1);}}>
      <label className="text-xs font-bold text-slate-600">Поиск<input type="search" maxLength={120} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Имя, email, телефон или ID" className={field}/></label>
      <label className="text-xs font-bold text-slate-600">Роль<select value={role} onChange={event=>setRole(event.target.value as AdminUserQuery['role'])} className={field}>
        <option value="all">Все роли</option><option value="user">Пользователь</option><option value="admin">Администратор</option></select></label>
      <label className="text-xs font-bold text-slate-600">Статус<select value={status} onChange={event=>setStatus(event.target.value as AdminUserQuery['status'])} className={field}>
        <option value="all">Все статусы</option><option value="active">Активен</option><option value="blocked">Заблокирован</option><option value="pending">Ожидает email</option></select></label>
      <button type="submit" className={button}>Найти</button>
    </form>
    <DirectoryPage key={JSON.stringify([input,revision])} input={input} onRefresh={()=>setRevision(value=>value+1)} onFirst={()=>setInput({...input,cursor:null})} onNext={cursor=>setInput({...input,cursor})}/>
    <p className="mt-4 text-xs text-slate-500">Изменение доступа пока недоступно.</p>
  </div>;
}
export function PrimaryAdminUsersClient() {
  const auth=usePrimaryAccountAuth();
  if(auth?.state!=='admin'||!auth.userId)return <p role="status" className="text-sm text-slate-600">{auth?.state==='loading'?'Проверяем права администратора…':'Доступ администратора не подтверждён.'}</p>;
  return <UserDirectory key={auth.userId} actor={auth.userId}/>;
}
