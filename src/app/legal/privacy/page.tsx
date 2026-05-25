import { SiteHeader } from "@/components/SiteHeader";

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Документы</p>
          <h1 className="mt-3 text-4xl font-black text-[#060b27]">Политика конфиденциальности</h1>
          <div className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 leading-7 text-slate-700 shadow-card">
            <p>Политика конфиденциальности платформы «БЛИЖНИЙ» описывает обработку данных пользователей сервиса.</p>
            <p>Сервис может обрабатывать email, телефон, имя, город, данные публикаций и историю платежных действий.</p>
            <p>Данные используются для авторизации, работы кабинета, публикаций, откликов, уведомлений и администрирования площадки.</p>
            <p>Перед публичным запуском документ нужно согласовать с юристом и привести к фактическим процессам обработки данных.</p>
          </div>
        </section>
      </main>
    </>
  );
}
