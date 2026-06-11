import type { Metadata } from "next";
import { HomeHero } from "@/components/HomeHero";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkPage } from "@/components/WorkPage";
import { listSpecialists, listVacancies, listWorkRequests } from "@/lib/mock-store";

export const metadata: Metadata = {
  title: "Работа в Краснодаре",
  description:
    "Вакансии, заказчики, специалисты и исполнители в Краснодаре и Краснодарском крае на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/rabota",
  },
};

export const dynamic = "force-dynamic";

export default function KrasnodarWorkPage() {
  return (
    <>
      <SiteHeader />
      <HomeHero />
      <WorkPage specialists={listSpecialists()} vacancies={listVacancies()} workRequests={listWorkRequests()} />
    </>
  );
}
