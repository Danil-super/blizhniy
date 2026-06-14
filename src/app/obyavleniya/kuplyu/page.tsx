import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Куплю",
  description: "Запросы покупателей на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/kuplyu",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="kuplyu" />;
}
