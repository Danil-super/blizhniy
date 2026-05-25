import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkPage } from "@/components/WorkPage";

export const metadata: Metadata = {
  title: "Работа в Краснодаре",
  description:
    "Вакансии, заказчики, специалисты и исполнители в Краснодаре и Краснодарском крае на платформе БЛИЖНИЙ.",
  alternates: {
    canonical: "/blizhniy/rabota",
  },
};

export default function KrasnodarWorkPage() {
  return (
    <>
      <SiteHeader />
      <WorkPage />
    </>
  );
}
