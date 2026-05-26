import Link from "next/link";
import { BriefcaseBusiness, ClipboardList, FileText, Store, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";

const publicationTypes = [
  {
    href: "/blizhniy/sozdat/obyavlenie",
    title: "Объявление",
    description: "Продать, купить, обменять или отдать вещь.",
    icon: FileText,
  },
  {
    href: "/blizhniy/rabota/vakansii/sozdat",
    title: "Вакансию",
    description: "Найти сотрудника или исполнителя для организации.",
    icon: BriefcaseBusiness,
  },
  {
    href: "/blizhniy/rabota/zakazy/sozdat",
    title: "Заказ исполнителю",
    description: "Описать задачу для специалистов рядом.",
    icon: ClipboardList,
  },
  {
    href: "/blizhniy/rabota/specialisty/anketa",
    title: "Анкету специалиста",
    description: "Добавить профиль исполнителя в каталог работы.",
    icon: UserRound,
  },
  {
    href: "/yarmarka-masterov/zayavka",
    title: "Заявку на ярмарку",
    description: "Подать заявку на участие в Ярмарке мастеров.",
    icon: Store,
  },
];

export function PublicationChoicePage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-10">
        <h1 className="text-3xl font-black text-[#060b27] sm:text-5xl">Что разместить?</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-lg sm:leading-8">Выберите тип публикации. После заполнения формы сайт создаст черновик или заказ на оплату, если для публикации нужен тариф.</p>
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {publicationTypes.map((type) => {
            const Icon = type.icon;

            return (
              <Link key={type.href} href={type.href} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1] transition group-hover:bg-[#0875d1] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-xl font-black text-[#060b27]">{type.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{type.description}</p>
              </Link>
            );
          })}
        </section>
      </main>
    </>
  );
}
