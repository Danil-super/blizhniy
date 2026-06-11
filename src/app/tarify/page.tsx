import Link from "next/link";
import { CreditCard, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { getTariffs } from "@/lib/tariff-store";
import type { Tariff } from "@/lib/types";

function tariffDetail(durationDays: number | null) {
  return durationDays ? `${durationDays} дней размещения` : "Разовое действие";
}

function tariffCta(tariff: Tariff) {
  if (tariff.action === "listing_publication") {
    return { href: "/krasnodar/sozdat/obyavlenie", label: "Создать объявление" };
  }

  if (tariff.action === "vacancy_publication") {
    return { href: "/krasnodar/rabota/vakansii/sozdat", label: "Разместить вакансию" };
  }

  if (tariff.action === "specialist_publication") {
    return { href: "/krasnodar/rabota/specialisty/anketa", label: "Создать анкету" };
  }

  if (tariff.action === "job_response") {
    return { href: "/krasnodar/rabota/vakansii", label: "Найти вакансию" };
  }

  if (tariff.action === "fair_participation") {
    return { href: "/yarmarka-masterov/zayavka", label: "Подать заявку" };
  }

  return { href: "/cabinet", label: "Открыть кабинет" };
}

export default function Page() {
  const tariffs = getTariffs();

  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-12">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Оплата публикаций</p>
          <h1 className="mt-3 text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">Тарифы</h1>
          <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Выберите нужное действие: счет на оплату появится после создания объявления, вакансии, анкеты, отклика или заявки.
          </p>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tariffs.map((tariff) => {
            const cta = tariffCta(tariff);

            return (
              <article key={tariff.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black text-[#060b27]">{tariff.name}</h2>
                  <CreditCard className="h-5 w-5 shrink-0 text-[#0875d1]" />
                </div>
                <p className="mt-4 text-3xl font-black text-[#0875d1]">{tariff.price} ₽</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{tariffDetail(tariff.durationDays)}</p>
                <Link href={cta.href} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#0aa337] text-sm font-bold text-white">
                  {cta.label}
                </Link>
              </article>
            );
          })}
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl font-black text-[#060b27]">
              <ShieldCheck className="h-5 w-5 text-[#0875d1]" />
              Тестовый режим
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Сейчас платежи не списывают реальные деньги. Кнопка оплаты имитирует успешное прохождение платежа и обновляет статус заявки или публикации.
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <h2 className="text-xl font-black text-[#060b27]">После утверждения</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              После согласования демонстрации к проекту можно подключить реальный платежный провайдер: ЮKassa или Т-Банк, без изменения пользовательского сценария.
            </p>
          </article>
        </section>
      </main>
    </>
  );
}
