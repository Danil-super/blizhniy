import Link from "next/link";
import { CalendarDays, CheckCircle2, ImagePlus, MapPin, PlaySquare, Store, Video } from "lucide-react";
import { LocationMap } from "@/components/LocationMap";
import { fairApplications, fairCategories, tariffs } from "@/lib/data";

function nextFairDate(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();

  function lastSunday(dateYear: number, dateMonth: number) {
    const date = new Date(dateYear, dateMonth + 1, 0);
    date.setDate(date.getDate() - date.getDay());
    return date;
  }

  const thisMonth = lastSunday(year, month);
  return today <= thisMonth ? thisMonth : lastSunday(year, month + 1);
}

function formatFairDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function FairHomePage() {
  const fairDate = nextFairDate();
  const fairTariff = tariffs.find((tariff) => tariff.action === "fair_participation");
  const publishedApplications = fairApplications.filter((application) => application.status === "published");

  return (
    <main className="page-container py-8 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/blizhniy" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Ярмарка мастеров</span>
      </nav>

      <section className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-start">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Последнее воскресенье месяца</p>
          <h1 className="mt-3 text-5xl font-black leading-tight text-[#060b27] sm:text-6xl">Ярмарка мастеров</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Раздел для мастеров и небольших мастерских Краснодарского края: участники заранее оставляют заявку, оплачивают участие и показывают свои
            товары на странице ярмарки.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/yarmarka-masterov/zayavka" className="inline-flex h-12 items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e]">
              Подать заявку на участие
            </Link>
            <Link href="/cabinet/fair-applications" className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1]">
              Мои заявки
            </Link>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <CalendarDays className="h-10 w-10 text-[#0875d1]" />
          <h2 className="mt-4 text-2xl font-black text-[#060b27]">Ближайшая ярмарка</h2>
          <p className="mt-2 text-3xl font-black text-[#0aa337]">{formatFairDate(fairDate)}</p>
          <p className="mt-3 leading-7 text-slate-600">Участие платное. Временный тариф: {fairTariff ? `${fairTariff.price} ₽` : "1000 ₽"}.</p>
        </aside>
      </section>

      <section className="mt-10">
        <h2 className="text-3xl font-black text-[#060b27]">Категории ярмарки</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {fairCategories.map((category) => (
            <div key={category} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <Store className="h-7 w-7 text-[#0875d1]" />
              <p className="mt-4 font-black text-[#060b27]">{category}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-[#0875d1]">
              <Video className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-2xl font-black text-[#060b27]">Онлайн-трансляция</h2>
              <p className="mt-2 leading-7 text-slate-600">Онлайн-трансляция будет доступна в день ярмарки.</p>
            </div>
          </div>
        </div>
        <LocationMap
          location={{
            city: "Краснодар",
            district: "Центральный округ",
            address: "ул. Красная, 5",
            lat: 45.035,
            lng: 38.976,
            showExactAddress: true,
          }}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-3xl font-black text-[#060b27]">Участники</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {publishedApplications.map((application) => (
            <article key={application.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide text-[#0875d1]">{application.category}</p>
                  <h3 className="mt-2 text-2xl font-black text-[#060b27]">{application.participantName}</h3>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-[#0a8f32]">опубликовано</span>
              </div>
              <p className="mt-4 leading-7 text-slate-600">{application.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {application.productPhotos.map((photo) => (
                  <span key={photo} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                    <ImagePlus className="h-4 w-4" />
                    {photo}
                  </span>
                ))}
                {application.videoUrl ? (
                  <a href={application.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-[#0875d1]">
                    <PlaySquare className="h-4 w-4" />
                    Видео
                  </a>
                ) : null}
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <MapPin className="h-4 w-4" />
                {[application.city, application.showExactAddress ? application.address : application.district].filter(Boolean).join(", ")}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export function FairApplicationFormPage() {
  const fairTariff = tariffs.find((tariff) => tariff.action === "fair_participation");

  return (
    <main className="page-container py-8 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/yarmarka-masterov" className="hover:text-[#0875d1]">
          Ярмарка мастеров
        </Link>
        <span className="mx-2">/</span>
        <span>Заявка</span>
      </nav>
      <section className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Заявка на участие</p>
          <h1 className="mt-3 text-4xl font-black text-[#060b27]">Ярмарка мастеров</h1>
          <form className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-slate-600">
              Имя или название участника
              <input className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" placeholder="Мастерская Кубань Дуб" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Город
                <input className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" placeholder="Краснодар" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Категория ярмарки
                <select className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]">
                  {fairCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-2 text-sm font-bold text-slate-600">
              Описание работ или товаров
              <textarea className="min-h-28 rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#0875d1]" placeholder="Что вы покажете на ярмарке" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Фото товаров
                <input className="h-12 rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#0875d1]" type="file" multiple accept="image/*" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Ссылка на видео
                <input className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" placeholder="https://..." />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Телефон
                <input className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" placeholder="+7..." />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-600">
                Email
                <input className="h-12 rounded-lg border border-slate-300 px-4 font-normal outline-none focus:border-[#0875d1]" placeholder="you@example.ru" type="email" />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-bold text-slate-600">
              Комментарий
              <textarea className="min-h-24 rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#0875d1]" placeholder="Пожелания к месту, столу, электричеству" />
            </label>
            <label className="flex gap-3 text-sm leading-6 text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#0875d1]" />
              <span>Согласен с правилами ярмарки и понимаю, что участие оплачивается после подачи заявки.</span>
            </label>
            <Link href="/blizhniy/oplata/fair-participation" className="inline-flex h-12 w-fit items-center justify-center rounded-xl bg-[#0aa337] px-7 font-bold text-white transition hover:bg-[#078a2e]">
              Создать заявку и перейти к оплате
            </Link>
          </form>
        </div>
        <aside className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <CheckCircle2 className="h-10 w-10 text-[#0aa337]" />
          <h2 className="mt-4 text-2xl font-black text-[#060b27]">После подачи заявки</h2>
          <p className="mt-3 leading-7 text-slate-600">
            После оплаты заявка получает статус «Заявка опубликована». Видео можно добавить ссылкой на внешний сервис.
          </p>
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-700">Тариф: {fairTariff ? `${fairTariff.price} ₽` : "1000 ₽"}</p>
        </aside>
      </section>
    </main>
  );
}
