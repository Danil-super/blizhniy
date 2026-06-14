import type { Metadata } from "next";
import { PublicExchangeAndFreePage } from "@/components/listings/PublicListingSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Меняю и отдам даром в Краснодаре",
  description: "Отдельный раздел обмена и бесплатных объявлений Краснодарского края на БЛИЖНИЙ.",
  alternates: {
    canonical: "/krasnodar/obmen-i-darom",
  },
};

export default function Page() {
  return <PublicExchangeAndFreePage />;
}
