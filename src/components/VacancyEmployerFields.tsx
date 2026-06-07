"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Building2, IdCard, UserRound } from "lucide-react";
import { Field } from "@/components/FormPanel";

type EmployerType = "organization" | "ip" | "person";

const employerTypes: Array<{ description: string; id: EmployerType; icon: typeof Building2; label: string }> = [
  {
    description: "Юрлицо, кафе, магазин, сервис или компания.",
    id: "organization",
    icon: Building2,
    label: "Организация",
  },
  {
    description: "Индивидуальный предприниматель.",
    id: "ip",
    icon: IdCard,
    label: "ИП",
  },
  {
    description: "Частный работодатель без ИНН организации.",
    id: "person",
    icon: UserRound,
    label: "Частное лицо",
  },
];

function EmployerTypeButton({
  active,
  onClick,
  option,
}: {
  active: boolean;
  onClick: () => void;
  option: (typeof employerTypes)[number];
}) {
  const Icon = option.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid min-h-[4.35rem] min-w-0 rounded-xl border p-2.5 text-left transition sm:min-h-[5.25rem] sm:p-3 ${
        active ? "border-[#0875d1] bg-blue-50 text-[#060b27] ring-2 ring-blue-100" : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
      }`}
      aria-pressed={active}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8 ${active ? "bg-[#0875d1] text-white" : "bg-slate-50 text-[#0875d1]"}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 text-sm font-black">{option.label}</span>
      </span>
      <span className="mt-1.5 text-xs font-semibold leading-4 text-slate-500 sm:mt-2 sm:leading-5">{option.description}</span>
    </button>
  );
}

function SelectedEmployerSummary({ employerType, onChange }: { employerType: EmployerType; onChange: () => void }) {
  const option = employerTypes.find((item) => item.id === employerType) ?? employerTypes[0];
  const Icon = option.icon;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0875d1] text-white">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-bold uppercase text-blue-700">Кто размещает</span>
          <span className="mt-0.5 block text-base font-black text-[#060b27]">{option.label}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-bold text-[#0875d1] transition hover:border-[#0875d1]"
      >
        Изменить
      </button>
    </div>
  );
}

export function VacancyEmployerFields({ children }: { children: ReactNode }) {
  const [employerType, setEmployerType] = useState<EmployerType | "">("");
  const [step, setStep] = useState<1 | 2>(1);
  const isPrivatePerson = employerType === "person";
  const canContinue = Boolean(employerType);

  return (
    <>
      {step === 1 ? (
        <section className="vacancy-employer-step grid gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:gap-3 sm:p-4">
          <div>
            <p className="text-xs font-black uppercase text-[#0875d1]">Шаг 1 из 2</p>
            <h2 className="mt-1 text-lg font-black leading-tight text-[#060b27] sm:text-2xl">Кто размещает вакансию?</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600 sm:leading-6">
              Сначала выберите тип работодателя. Потом откроются только нужные поля: ИНН для организации и ИП, паспортные данные для частного лица.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {employerTypes.map((option) => (
              <EmployerTypeButton key={option.id} option={option} active={employerType === option.id} onClick={() => setEmployerType(option.id)} />
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">Эти данные нужны для проверки работодателя и доверия соискателей.</p>
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep(2)}
              className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#0875d1] px-5 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300 sm:h-11 sm:w-auto"
            >
              Продолжить
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && employerType ? (
        <>
          <SelectedEmployerSummary employerType={employerType} onChange={() => setStep(1)} />
          <input type="hidden" name="employerType" value={employerType} />

          <section className="vacancy-employer-step grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:p-4">
            <div>
              <p className="text-xs font-black uppercase text-[#0875d1]">Шаг 2 из 2</p>
              <h2 className="mt-1 text-base font-black text-[#060b27] sm:text-lg">Данные работодателя</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
                {isPrivatePerson
                  ? "Паспортные данные нужны только для проверки частного работодателя и не показываются в публичной карточке."
                  : "ИНН заполняют только организации и ИП. В публичной карточке будет показана информация о работодателе и контакты."}
              </p>
            </div>

            {isPrivatePerson ? (
              <div className="vacancy-fields-grid">
                <Field name="privateLastName" label="Фамилия" placeholder="Иванов" required />
                <Field name="privateFirstName" label="Имя" placeholder="Иван" required />
                <Field name="privateMiddleName" label="Отчество" placeholder="Иванович" />
                <Field name="passportSeries" label="Серия паспорта" placeholder="1234" inputMode="numeric" pattern="\\d{4}" maxLength={4} required />
                <Field name="passportNumber" label="Номер паспорта" placeholder="567890" inputMode="numeric" pattern="\\d{6}" maxLength={6} required />
                <Field name="passportIssuedAt" label="Дата выдачи" type="date" required />
                <div className="sm:col-span-2 lg:col-span-3">
                  <Field name="passportIssuedBy" label="Кем выдан" placeholder="ГУ МВД России по Краснодарскому краю" required />
                </div>
              </div>
            ) : (
              <div className="vacancy-fields-grid">
                <Field name="inn" label={employerType === "ip" ? "ИНН ИП" : "ИНН организации"} placeholder={employerType === "ip" ? "12 цифр" : "10 цифр"} inputMode="numeric" pattern={employerType === "ip" ? "\\d{12}" : "\\d{10}"} required />
                <Field name="legalName" label={employerType === "ip" ? "ФИО ИП" : "Юридическое название"} placeholder={employerType === "ip" ? "ИП Иванов Иван Иванович" : "ООО РемДом"} required />
                <Field name="contactPerson" label="Контактное лицо" placeholder="Наталья, HR" required />
              </div>
            )}

            <div className="vacancy-fields-grid">
              <Field name="website" label="Сайт / страница" placeholder="https://..." />
              <Field name="messengerUrl" label="WhatsApp / Telegram" placeholder="https://t.me/..." />
              <Field name="contactRole" label="Кто отвечает" placeholder="Директор, HR, владелец" />
            </div>
          </section>

          <div className="grid gap-3 sm:gap-3.5">{children}</div>
        </>
      ) : null}
    </>
  );
}
