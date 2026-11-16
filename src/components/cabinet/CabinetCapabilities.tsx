import {Bell,CheckCircle2,LockKeyhole,UserRound} from "lucide-react";

export function CabinetCapabilities() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <UserRound className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-bold text-[#060b27]">Профиль</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Имя, телефон, email и город хранятся в настройках.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <LockKeyhole className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-bold text-[#060b27]">Безопасность</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Пароль меняется только через защищенную ссылку из письма.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <Bell className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-bold text-[#060b27]">Уведомления</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Можно включить или выключить события по броням, оплатам и сообщениям.</p>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <CheckCircle2 className="h-5 w-5 text-[#0875d1]" />
        <h3 className="mt-3 font-bold text-[#060b27]">Публикации</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">Новые пользователи начинают с нулевых счетчиков и понятных действий.</p>
      </article>
    </section>
  );
}
