import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Отдам даром",
  description: "Бесплатные объявления на БЛИЖНИЙ.",
  alternates: {
    canonical: "/obyavleniya/otdam-darom",
  },
};

export default function Page() {
  redirect("/obyavleniya?kind=otdam-darom");
}
