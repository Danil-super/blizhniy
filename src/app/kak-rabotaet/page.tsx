import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, CreditCard, MessageCircle, Search, Store, UploadCloud } from "lucide-react";
import { BrandName } from "@/components/BrandName";
import { SiteHeader } from "@/components/SiteHeader";

const steps = [
  {
    title: "Найти объявление",
    icon: Search,
    text: "Откройте каталог, выберите раздел или воспользуйтесь поиском. Карточки показывают город, категорию, цену и быстрый переход к связи.",
  },
  {
    title: "Разместить публикацию",
    icon: UploadCloud,
    text: "Войдите в аккаунт, выберите тип размещения и заполните форму. Сохранённый черновик можно открыть в личном кабинете и дополнить позже.",
  },
  {
    title: "Оплата",
    icon: CreditCard,
    text: "Сейчас оплату проверяют участники тестирования. Если для вашего размещения доступна тестовая оплата, вы увидите сумму перед переходом в ЮKassa. Реальные деньги не списываются. Статус публикации можно проверить в личном кабинете.",
  },
  {
    title: "Связь",
    icon: MessageCircle,
    text: "В объявлениях способ связи указывает автор. Контакты вакансий и заказов закрыты на публичной странице. Подтверждённый отклик поступает автору публикации в личный кабинет.",
  },
  {
    title: "Ярмарка мастеров",
    icon: Store,
    text: "Оплата участия в ярмарке пока недоступна.",
  },
];

export const metadata: Metadata = {
  title: "Как работает БЛИЖНИЙ",
  description: "Как найти объявление на БЛИЖНИЙ, связаться с автором и разместить свою публикацию.",
  alternates: { canonical: "/kak-rabotaet" },
};

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-12">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#087f2b]">Сценарии сервиса</p>
          <h1 className="mt-3 text-2xl font-bold leading-tight text-[#060b27] sm:text-4xl">
            Как работает <BrandName />
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Платформа объединяет объявления, работу, специалистов и ярмарку мастеров в понятный региональный сервис.
          </p>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;

            return (
              <article key={step.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-xl font-bold text-[#060b27]">{step.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{step.text}</p>
              </article>
            );
          })}
        </section>

        <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[#087f2b]" />
              <p className="max-w-3xl text-sm leading-6 text-slate-700">
                Чтобы перейти от черновика к размещению, подтвердите номер телефона в настройках личного кабинета.
              </p>
            </div>
            <Link href="/razmestit" className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-[#087f2b] px-5 text-sm font-bold text-white">
              Разместить
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
