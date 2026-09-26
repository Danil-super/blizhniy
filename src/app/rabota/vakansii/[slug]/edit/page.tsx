import { SiteHeader } from "@/components/SiteHeader";
import { VacancyEditClient } from "@/components/VacancyEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { vacancies } from "@/lib/data";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditVacancyPage({ params }: PageProps) {
  const { slug } = await params;
  // An edit URL is public. Never preload service-role data into this RSC response;
  // the client fetches its own vacancy from the authenticated cabinet endpoint.
  const initialVacancy = shouldShowFallbackContent() ? vacancies.find((vacancy) => vacancy.id === slug) : undefined;

  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы редактировать вакансию">
        <VacancyEditClient vacancyId={slug} initialVacancy={initialVacancy} />
      </PublicationAuthGate>
    </>
  );
}
