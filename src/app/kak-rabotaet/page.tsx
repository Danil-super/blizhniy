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
    text: "Выберите тип публикации, заполните описание, категорию, контакты и адресную привязку. После модерации и оплаты публикация становится доступной на площадке.",
  },
  {
    title: "Оплата",
    icon: CreditCard,
    text: "Оплата создается после выбора тарифа. После подтверждения платежа публикация автоматически получает нужный статус на площадке.",
  },
  {
    title: "Связь",
    icon: MessageCircle,
    text: "Покупатель или заказчик связывается по телефону или мессенджеру, указанному в карточке. Площадка помогает быстро найти контакт рядом с собой.",
  },
  {
    title: "Ярмарка мастеров",
    icon: Store,
    text: "Мастера подают заявку, выбирают категорию, описывают товары и оплачивают участие. После подтверждения заявка отображается в разделе ярмарки.",
  },
];

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-12">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Сценарии сервиса</p>
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
              <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-[#0aa337]" />
              <p className="max-w-3xl text-sm leading-6 text-slate-700">
                Публикации, заявки и отклики проходят через авторизацию, проверку данных и оплату, если для выбранного размещения нужен тариф.
              </p>
            </div>
            <Link href="/razmestit" className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-[#0aa337] px-5 text-sm font-bold text-white">
              Разместить
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
