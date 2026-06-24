import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BriefcaseBusiness, MapPinned, PlusCircle } from "lucide-react";
import { BrandName } from "@/components/BrandName";

export function HomeIntro() {
  return (
    <section className="page-container pb-3 pt-3 sm:pb-4 sm:pt-4 lg:pb-5" aria-label="Главный экран">
      <div className="relative overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
        <Image
          src="/images/categories/free-gifts.webp"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right brightness-[1.08] contrast-[1.14] saturate-[1.28]"
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/72 to-white/5 sm:via-white/68 lg:hidden" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/8 lg:hidden" />
        <div className="relative z-10 grid min-h-[340px] items-center gap-5 p-5 sm:min-h-[390px] sm:p-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] lg:p-10">
          <div className="max-w-[34rem] lg:max-w-[42rem]">
            <p className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0a8f32] sm:text-sm">
              Краснодарский край рядом
            </p>
            <h1 className="mt-4 max-w-none text-[23px] font-black leading-[1.16] text-[#06102d] sm:max-w-[40rem] sm:text-5xl sm:leading-tight lg:text-6xl">
              <span className="block whitespace-nowrap">
                <BrandName /> помогает найти
              </span>
              {" "}
              <span className="block whitespace-nowrap">нужное рядом с домом</span>
            </h1>
            <p className="mt-4 max-w-[20rem] text-base font-semibold leading-7 text-slate-700 sm:max-w-[35rem] sm:text-lg sm:leading-8">
              <span className="block">Объявления, работа, специалисты,</span>
              <span className="block">услуги и полезные вещи в одном</span>
              <span className="block">спокойном городском пространстве.</span>
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-start gap-2 sm:mt-6">
              <Link
                href="/razmestit"
                className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-[#0aa337] px-3.5 text-xs font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-[#078a2e] sm:h-12 sm:gap-2 sm:px-6 sm:text-sm"
              >
                <PlusCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                Разместить
              </Link>
              <Link
                href="/obyavleniya"
                className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white/90 px-3.5 text-xs font-black text-[#0875d1] shadow-sm transition hover:border-[#0875d1] hover:bg-blue-50 sm:h-12 sm:gap-2 sm:px-6 sm:text-sm"
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
