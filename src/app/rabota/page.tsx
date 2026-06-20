import type { Metadata } from "next";
import { CanonicalWorkPage } from "@/components/CanonicalWorkPage";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { listSpecialists, listWorkRequests } from "@/lib/mock-store";
import { listSpecialistsWithStored, listStoredSpecialistProfiles } from "@/lib/specialist-profile-store";
import { listStoredVacancies, listVacanciesWithStored } from "@/lib/vacancy-store";
import { listStoredWorkRequests, listWorkRequestsWithStored } from "@/lib/work-request-store";

export const metadata: Metadata = {
  title: "Работа",
  description: "Вакансии, заказчики, специалисты и исполнители на платформе БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  const storedVacancies = await listStoredVacancies(12);
  const vacancies = listVacanciesWithStored(storedVacancies);
  const storedWorkRequests = await listStoredWorkRequests(12);
  const workRequests = listWorkRequestsWithStored(storedWorkRequests);
  const storedSpecialists = await listStoredSpecialistProfiles(12);
  const specialists = listSpecialistsWithStored(storedSpecialists, listSpecialists());

  return (
    <>
      <SiteHeader />
      <HomeHero />
      <CanonicalWorkPage specialists={specialists} vacancies={vacancies} workRequests={workRequests.length ? workRequests : listWorkRequests()} />
    </>
  );
}
