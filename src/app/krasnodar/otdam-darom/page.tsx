import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Отдам даром в Краснодаре",
  description: "Бесплатные объявления Краснодарского края на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/otdam-darom",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="otdam-darom" />;
}
