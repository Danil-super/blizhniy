import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestCreateClient } from "@/components/WorkRequestCreateClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";

export const metadata: Metadata = {
  title: "Разместить заказ",
  description: "Создание заказа для специалистов и исполнителей.",
  alternates: {
    canonical: "/rabota/zakazy/sozdat",
  },
};

export default function CreateWorkRequestPage() {
  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы разместить заказ">
        <WorkRequestCreateClient />
      </PublicationAuthGate>
    </>
  );
}
