import type { Metadata } from "next";
import { CanonicalWorkPage } from "@/components/CanonicalWorkPage";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { listSpecialists, listVacancies, listWorkRequests } from "@/lib/mock-store";

export const metadata: Metadata = {
  title: "Работа",
  description: "Вакансии, заказчики, специалисты и исполнители на платформе БЛИЖНИЙ.",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <SiteHeader />
      <HomeHero />
      <CanonicalWorkPage specialists={listSpecialists()} vacancies={listVacancies()} workRequests={listWorkRequests()} />
    </>
  );
}
