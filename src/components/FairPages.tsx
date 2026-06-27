import Link from "next/link";
import Image from "next/image";
import { CalendarDays, CheckCircle2, ImagePlus, MapPin, PlaySquare, Store, Video } from "lucide-react";
import { FairApplicationForm } from "@/components/FairApplicationForm";
import { LocationMap } from "@/components/LocationMap";
import { fairCategories } from "@/lib/data";
import { listStoredFairApplications } from "@/lib/fair-application-store";
import { publicMediaUrl } from "@/lib/storage-upload";
import { getPublicTariffs } from "@/lib/tariff-store";

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

function fairPhotoUrl(photo: string) {
  if (photo.startsWith("http://") || photo.startsWith("https://") || photo.startsWith("blob:")) {
    return photo;
  }

  return photo.includes("/") ? publicMediaUrl(photo) : "";
}

export async function FairHomePage() {
  const fairDate = nextFairDate();
  const tariffs = await getPublicTariffs();
  const fairTariff = tariffs.find((tariff) => tariff.action === "fair_participation");
  const publishedApplications = await listStoredFairApplications("published");

  return (
    <main className="page-container py-6 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/" className="hover:text-[#0875d1]">
          Краснодар
        </Link>
        <span className="mx-2">/</span>
        <span>Ярмарка мастеров</span>
      </nav>

      <section className="grid gap-5 sm:gap-8 lg:grid-cols-[1fr_420px] lg:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">Последнее воскресенье месяца</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-[#060b27] sm:mt-3 sm:text-4xl">Ярмарка мастеров</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600 sm:mt-5 sm:text-lg sm:leading-8">
            Раздел для мастеров и небольших мастерских Краснодарского края: участники заранее оставляют заявку, оплачивают участие и показывают свои
            товары на странице ярмарки.
          </p>
          <div className="mt-5 grid gap-3 sm:mt-8 sm:flex sm:flex-wrap sm:gap-4">
            <Link href="/yarmarka-masterov/zayavka" className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0aa337] px-5 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-12 sm:px-7 sm:text-base">
              Подать заявку на участие
            </Link>
            <Link href="/cabinet/fair-applications" className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:text-[#0875d1] sm:h-12 sm:px-7 sm:text-base">
              Мои заявки
            </Link>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <CalendarDays className="h-8 w-8 text-[#0875d1] sm:h-10 sm:w-10" />
          <h2 className="mt-3 text-xl font-bold text-[#060b27] sm:mt-4">Ближайшая ярмарка</h2>
          <p className="mt-2 text-xl font-bold text-[#0aa337] sm:text-2xl">{formatFairDate(fairDate)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">Участие платное. Временный тариф: {fairTariff ? `${fairTariff.price} ₽` : "1000 ₽"}.</p>
        </aside>
      </section>

      <section className="mt-8 sm:mt-10">
        <h2 className="text-xl font-bold text-[#060b27] sm:text-2xl">Категории ярмарки</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
          {fairCategories.map((category) => (
            <div key={category} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
              <Store className="h-5 w-5 text-[#0875d1] sm:h-7 sm:w-7" />
              <p className="mt-3 text-sm font-bold text-[#060b27] [overflow-wrap:anywhere] sm:mt-4 sm:text-base">{category}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:mt-10 sm:gap-6 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <div className="flex items-start gap-3 sm:gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0875d1] sm:h-12 sm:w-12">
              <Video className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-[#060b27]">Онлайн-трансляция</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">Онлайн-трансляция будет доступна в день ярмарки.</p>
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

      <section className="mt-8 sm:mt-10">
        <h2 className="text-xl font-bold text-[#060b27] sm:text-2xl">Участники</h2>
        <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-2">
          {publishedApplications.map((application) => (
            <article key={application.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
              <div className="grid gap-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#0875d1] sm:text-sm">{application.category}</p>
                  <h3 className="mt-1 text-xl font-bold text-[#060b27] sm:mt-2">{application.participantName}</h3>
                </div>
                <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-[#0a8f32]">опубликовано</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:mt-4 sm:text-base sm:leading-7">{application.description}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {application.productPhotos.map((photo) => {
                  const imageUrl = fairPhotoUrl(photo);

                  return imageUrl ? (
                    <a
                      key={photo}
                      href={imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative block aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200"
                    >
                      <Image
                        src={imageUrl}
                        alt={application.participantName}
                        fill
                        sizes="(min-width: 1024px) 16rem, (min-width: 640px) 33vw, 50vw"
                        className="object-cover"
                        unoptimized
                      />
                    </a>
                  ) : (
                    <span key={photo} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                      <ImagePlus className="h-4 w-4" />
                      {photo}
                    </span>
                  );
                })}
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

export async function FairApplicationFormPage({ adminMode = false }: { adminMode?: boolean }) {
  const tariffs = await getPublicTariffs();
  const fairTariff = tariffs.find((tariff) => tariff.action === "fair_participation");

  return (
    <main className="page-container py-6 sm:py-10">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Хлебные крошки">
        <Link href="/yarmarka-masterov" className="hover:text-[#0875d1]">
          Ярмарка мастеров
        </Link>
        <span className="mx-2">/</span>
        <span>Заявка</span>
      </nav>
      <section className="mb-16 grid gap-5 sm:mb-20 sm:gap-8 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">Заявка на участие</p>
          <h1 className="mt-2 text-2xl font-bold text-[#060b27] sm:mt-3 sm:text-3xl">Ярмарка мастеров</h1>
          <FairApplicationForm adminMode={adminMode} />
        </div>
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <CheckCircle2 className="h-8 w-8 text-[#0aa337] sm:h-10 sm:w-10" />
          <h2 className="mt-3 text-xl font-bold text-[#060b27] sm:mt-4">После подачи заявки</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
            После оплаты заявка получает статус «Заявка опубликована». Видео можно добавить ссылкой на внешний сервис.
          </p>
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm font-bold text-slate-700">Тариф: {fairTariff ? `${fairTariff.price} ₽` : "1000 ₽"}</p>
        </aside>
      </section>
    </main>
  );
}
