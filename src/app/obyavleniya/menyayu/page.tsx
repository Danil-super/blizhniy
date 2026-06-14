import type { Metadata } from "next";
import { PublicListingKindPage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Меняю",
  description: "Объявления об обмене товарами на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/menyayu",
  },
};

export default function Page() {
  return <PublicListingKindPage kind="menyayu" />;
}
