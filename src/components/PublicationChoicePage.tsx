import Link from "next/link";
import Image from "next/image";
import { BriefcaseBusiness, ClipboardList, FileText, Store, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";

const publicationTypes = [
  {
    href: "/razmestit/obyavlenie",
    title: "Объявление",
    description: "Продать, купить или отдать вещь.",
    restriction: {
      image: "/policy/no-tattoo.png",
      title: "Тату запрещены",
      text: "Объявления о нанесении татуировок и тату-услугах не размещаем.",
    },
    icon: FileText,
  },
  {
    href: "/rabota/vakansii/sozdat",
    title: "Вакансию",
    description: "Найти сотрудника или исполнителя для компании, ИП или частного лица.",
    restriction: undefined,
    icon: BriefcaseBusiness,
  },
  {
    href: "/cabinet/zakazy",
    title: "Заказ исполнителю",
    description: "Описать задачу для специалистов рядом.",
    restriction: undefined,
    icon: ClipboardList,
  },
  {
    href: "/rabota/specialisty/anketa",
    title: "Анкету специалиста",
    description: "Добавить профиль исполнителя в каталог работы.",
    restriction: undefined,
    icon: UserRound,
  },
  {
    href: "/yarmarka-masterov/zayavka",
    title: "Заявку на ярмарку",
    description: "Подать заявку на участие в Ярмарке мастеров.",
    restriction: undefined,
    icon: Store,
  },
];

export function PublicationChoicePage({ adminMode = false }: { adminMode?: boolean }) {
  const querySuffix = adminMode ? "?admin=1" : "";

  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-10">
        <h1 className="text-2xl font-bold text-[#060b27] sm:text-4xl">Что разместить?</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-lg sm:leading-8">
          {adminMode
            ? "Выберите тип публикации. В админ-режиме формы можно сохранить без оплаты для служебной проверки."
            : "Выберите тип публикации. После заполнения формы сайт создаст черновик или заказ на оплату, если для публикации нужен тариф."}
        </p>
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {publicationTypes.map((type) => {
            const Icon = type.icon;

            return (
              <Link key={type.href} href={`${type.href}${querySuffix}`} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-card">
                <span className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1] transition group-hover:bg-[#0875d1] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  {type.restriction ? (
                    <span className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-rose-100 bg-rose-50/80 p-2 text-left">
                      <span className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-rose-100">
                        <Image src={type.restriction.image} alt="" width={64} height={64} className="h-full w-full object-cover" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold leading-4 text-rose-700">{type.restriction.title}</span>
                        <span className="mt-0.5 block text-[11px] font-semibold leading-4 text-slate-700 sm:text-xs">{type.restriction.text}</span>
                      </span>
                    </span>
                  ) : null}
                </span>
                <h2 className="mt-4 text-xl font-bold text-[#060b27]">{type.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{type.description}</p>
              </Link>
            );
          })}
        </section>
      </main>
    </>
  );
}
