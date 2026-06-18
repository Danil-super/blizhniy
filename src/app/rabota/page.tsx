import type { Metadata } from "next";
import { CanonicalWorkPage } from "@/components/CanonicalWorkPage";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { listSpecialists, listWorkRequests } from "@/lib/mock-store";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";

export const metadata: Metadata = {
  title: "Работа",
  description: "Вакансии, заказчики, специалисты и исполнители на платформе БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const storedVacancies = await listStoredVacancies(12);
  const vacancies = listVacanciesWithStored(storedVacancies);

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <CanonicalWorkPage specialists={listSpecialists()} vacancies={vacancies} workRequests={listWorkRequests()} />
    </>
  );
}
