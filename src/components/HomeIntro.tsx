import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BriefcaseBusiness, MapPinned, PlusCircle } from "lucide-react";

export function HomeIntro() {
  return (
    <section className="page-container pb-3 pt-3 sm:pb-4 sm:pt-4 lg:pb-5" aria-label="Главный экран">
      <div className="relative overflow-hidden rounded-[28px] border border-emerald-100/80 bg-[#fbfdf9] shadow-[0_22px_70px_rgba(15,23,42,0.08)] ring-1 ring-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] lg:block">
          <Image
            src="/images/categories/hero-city-crop.webp"
            alt=""
            aria-hidden="true"
            fill
            priority
            sizes="58vw"
            className="h-full w-full object-cover object-right brightness-[1.08] contrast-[1.13] saturate-[1.24]"
          />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 lg:hidden">
          <Image
            src="/images/categories/hero-city-crop.webp"
            alt=""
            aria-hidden="true"
            fill
            priority
            sizes="100vw"
            className="h-full w-full object-cover object-[62%_center] brightness-[1.08] contrast-[1.18] saturate-[1.22]"
          />
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[54%] hidden w-[10%] bg-gradient-to-r from-[#fbfdf9] via-[#fbfdf9]/82 to-transparent lg:block" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/86 to-white/12 sm:via-white/80 lg:hidden" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/22 via-transparent to-black/8 lg:hidden" />
        <div className="relative z-10 grid min-h-[410px] items-center gap-5 p-5 sm:min-h-[390px] sm:p-7 lg:min-h-[430px] lg:grid-cols-[minmax(0,0.84fr)_minmax(520px,1.16fr)] lg:p-10">
          <div className="max-w-[34rem] rounded-[24px] bg-white/72 p-0 lg:max-w-[39rem] lg:bg-white/0">
            <h1 className="max-w-[19rem] text-[1.85rem] font-black leading-[1.04] text-[#06102d] sm:max-w-none sm:text-[2.55rem] sm:leading-[1.04] lg:text-[3rem]">
              <span className="block sm:whitespace-nowrap">Все нужное рядом.</span>
              <span className="block text-[#188c32] sm:whitespace-nowrap">Для вас и ваших близких.</span>
            </h1>
            <p className="mt-4 max-w-[20rem] text-[13px] font-semibold leading-6 text-slate-700 sm:max-w-[46rem] sm:text-base sm:leading-7 lg:max-w-[52rem]">
              <span className="block">
                Местная платформа демонстрирует устойчивость к развитию услуг и размещению объявлений.
              </span>
              <span className="block sm:whitespace-nowrap">
                Товары, услуги, работа и многое другое рядом с вами.
              </span>
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-start gap-2 sm:mt-6">
              <Link
                href="/razmestit"
                className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-[#0aa337] px-3.5 text-xs font-bold text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-12 sm:gap-2 sm:px-6 sm:text-sm"
              >
                <PlusCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                Разместить
              </Link>
              <Link
                href="/obyavleniya"
                className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white/90 px-3.5 text-xs font-bold text-[#0875d1] shadow-sm transition hover:border-[#0875d1] hover:bg-blue-50 sm:h-12 sm:gap-2 sm:px-6 sm:text-sm"
              >
                Объявления
                <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </div>
            <div className="mt-5 grid w-fit max-w-full gap-2 text-xs font-bold text-slate-700 sm:mt-6 sm:grid-cols-2 sm:gap-3 sm:text-sm">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-xl bg-white/80 px-3 py-2 shadow-sm ring-1 ring-slate-200">
                <MapPinned className="h-4 w-4 shrink-0 text-[#0875d1]" />
                Районы, города и местные предложения
              </span>
              <span className="inline-flex min-w-0 items-center gap-2 rounded-xl bg-white/80 px-3 py-2 shadow-sm ring-1 ring-slate-200">
                <BriefcaseBusiness className="h-4 w-4 shrink-0 text-[#0aa337]" />
                Вакансии, заказы и анкеты специалистов
              </span>
            </div>
          </div>
          <div aria-hidden="true" className="hidden lg:block" />
        </div>
      </div>
    </section>
  );
}
