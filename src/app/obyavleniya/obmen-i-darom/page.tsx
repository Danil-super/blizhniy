import type { Metadata } from "next";
import { PublicExchangeAndFreePage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Меняю и отдам даром",
  description: "Раздел обмена и бесплатных объявлений на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/obmen-i-darom",
  },
};

export default function Page() {
  return <PublicExchangeAndFreePage />;
}
