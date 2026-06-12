import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Реквизиты",
  description: "Реквизиты ООО «БЛИЖНИЙ» для пользователей и партнеров платформы.",
};

const requisites = [
  { label: "Полное наименование", value: "Общество с ограниченной ответственностью «БЛИЖНИЙ»" },
  { label: "Сокращённое наименование", value: "ООО «БЛИЖНИЙ»" },
  { label: "ИНН", value: "2370010092" },
  { label: "ОГРН", value: "1202300009746" },
  {
    label: "Юридический адрес",
    value: "353584, Краснодарский край, Славянский район, п. Целинный, ул. Зеленая, д. 24, оф. 6",
  },
];

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <section className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0aa337]">Документы</p>
          <h1 className="mt-3 text-4xl font-black text-[#060b27]">Реквизиты</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Информация об организации, которая администрирует платформу «БЛИЖНИЙ» и обеспечивает работу сервиса
            размещения объявлений, вакансий, анкет специалистов и заявок пользователей.
          </p>

          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
            <dl className="divide-y divide-slate-200">
              {requisites.map((item) => (
                <div key={item.label} className="grid gap-2 p-5 sm:grid-cols-[220px_1fr]">
                  <dt className="text-sm font-bold text-slate-500">{item.label}</dt>
                  <dd className="text-base font-semibold leading-7 text-[#060b27]">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-6">
            <h2 className="text-xl font-black text-[#060b27]">Контакты для связи</h2>
            <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-700">
              <a href="mailto:prostova@yandex.ru" className="inline-flex items-center gap-2 transition hover:text-[#0875d1]">
                <Mail className="h-4 w-4 text-[#0875d1]" />
                prostova@yandex.ru
              </a>
              <a href="tel:+79883828621" className="inline-flex items-center gap-2 transition hover:text-[#0875d1]">
                <Phone className="h-4 w-4 text-[#0875d1]" />
                +7 988 382-86-21
              </a>
              <span className="inline-flex items-start gap-2 leading-6">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0875d1]" />
                353584, Краснодарский край, Славянский район, п. Целинный, ул. Зеленая, д. 24, оф. 6
              </span>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
