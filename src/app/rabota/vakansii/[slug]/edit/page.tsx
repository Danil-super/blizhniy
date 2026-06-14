import { SiteHeader } from "@/components/SiteHeader";
import { VacancyEditClient } from "@/components/VacancyEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { vacancies } from "@/lib/data";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditVacancyPage({ params }: PageProps) {
  const { slug } = await params;
  const initialVacancy = vacancies.find((vacancy) => vacancy.id === slug);

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы редактировать вакансию">
        <VacancyEditClient vacancyId={slug} initialVacancy={initialVacancy} />
      </PublicationAuthGate>
    </>
  );
}
