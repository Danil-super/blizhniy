import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestCreateClient } from "@/components/WorkRequestCreateClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";

export const metadata: Metadata = {
  title: "Разместить заказ",
  description: "Создание заказа для специалистов и исполнителей.",
  robots: { index: false, follow: false },
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
