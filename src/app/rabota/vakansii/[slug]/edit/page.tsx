import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { VacancyEditClient } from "@/components/VacancyEditClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import { vacancies } from "@/lib/data";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import {WorkPublicationsPanel} from '@/components/work/WorkPublicationsPanel';

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditVacancyPage({ params }: PageProps) {
  const { slug } = await params;
  if(typeof process!=='undefined'&&process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate title="Войдите, чтобы редактировать вакансию" preserveDraftDuringRecheck>
   <main className="page-container py-6"><h1 className="text-2xl font-bold">Редактирование вакансии</h1><WorkPublicationsPanel kind="vacancy" initialId={slug}/></main>
  </PublicationAuthGate></>;
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
