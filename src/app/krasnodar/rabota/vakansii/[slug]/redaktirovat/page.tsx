import { SiteHeader } from "@/components/SiteHeader";
import { Field, FormPanel, TextAreaField } from "@/components/FormPanel";

export default function EditVacancyPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-10">
        <FormPanel title="Редактировать вакансию" description="Владелец вакансии может обновить описание, контакты и архивировать публикацию.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Организация" placeholder="ООО РемДом" />
            <Field label="Вакансия" placeholder="Сантехник" />
            <Field label="Город" placeholder="Краснодар" />
            <Field label="Статус" placeholder="published" />
          </div>
          <TextAreaField label="Описание" />
          <button className="h-12 w-fit rounded-xl bg-[#0875d1] px-7 font-bold text-white">Сохранить изменения</button>
        </FormPanel>
      </main>
    </>
  );
}
