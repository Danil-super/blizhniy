import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Отдам даром",
  description: "Бесплатные объявления на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/otdam-darom",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="otdam-darom" />;
}
