import { SiteHeader } from "@/components/SiteHeader";

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Документы</p>
          <h1 className="mt-3 text-4xl font-black text-[#060b27]">Пользовательское соглашение</h1>
          <div className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 leading-7 text-slate-700 shadow-card">
            <p>Это заготовка пользовательского соглашения для MVP платформы «БЛИЖНИЙ».</p>
            <p>Пользователь обязуется размещать достоверную информацию, не публиковать запрещенные материалы и соблюдать правила площадки.</p>
            <p>Администрация может модерировать объявления, вакансии, анкеты специалистов и ограничивать доступ при нарушениях.</p>
            <p>Перед запуском на проде текст нужно заменить юридически проверенной редакцией.</p>
          </div>
        </section>
      </main>
    </>
  );
}
