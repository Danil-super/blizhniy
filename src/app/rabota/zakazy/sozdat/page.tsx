import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkRequestCreateClient } from "@/components/WorkRequestCreateClient";
import { PublicationAuthGate } from "@/components/auth/PublicationAuthGate";
import {PrimaryWorkPublicationCreate} from '@/components/work/PrimaryWorkPublicationCreate';

export const metadata: Metadata = {
  title: "Разместить заказ",
  description: "Создание заказа для специалистов и исполнителей.",
  robots: { index: false, follow: false },
};

export default function CreateWorkRequestPage() {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <><SiteHeader/><PublicationAuthGate title="Войдите, чтобы разместить заказ" preserveDraftDuringRecheck><PrimaryWorkPublicationCreate kind="workRequest"/></PublicationAuthGate></>;
  return (
    <>
      <SiteHeader />
      <PublicationAuthGate title="Войдите, чтобы разместить заказ">
        <WorkRequestCreateClient />
      </PublicationAuthGate>
    </>
  );
}
